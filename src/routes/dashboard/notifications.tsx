import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Bell, CheckCheck, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/dashboard/notifications")({ component: NotificationsPage });

type Notif = {
  id: string;
  message: string;
  type: string;
  entity_type: string;
  entity_id: string;
  is_read: boolean;
  created_at: string;
};

const TYPE_LABEL: Record<string, string> = {
  assigned: "任務指派",
  status_changed: "狀態更新",
  mentioned: "提及",
  due_soon: "即將到期",
  overdue: "逾期",
  review_needed: "待確認",
  announcement: "公告",
  quick_report: "回報",
};

function NotificationsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<Notif[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!user?.id) return;
    const { data } = await supabase
      .from("notification")
      .select("id,message,type,entity_type,entity_id,is_read,created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(200);
    setItems((data ?? []) as Notif[]);
    setLoading(false);
  };

  useEffect(() => {
    if (!user?.id) return;
    void load();
    const channel = supabase.channel(`notif-page-${user.id}`);
    channel.on(
      "postgres_changes" as never,
      { event: "*", schema: "public", table: "notification", filter: `user_id=eq.${user.id}` },
      () => { void load(); }
    );
    channel.subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const unread = useMemo(() => items.filter((n) => !n.is_read).length, [items]);
  const types = useMemo(() => Array.from(new Set(items.map((n) => n.type))), [items]);
  const shown = useMemo(
    () => (filter === "all" ? items : items.filter((n) => n.type === filter)),
    [items, filter]
  );

  const markAll = async () => {
    if (!user?.id) return;
    await supabase.from("notification").update({ is_read: true }).eq("user_id", user.id).eq("is_read", false);
    void load();
  };

  const clearRead = async () => {
    if (!user?.id) return;
    await supabase.from("notification").delete().eq("user_id", user.id).eq("is_read", true);
    void load();
  };

  const open = async (n: Notif) => {
    if (!n.is_read) await supabase.from("notification").update({ is_read: true }).eq("id", n.id);
    if (n.entity_type === "task") navigate({ to: "/dashboard/eip/tasks", search: { openTask: n.entity_id } });
    else if (n.entity_type === "meeting") navigate({ to: "/dashboard/eip/meetings/$id", params: { id: n.entity_id } });
    else if (n.entity_type === "announcement") navigate({ to: "/dashboard/eip/announcements" });
    else if (n.entity_type === "project") navigate({ to: "/dashboard/eip/projects" });
    else if (n.entity_type === "quick_report") navigate({ to: "/dashboard/eip/quick-reports" });
    else void load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center">
            <Bell className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold">通知中心</h1>
            <p className="text-sm text-muted-foreground">
              共 {items.length} 則通知・未讀 {unread} 則
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={markAll} disabled={unread === 0}>
            <CheckCheck className="w-4 h-4 mr-1.5" /> 全部標為已讀
          </Button>
          <Button variant="outline" size="sm" onClick={clearRead}>
            <Trash2 className="w-4 h-4 mr-1.5" /> 清除已讀
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Chip active={filter === "all"} onClick={() => setFilter("all")} label={`全部 ${items.length}`} />
        {types.map((t) => (
          <Chip
            key={t}
            active={filter === t}
            onClick={() => setFilter(t)}
            label={`${TYPE_LABEL[t] ?? t} ${items.filter((n) => n.type === t).length}`}
          />
        ))}
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground py-10 text-center">載入中…</div>
      ) : shown.length === 0 ? (
        <div className="border border-dashed rounded-xl py-16 text-center">
          <Bell className="w-8 h-8 mx-auto text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground mt-3">目前沒有通知</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {shown.map((n) => (
            <li key={n.id}>
              <button
                onClick={() => open(n)}
                className={`w-full text-left rounded-xl border px-4 py-3 transition-colors hover:bg-accent/40 ${
                  n.is_read ? "bg-card opacity-70" : "bg-card border-primary/40"
                }`}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${
                      n.is_read ? "bg-transparent" : "bg-primary"
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground shrink-0">
                        {TYPE_LABEL[n.type] ?? n.type}
                      </span>
                    </div>
                    <div className={`text-sm leading-snug ${n.is_read ? "" : "font-medium"}`}>
                      {n.message}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-1">
                      {new Date(n.created_at).toLocaleString("zh-TW")}
                    </div>
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Chip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
        active ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground hover:bg-accent/50"
      }`}
    >
      {label}
    </button>
  );
}
