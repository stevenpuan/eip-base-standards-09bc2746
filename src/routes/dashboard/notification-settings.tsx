import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export const Route = createFileRoute("/dashboard/notification-settings")({ component: Page });

interface Setting {
  id: string;
  event_code: string;
  recipient_scopes: string[];
  in_app_enabled: boolean;
  line_enabled: boolean;
  is_active: boolean;
  department_id: string | null;
}

const EVENT_LABEL: Record<string, string> = {
  task_assigned: "任務指派給我",
  task_status_changed: "任務狀態變更",
  quick_report_submitted: "請假 / 遲到 / 事件回報",
  recurring_due_soon: "常態工作即將到期",
  recurring_overdue: "常態工作逾期",
  announcement_published: "公告發布",
  meeting_invited: "會議邀請",
};

const SCOPES: { key: string; label: string }[] = [
  { key: "owner", label: "本人（負責人）" },
  { key: "dept_manager", label: "部門主管" },
  { key: "parent_dept_manager", label: "上層部門主管" },
  { key: "all_company", label: "全公司" },
];

function Page() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const editable = can("eip_notification_settings", "edit");

  const { data: rows = [] } = useQuery({
    queryKey: ["notification_setting"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notification_setting")
        .select("*")
        .is("department_id", null)
        .order("event_code");
      if (error) throw error;
      return data as Setting[];
    },
  });

  const [draft, setDraft] = useState<Record<string, Setting>>({});
  useEffect(() => {
    const m: Record<string, Setting> = {};
    rows.forEach((r) => (m[r.id] = { ...r, recipient_scopes: [...(r.recipient_scopes ?? [])] }));
    setDraft(m);
  }, [rows]);

  const toggleScope = (id: string, scope: string) => {
    setDraft((d) => {
      const cur = d[id];
      if (!cur) return d;
      const has = cur.recipient_scopes.includes(scope);
      const scopes = has ? cur.recipient_scopes.filter((s) => s !== scope) : [...cur.recipient_scopes, scope];
      return { ...d, [id]: { ...cur, recipient_scopes: scopes } };
    });
  };

  const setFlag = (id: string, key: "in_app_enabled" | "line_enabled" | "is_active", value: boolean) => {
    setDraft((d) => (d[id] ? { ...d, [id]: { ...d[id], [key]: value } } : d));
  };

  const save = async () => {
    const updates = rows
      .filter((r) => JSON.stringify(draft[r.id]) !== JSON.stringify({ ...r, recipient_scopes: [...(r.recipient_scopes ?? [])] }))
      .map((r) => {
        const d = draft[r.id];
        return supabase
          .from("notification_setting")
          .update({
            recipient_scopes: d.recipient_scopes,
            in_app_enabled: d.in_app_enabled,
            line_enabled: d.line_enabled,
            is_active: d.is_active,
            updated_at: new Date().toISOString(),
          })
          .eq("id", r.id);
      });
    if (updates.length === 0) { toast.info("沒有變更"); return; }
    const results = await Promise.all(updates);
    const err = results.find((x) => x.error);
    if (err?.error) { toast.error(err.error.message); return; }
    toast.success("已儲存");
    qc.invalidateQueries({ queryKey: ["notification_setting"] });
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="通知設定"
        description="設定每個事件要通知哪些對象（依角色與部門層級），以及走站內或 LINE。"
        actions={editable ? <Button onClick={save}>儲存</Button> : undefined}
      />

      <div className="rounded-xl border overflow-hidden">
        <div className="grid grid-cols-[1fr_88px_88px_72px] items-center gap-2 px-4 py-2.5 bg-muted/50 text-xs text-muted-foreground border-b">
          <span>通知事件 / 接收對象</span>
          <span className="text-center">站內</span>
          <span className="text-center">LINE</span>
          <span className="text-center">啟用</span>
        </div>
        {rows.map((r) => {
          const d = draft[r.id] ?? r;
          return (
            <div key={r.id} className="grid grid-cols-[1fr_88px_88px_72px] items-start gap-2 px-4 py-3 border-b last:border-b-0">
              <div className="min-w-0">
                <div className="text-sm font-medium mb-2 flex items-center gap-2">
                  <BellRing className="w-3.5 h-3.5 text-muted-foreground" />
                  {EVENT_LABEL[r.event_code] ?? r.event_code}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {SCOPES.map((s) => {
                    const on = d.recipient_scopes.includes(s.key);
                    return (
                      <button
                        key={s.key}
                        disabled={!editable}
                        onClick={() => toggleScope(r.id, s.key)}
                        className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                          on ? "bg-primary/10 text-primary border-primary/40" : "bg-card text-muted-foreground hover:bg-accent/50"
                        } ${editable ? "" : "opacity-70 cursor-default"}`}
                      >
                        {s.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex justify-center pt-1">
                <Toggle on={d.in_app_enabled} disabled={!editable} onClick={() => setFlag(r.id, "in_app_enabled", !d.in_app_enabled)} />
              </div>
              <div className="flex justify-center pt-1">
                <Toggle on={d.line_enabled} disabled={!editable} onClick={() => setFlag(r.id, "line_enabled", !d.line_enabled)} />
              </div>
              <div className="flex justify-center pt-1">
                <Toggle on={d.is_active} disabled={!editable} onClick={() => setFlag(r.id, "is_active", !d.is_active)} />
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        「上層部門主管」依部門樹往上一層解析；LINE 建議採每日彙整以控制成本。個別部門的特別設定（部門覆寫）可於後續版本加入。
      </p>
    </div>
  );
}

function Toggle({ on, disabled, onClick }: { on: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={on}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
        on ? "bg-primary" : "bg-muted-foreground/30"
      } ${disabled ? "opacity-60 cursor-default" : ""}`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${on ? "translate-x-4" : "translate-x-0.5"}`} />
    </button>
  );
}
