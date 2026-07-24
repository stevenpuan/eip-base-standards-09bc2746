import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export const Route = createFileRoute("/dashboard/eip/calendar")({ component: CalendarPage });

type EventType = "task" | "meeting" | "milestone" | "personal";

type CalEvent = {
  id: string;
  type: EventType;
  title: string;
  date: string;
  href?: string;
  taskId?: string;
  meetingId?: string;
  milestoneId?: string;
  projectId?: string;
  endDate?: string;
  personal?: PersonalEvent;
  readOnly?: boolean;
};

type PersonalEvent = {
  id: string;
  user_id: string;
  title: string;
  start_date: string;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  note: string | null;
};

type AppUserLite = { id: string; name: string | null };

const TIME_OPTIONS: string[] = (() => {
  const arr: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 30]) {
      arr.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    }
  }
  return arr;
})();

function fmtTime(t: string | null | undefined) {
  if (!t) return null;
  // accept "HH:MM" or "HH:MM:SS"
  const m = /^(\d{2}):(\d{2})/.exec(t);
  return m ? `${m[1]}:${m[2]}` : null;
}

const TYPE_LABEL = { task: "任務", meeting: "會議", milestone: "里程碑", personal: "個人行程" } as const;
const TYPE_COLOR: Record<EventType, string> = {
  task: "bg-blue-100 text-blue-700 border-blue-200",
  meeting: "bg-emerald-100 text-emerald-700 border-emerald-200",
  milestone: "bg-amber-100 text-amber-700 border-amber-200",
  personal: "bg-purple-100 text-purple-700 border-purple-200",
};

function toYMD(d: Date | string | null) {
  if (!d) return null;
  const dt = typeof d === "string" ? new Date(d) : d;
  if (isNaN(dt.getTime())) return null;
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function CalendarPage() {
  const { user } = useAuth();
  const myId = user?.id ?? "";
  const qc = useQueryClient();

  const [cursor, setCursor] = useState(() => {
    const d = new Date(); d.setDate(1); return d;
  });
  const [show, setShow] = useState({ task: true, meeting: true, milestone: true, personal: true });

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
  const personalQ = useQuery({
    queryKey: ["cal", "personal"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("personal_event")
        .select("id,user_id,title,start_date,end_date,start_time,end_time,note");
      if (error) throw error;
      return (data ?? []) as PersonalEvent[];
    },
  });
  const sharesQ = useQuery({
    queryKey: ["cal", "personal_shares"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("personal_event_share")
        .select("event_id,shared_with_user_id");
      if (error) throw error;
      return data ?? [];
    },
  });
  const usersQ = useQuery({
    queryKey: ["cal", "app_users"],
    queryFn: async () => {
      const { data, error } = await supabase.from("app_user").select("id,name").eq("status", "active");
      if (error) throw error;
      return (data ?? []) as AppUserLite[];
    },
  });

  const events = useMemo<CalEvent[]>(() => {
    const list: CalEvent[] = [];
    if (show.task) {
      (tasksQ.data ?? []).forEach((t: any) => {
        const d = toYMD(t.due_date);
        if (d) list.push({ id: `t-${t.id}`, type: "task", title: t.title, date: d, endDate: toYMD(t.start_date) ?? undefined, href: `/dashboard/eip/tasks`, taskId: t.id });
      });
    }
    if (show.meeting) {
      (meetingsQ.data ?? []).forEach((m: any) => {
        const d = toYMD(m.meeting_date);
        if (d) list.push({ id: `m-${m.id}`, type: "meeting", title: m.title, date: d, meetingId: m.id });
      });
    }
    if (show.milestone) {
      (milestonesQ.data ?? []).forEach((ms: any) => {
        const d = toYMD(ms.due_date);
        if (d) list.push({ id: `ms-${ms.id}`, type: "milestone", title: ms.name, date: d, projectId: ms.project_id ?? undefined, milestoneId: ms.id });
      });
    }
    if (show.personal) {
      (personalQ.data ?? []).forEach((p) => {
        const d = toYMD(p.start_date);
        if (d) list.push({
          id: `p-${p.id}`,
          type: "personal",
          title: p.title,
          date: d,
          endDate: toYMD(p.end_date) ?? undefined,
          personal: p,
          readOnly: p.user_id !== myId,
        });
      });
    }
    return list;
  }, [tasksQ.data, meetingsQ.data, milestonesQ.data, personalQ.data, show, myId]);

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

  // ---- Personal event dialog ----
  const [peOpen, setPeOpen] = useState(false);
  const [peEditing, setPeEditing] = useState<PersonalEvent | null>(null);
  const [peTitle, setPeTitle] = useState("");
  const [peStart, setPeStart] = useState("");
  const [peEnd, setPeEnd] = useState("");
  const [peStartTime, setPeStartTime] = useState("");
  const [peEndTime, setPeEndTime] = useState("");
  const [peNote, setPeNote] = useState("");
  const [peShares, setPeShares] = useState<string[]>([]);
  const [peSubmitting, setPeSubmitting] = useState(false);
  const [peViewing, setPeViewing] = useState<PersonalEvent | null>(null);

  const sharesByEvent = useMemo(() => {
    const m = new Map<string, string[]>();
    (sharesQ.data ?? []).forEach((s: any) => {
      const arr = m.get(s.event_id) ?? [];
      arr.push(s.shared_with_user_id);
      m.set(s.event_id, arr);
    });
    return m;
  }, [sharesQ.data]);

  const openCreatePe = () => {
    setPeEditing(null);
    setPeTitle("");
    setPeStart(today ?? "");
    setPeEnd("");
    setPeStartTime("");
    setPeEndTime("");
    setPeNote("");
    setPeShares([]);
    setPeOpen(true);
  };
  const openEditPe = (p: PersonalEvent) => {
    setPeEditing(p);
    setPeTitle(p.title);
    setPeStart(toYMD(p.start_date) ?? "");
    setPeEnd(toYMD(p.end_date) ?? "");
    setPeStartTime(fmtTime(p.start_time) ?? "");
    setPeEndTime(fmtTime(p.end_time) ?? "");
    setPeNote(p.note ?? "");
    setPeShares(sharesByEvent.get(p.id) ?? []);
    setPeOpen(true);
  };
  const toggleShare = (uid: string) => {
    setPeShares((prev) => prev.includes(uid) ? prev.filter((x) => x !== uid) : [...prev, uid]);
  };

  const savePe = async () => {
    if (!peTitle.trim() || !peStart) { toast.error("請填寫標題與開始日期"); return; }
    setPeSubmitting(true);
    let eventId = peEditing?.id ?? null;
    if (peEditing) {
      const { error } = await supabase.from("personal_event").update({
        title: peTitle.trim(),
        start_date: peStart,
        end_date: peEnd || null,
        start_time: peStartTime || null,
        end_time: peEndTime || null,
        note: peNote.trim() || null,
      } as any).eq("id", peEditing.id);
      if (error) { setPeSubmitting(false); toast.error(error.message); return; }
      await supabase.from("personal_event_share").delete().eq("event_id", peEditing.id);
    } else {
      const { data, error } = await supabase.from("personal_event").insert({
        title: peTitle.trim(),
        start_date: peStart,
        end_date: peEnd || null,
        start_time: peStartTime || null,
        end_time: peEndTime || null,
        note: peNote.trim() || null,
      } as any).select("id").single();
      if (error) { setPeSubmitting(false); toast.error(error.message); return; }
      eventId = data.id;
    }
    if (eventId && peShares.length > 0) {
      const rows = peShares.map((uid) => ({ event_id: eventId!, shared_with_user_id: uid }));
      const { error } = await supabase.from("personal_event_share").insert(rows);
      if (error) { setPeSubmitting(false); toast.error(error.message); return; }
    }
    setPeSubmitting(false);
    setPeOpen(false);
    toast.success("已儲存");
    qc.invalidateQueries({ queryKey: ["cal", "personal"] });
    qc.invalidateQueries({ queryKey: ["cal", "personal_shares"] });
  };

  const deletePe = async () => {
    if (!peEditing) return;
    if (!confirm("確定刪除此個人行程？")) return;
    setPeSubmitting(true);
    await supabase.from("personal_event_share").delete().eq("event_id", peEditing.id);
    const { error } = await supabase.from("personal_event").delete().eq("id", peEditing.id);
    setPeSubmitting(false);
    if (error) { toast.error(error.message); return; }
    setPeOpen(false);
    toast.success("已刪除");
    qc.invalidateQueries({ queryKey: ["cal", "personal"] });
    qc.invalidateQueries({ queryKey: ["cal", "personal_shares"] });
  };

  const userMap = useMemo(() => {
    const m = new Map<string, string>();
    (usersQ.data ?? []).forEach((u) => m.set(u.id, u.name ?? u.id));
    return m;
  }, [usersQ.data]);

  return (
    <div>
      <PageHeader
        title="行事曆"
        description="整合任務、會議、里程碑與個人行程於同一視圖。"
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="icon" onClick={() => setCursor(new Date(year, month - 1, 1))}><ChevronLeft className="w-4 h-4" /></Button>
            <div className="text-sm font-medium w-28 text-center">{year} 年 {month + 1} 月</div>
            <Button variant="outline" size="icon" onClick={() => setCursor(new Date(year, month + 1, 1))}><ChevronRight className="w-4 h-4" /></Button>
            <Button variant="ghost" size="sm" onClick={() => { const d = new Date(); d.setDate(1); setCursor(d); }}>今天</Button>
            <Button size="sm" onClick={openCreatePe}>＋ 新增行程</Button>
          </div>
        }
      />

      <div className="mb-3 flex items-center gap-4 text-xs flex-wrap">
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
                          const displayTitle = (e.type === "personal" && e.personal && fmtTime(e.personal.start_time))
                            ? `${fmtTime(e.personal.start_time)} ${e.title}`
                            : e.title;
                          if (e.type === "personal" && e.personal) {
                            const onClick = () => {
                              if (e.readOnly) setPeViewing(e.personal!);
                              else openEditPe(e.personal!);
                            };
                            return (
                              <button key={e.id} type="button" onClick={onClick} className={cls + " hover:opacity-80 text-left w-full"} title={`[${TYPE_LABEL[e.type]}] ${displayTitle}`}>
                                {displayTitle}
                              </button>
                            );
                          }
                          if (e.type === "task" && e.taskId) {
                            return (
                              <Link
                                key={e.id}
                                to="/dashboard/eip/tasks"
                                search={{ openTask: e.taskId }}
                                className={cls + " hover:opacity-80"}
                                title={`[${TYPE_LABEL[e.type]}] ${displayTitle}`}
                              >
                                {displayTitle}
                              </Link>
                            );
                          }
                          if (e.type === "meeting" && e.meetingId) {
                            return (
                              <Link
                                key={e.id}
                                to="/dashboard/eip/meetings/$id"
                                params={{ id: e.meetingId }}
                                className={cls + " hover:opacity-80"}
                                title={`[${TYPE_LABEL[e.type]}] ${displayTitle}`}
                              >
                                {displayTitle}
                              </Link>
                            );
                          }
                          if (e.type === "milestone" && e.projectId) {
                            return (
                              <Link
                                key={e.id}
                                to="/dashboard/eip/projects/$id"
                                params={{ id: e.projectId }}
                                search={{ milestone: e.milestoneId }}
                                className={cls + " hover:opacity-80"}
                                title={`[${TYPE_LABEL[e.type]}] ${displayTitle}`}
                              >
                                {displayTitle}
                              </Link>
                            );
                          }
                          return e.href ? (
                            <Link key={e.id} to={e.href as any} className={cls + " hover:opacity-80"} title={`[${TYPE_LABEL[e.type]}] ${displayTitle}`}>
                              {displayTitle}
                            </Link>
                          ) : (
                            <div key={e.id} className={cls} title={`[${TYPE_LABEL[e.type]}] ${displayTitle}`}>{displayTitle}</div>
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

      <Dialog open={peOpen} onOpenChange={(o) => { if (!o) setPeOpen(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{peEditing ? "編輯個人行程" : "新增個人行程"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">標題 *</Label>
              <Input value={peTitle} onChange={(e) => setPeTitle(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">開始日期 *</Label>
                <Input type="date" value={peStart} onChange={(e) => setPeStart(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">開始時間</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={peStartTime}
                  onChange={(e) => setPeStartTime(e.target.value)}
                >
                  <option value="">整天 / 不指定</option>
                  {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">結束日期</Label>
                <Input type="date" value={peEnd} onChange={(e) => setPeEnd(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">結束時間</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={peEndTime}
                  onChange={(e) => setPeEndTime(e.target.value)}
                >
                  <option value="">整天 / 不指定</option>
                  {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">備註</Label>
              <Textarea value={peNote} onChange={(e) => setPeNote(e.target.value)} rows={3} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">分享給</Label>
              <div className="max-h-40 overflow-y-auto border rounded-md p-2 space-y-1">
                {(usersQ.data ?? []).filter((u) => u.id !== myId).map((u) => (
                  <label key={u.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox checked={peShares.includes(u.id)} onCheckedChange={() => toggleShare(u.id)} />
                    <span>{u.name ?? u.id}</span>
                  </label>
                ))}
                {(usersQ.data ?? []).filter((u) => u.id !== myId).length === 0 && (
                  <p className="text-xs text-muted-foreground">無其他成員</p>
                )}
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            {peEditing && (
              <Button variant="destructive" onClick={deletePe} disabled={peSubmitting} className="mr-auto">刪除</Button>
            )}
            <Button variant="outline" onClick={() => setPeOpen(false)} disabled={peSubmitting}>取消</Button>
            <Button onClick={savePe} disabled={peSubmitting}>{peSubmitting ? "儲存中…" : "儲存"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!peViewing} onOpenChange={(o) => { if (!o) setPeViewing(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{peViewing?.title}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p><span className="text-muted-foreground">建立者：</span>{peViewing ? (userMap.get(peViewing.user_id) ?? peViewing.user_id) : ""}</p>
            <p><span className="text-muted-foreground">日期：</span>{peViewing?.start_date}{peViewing?.end_date ? ` ~ ${peViewing.end_date}` : ""}</p>
            {(peViewing?.start_time || peViewing?.end_time) && (
              <p><span className="text-muted-foreground">時間：</span>{fmtTime(peViewing?.start_time) ?? "—"}{peViewing?.end_time ? ` ~ ${fmtTime(peViewing.end_time)}` : ""}</p>
            )}
            {peViewing?.note && (
              <p className="whitespace-pre-wrap"><span className="text-muted-foreground">備註：</span>{peViewing.note}</p>
            )}
            <p className="text-xs text-muted-foreground">此為他人分享給你的行程，僅可檢視。</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPeViewing(null)}>關閉</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
