import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Bell } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

type Notif = {
  id: string;
  message: string;
  type: string;
  entity_type: string;
  entity_id: string;
  is_read: boolean;
  created_at: string;
};

export function NotificationBell() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<Notif[]>([]);
  const [open, setOpen] = useState(false);

  const load = async () => {
    if (!user?.id) return;
    const { data } = await supabase
      .from("notification")
      .select("id,message,type,entity_type,entity_id,is_read,created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);
    setItems((data ?? []) as Notif[]);
  };

  useEffect(() => {
    if (!user?.id) return;
    void load();
    const channel = supabase
      .channel(`notif-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notification", filter: `user_id=eq.${user.id}` },
        () => { void load(); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const unread = useMemo(() => items.filter((n) => !n.is_read).length, [items]);

  const handleClick = async (n: Notif) => {
    if (!n.is_read) {
      await supabase.from("notification").update({ is_read: true }).eq("id", n.id);
    }
    setOpen(false);
    if (n.entity_type === "task") navigate({ to: "/dashboard/eip/tasks" });
    else if (n.entity_type === "meeting") navigate({ to: "/dashboard/eip/meetings" });
    else if (n.entity_type === "announcement") navigate({ to: "/dashboard/eip/announcements" });
    else if (n.entity_type === "project") navigate({ to: "/dashboard/eip/projects" });
    void load();
  };

  const markAll = async () => {
    if (!user?.id) return;
    await supabase.from("notification").update({ is_read: true }).eq("user_id", user.id).eq("is_read", false);
    void load();
  };

  if (!user) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="relative p-2 rounded-md hover:bg-accent text-muted-foreground"
          aria-label="通知"
          title="通知"
        >
          <Bell className="w-4 h-4" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-semibold flex items-center justify-center">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" side="top" className="w-80 p-0">
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <div className="text-sm font-medium">通知 {unread > 0 && <span className="text-xs text-muted-foreground">({unread} 則未讀)</span>}</div>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={markAll} disabled={unread === 0}>
            全部標為已讀
          </Button>
        </div>
        <ScrollArea className="max-h-80">
          {items.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-6">目前沒有通知</div>
          ) : (
            <ul className="divide-y">
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    onClick={() => handleClick(n)}
                    className={`w-full text-left px-3 py-2 hover:bg-accent/50 ${n.is_read ? "" : "bg-accent/30"}`}
                  >
                    <div className="text-sm leading-snug">{n.message}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {new Date(n.created_at).toLocaleString("zh-TW")}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
