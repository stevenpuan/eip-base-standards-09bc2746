import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";

export const Route = createFileRoute("/dashboard/eip/calendar")({ component: CalendarPage });

type CalEvent = {
  id: string;
  type: "task" | "meeting" | "milestone";
  title: string;
  date: string; // yyyy-mm-dd
  href?: string;
  endDate?: string;
};

const TYPE_LABEL = { task: "任務", meeting: "會議", milestone: "里程碑" } as const;
const TYPE_COLOR: Record<CalEvent["type"], string> = {
  task: "bg-blue-100 text-blue-700 border-blue-200",
  meeting: "bg-emerald-100 text-emerald-700 border-emerald-200",
  milestone: "bg-amber-100 text-amber-700 border-amber-200",
};

function toYMD(d: Date | string | null) {
  if (!d) return null;
  const dt = typeof d === "string" ? new Date(d) : d;
  if (isNaN(dt.getTime())) return null;
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function CalendarPage() {
  const [cursor, setCursor] = useState(() => {
    const d = new Date(); d.setDate(1); return d;
  });
  const [show, setShow] = useState({ task: true, meeting: true, milestone: true });

  const tasksQ = useQuery({
    queryKey: ["cal", "tasks"],
    queryFn: async () => {
      const { data, error } = await supabase.from("task").select("id,title,due_date,start_date").not("due_date", "is", null);
      if (error) throw error;
      return data ?? [];
    },
  });
  const meetingsQ = useQuery({
    queryKey: ["cal", "meetings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("meeting").select("id,title,meeting_date");
      if (error) throw error;
      return data ?? [];
    },
  });
  const milestonesQ = useQuery({
    queryKey: ["cal", "milestones"],
    queryFn: async () => {
      const { data, error } = await supabase.from("milestone").select("id,name,due_date,project_id").not("due_date", "is", null);
      if (error) throw error;
      return data ?? [];
    },
  });

  const events = useMemo<CalEvent[]>(() => {
    const list: CalEvent[] = [];
    if (show.task) {
      (tasksQ.data ?? []).forEach((t: any) => {
        const d = toYMD(t.due_date);
        if (d) list.push({ id: `t-${t.id}`, type: "task", title: t.title, date: d, endDate: toYMD(t.start_date) ?? undefined, href: `/dashboard/eip/tasks` });
      });
    }
    if (show.meeting) {
      (meetingsQ.data ?? []).forEach((m: any) => {
        const d = toYMD(m.meeting_date);
        if (d) list.push({ id: `m-${m.id}`, type: "meeting", title: m.title, date: d, href: `/dashboard/eip/meetings` });
      });
    }
    if (show.milestone) {
      (milestonesQ.data ?? []).forEach((ms: any) => {
        const d = toYMD(ms.due_date);
        if (d) list.push({ id: `ms-${ms.id}`, type: "milestone", title: ms.name, date: d, href: ms.project_id ? `/dashboard/eip/projects/${ms.project_id}` : undefined });
      });
    }
    return list;
  }, [tasksQ.data, meetingsQ.data, milestonesQ.data, show]);

  // 建立月曆網格 (週日為首)
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);

  const eventsByDay = useMemo(() => {
    const m = new Map<string, CalEvent[]>();
    events.forEach((e) => {
      const arr = m.get(e.date) ?? [];
      arr.push(e);
      m.set(e.date, arr);
    });
    return m;
  }, [events]);

  const today = toYMD(new Date());

  return (
    <div>
      <PageHeader
        title="行事曆"
        description="整合任務、會議、里程碑於同一視圖。"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => setCursor(new Date(year, month - 1, 1))}><ChevronLeft className="w-4 h-4" /></Button>
            <div className="text-sm font-medium w-28 text-center">{year} 年 {month + 1} 月</div>
            <Button variant="outline" size="icon" onClick={() => setCursor(new Date(year, month + 1, 1))}><ChevronRight className="w-4 h-4" /></Button>
            <Button variant="ghost" size="sm" onClick={() => { const d = new Date(); d.setDate(1); setCursor(d); }}>今天</Button>
          </div>
        }
      />

      <div className="mb-3 flex items-center gap-4 text-xs">
        {(Object.keys(TYPE_LABEL) as Array<keyof typeof TYPE_LABEL>).map((k) => (
          <label key={k} className="flex items-center gap-1.5 cursor-pointer">
            <Checkbox checked={show[k]} onCheckedChange={(v) => setShow((s) => ({ ...s, [k]: !!v }))} />
            <span className={`inline-block w-3 h-3 rounded ${TYPE_COLOR[k].split(" ")[0]}`} />
            {TYPE_LABEL[k]}
          </label>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="grid grid-cols-7 text-xs text-muted-foreground border-b">
            {["日", "一", "二", "三", "四", "五", "六"].map((d) => (
              <div key={d} className="px-2 py-1.5 text-center">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((d, i) => {
              const ymd = d ? toYMD(d) : null;
              const evs = ymd ? eventsByDay.get(ymd) ?? [] : [];
              const isToday = ymd === today;
              return (
                <div key={i} className={`min-h-[110px] border-r border-b p-1.5 ${isToday ? "bg-accent/30" : ""}`}>
                  {d && (
                    <>
                      <div className={`text-xs font-medium mb-1 ${isToday ? "text-primary" : "text-muted-foreground"}`}>{d.getDate()}</div>
                      <div className="space-y-1">
                        {evs.slice(0, 4).map((e) => {
                          const cls = `block text-[11px] truncate px-1.5 py-0.5 rounded border ${TYPE_COLOR[e.type]}`;
                          return e.href ? (
                            <Link key={e.id} to={e.href as any} className={cls + " hover:opacity-80"} title={`[${TYPE_LABEL[e.type]}] ${e.title}`}>
                              {e.title}
                            </Link>
                          ) : (
                            <div key={e.id} className={cls} title={`[${TYPE_LABEL[e.type]}] ${e.title}`}>{e.title}</div>
                          );
                        })}
                        {evs.length > 4 && <div className="text-[10px] text-muted-foreground px-1">+{evs.length - 4}</div>}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
