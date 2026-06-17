import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useEipUser, canManageEip } from "@/lib/eip-user";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Database } from "@/integrations/supabase/types";

export const Route = createFileRoute("/dashboard/eip/projects/$id")({ component: ProjectDetailPage });

type Project = Database["public"]["Tables"]["project"]["Row"];
type Task = Database["public"]["Tables"]["task"]["Row"];
type Milestone = Database["public"]["Tables"]["milestone"]["Row"];
type AppUser = Database["public"]["Tables"]["app_user"]["Row"];
type ProjectStatus = Database["public"]["Enums"]["project_status"];

const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  planning: "規劃中", active: "進行中", on_hold: "暫停", done: "已完成",
};

function ProjectDetailPage() {
  const { id } = Route.useParams();
  const { appUser } = useEipUser();

  const projectQ = useQuery({
    queryKey: ["eip", "project", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("project").select("*").eq("id", id).single();
      if (error) throw error;
      return data as Project;
    },
  });
  const tasksQ = useQuery({
    queryKey: ["eip", "project-tasks", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("task").select("*").eq("project_id", id);
      if (error) throw error;
      return (data ?? []) as Task[];
    },
  });
  const milestonesQ = useQuery({
    queryKey: ["eip", "milestones", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("milestone").select("*").eq("project_id", id).order("due_date", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as Milestone[];
    },
  });
  const statusesQ = useQuery({
    queryKey: ["eip", "task-statuses"],
    queryFn: async () => {
      const { data, error } = await supabase.from("task_status").select("*").order("sort_order");
      if (error) throw error;
      return data ?? [];
    },
  });
  const membersQ = useQuery({
    queryKey: ["eip", "project-members", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("project_member").select("*").eq("project_id", id);
      if (error) throw error;
      return data ?? [];
    },
  });
  const usersQ = useQuery({
    queryKey: ["eip", "users-min"],
    queryFn: async () => {
      const { data, error } = await supabase.from("app_user").select("*");
      if (error) throw error;
      return (data ?? []) as AppUser[];
    },
  });

  const userMap = useMemo(() => new Map((usersQ.data ?? []).map((u) => [u.id, u])), [usersQ.data]);
  const doneStatusIds = useMemo(() => new Set((statusesQ.data ?? []).filter((s: any) => s.is_done_state).map((s: any) => s.id)), [statusesQ.data]);

  const tasks = tasksQ.data ?? [];
  const milestones = milestonesQ.data ?? [];
  const todayYMD = new Date().toISOString().slice(0, 10);

  const totalT = tasks.length;
  const doneT = tasks.filter((t) => doneStatusIds.has(t.status_id) || t.progress >= 100).length;
  const inProgT = tasks.filter((t) => !doneStatusIds.has(t.status_id) && t.progress > 0 && t.progress < 100).length;
  const overdueT = tasks.filter((t) => t.due_date && t.due_date < todayYMD && !doneStatusIds.has(t.status_id)).length;
  const completion = totalT ? Math.round((doneT / totalT) * 100) : 0;
  const health: "green" | "yellow" | "red" =
    overdueT > Math.max(2, totalT * 0.2) ? "red" :
    overdueT > 0 || completion < 30 ? "yellow" : "green";
  const HEALTH_COLOR = { green: "bg-emerald-500", yellow: "bg-amber-500", red: "bg-red-500" } as const;
  const HEALTH_LABEL = { green: "健康", yellow: "需關注", red: "風險" } as const;

  if (projectQ.isLoading) return <div className="text-muted-foreground py-8">載入中…</div>;
  if (!projectQ.data) return <div className="text-destructive py-8">找不到專案</div>;
  const project = projectQ.data;

  return (
    <div>
      <PageHeader
        title={project.name}
        description={project.goal ?? undefined}
        actions={
          <Link to="/dashboard/eip/projects"><Button variant="outline"><ChevronLeft className="w-4 h-4" />返回</Button></Link>
        }
      />

      <Tabs defaultValue="dashboard">
        <TabsList>
          <TabsTrigger value="dashboard">儀表板</TabsTrigger>
          <TabsTrigger value="tasks">任務</TabsTrigger>
          <TabsTrigger value="milestones">里程碑</TabsTrigger>
          <TabsTrigger value="members">成員</TabsTrigger>
          <TabsTrigger value="gantt">甘特</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="space-y-4">
          <div className="flex items-center gap-3">
            <span className={`inline-block w-3 h-3 rounded-full ${HEALTH_COLOR[health]}`} />
            <span className="text-sm font-medium">健康狀態：{HEALTH_LABEL[health]}</span>
            <Badge variant="outline">{PROJECT_STATUS_LABEL[project.status]}</Badge>
            {project.start_date && <span className="text-xs text-muted-foreground">{project.start_date} ～ {project.end_date ?? "未定"}</span>}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <StatBox label="任務總數" value={totalT} />
            <StatBox label="已完成" value={doneT} accent="text-emerald-600" />
            <StatBox label="進行中" value={inProgT} accent="text-blue-600" />
            <StatBox label="逾期" value={overdueT} accent={overdueT ? "text-red-600" : ""} />
            <StatBox label="完成率" value={`${completion}%`} />
          </div>

          <Card>
            <CardContent className="p-4">
              <div className="text-xs font-semibold text-muted-foreground mb-2">里程碑時間軸</div>
              {milestones.length === 0 ? (
                <div className="text-xs text-muted-foreground py-2">尚無里程碑</div>
              ) : (
                <div className="relative">
                  <div className="absolute left-3 top-2 bottom-2 w-px bg-border" />
                  <div className="space-y-3">
                    {milestones.map((m) => {
                      const overdue = m.due_date && m.due_date < todayYMD && m.status !== "done";
                      return (
                        <div key={m.id} className="flex items-start gap-3 relative">
                          <div className={`mt-1 w-3 h-3 rounded-full border-2 ${m.status === "done" ? "bg-emerald-500 border-emerald-500" : overdue ? "bg-red-500 border-red-500" : "bg-background border-muted-foreground"}`} />
                          <div className="flex-1">
                            <div className={`text-sm ${m.status === "done" ? "line-through text-muted-foreground" : ""}`}>{m.name}</div>
                            <div className="text-xs text-muted-foreground flex items-center gap-2">
                              {m.due_date ?? "無期限"}
                              <span>進度 {m.progress}%</span>
                              {overdue && <Badge variant="destructive" className="text-[10px]">逾期</Badge>}
                            </div>
                            <div className="h-1.5 bg-muted rounded-full mt-1 overflow-hidden w-48">
                              <div className="h-full bg-primary" style={{ width: `${m.progress}%` }} />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="text-xs font-semibold text-muted-foreground mb-2">成員負荷</div>
              <div className="grid gap-2 md:grid-cols-2">
                {(membersQ.data ?? []).map((pm: any) => {
                  const open = tasks.filter((t) => t.owner_id === pm.user_id && !doneStatusIds.has(t.status_id)).length;
                  const overload = open >= 5;
                  return (
                    <div key={pm.user_id} className="flex items-center justify-between p-2 rounded-md border">
                      <span className="text-sm">{userMap.get(pm.user_id)?.name ?? pm.user_id.slice(0, 6)}</span>
                      <Badge variant={overload ? "destructive" : "secondary"}>未完成 {open}{overload ? " · 過載" : ""}</Badge>
                    </div>
                  );
                })}
                {(membersQ.data ?? []).length === 0 && <div className="text-xs text-muted-foreground">無成員</div>}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tasks">
          <TaskBoard tasks={tasks} statuses={statusesQ.data ?? []} userMap={userMap} />
        </TabsContent>

        <TabsContent value="milestones">
          <MilestoneList projectId={id} tenantId={project.tenant_id} milestones={milestones} canEdit={canManageEip(appUser?.role) || appUser?.id === project.owner_id} />
        </TabsContent>

        <TabsContent value="members">
          <MembersTab projectId={id} members={membersQ.data ?? []} users={usersQ.data ?? []} canEdit={canManageEip(appUser?.role) || appUser?.id === project.owner_id} />
        </TabsContent>

        <TabsContent value="gantt">
          <GanttView tasks={tasks} milestones={milestones} project={project} doneStatusIds={doneStatusIds} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatBox({ label, value, accent }: { label: string; value: React.ReactNode; accent?: string }) {
  return (
    <Card><CardContent className="p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold mt-0.5 ${accent ?? ""}`}>{value}</div>
    </CardContent></Card>
  );
}

function TaskBoard({ tasks, statuses, userMap }: { tasks: Task[]; statuses: any[]; userMap: Map<string, AppUser> }) {
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.max(statuses.length, 1)}, minmax(220px, 1fr))` }}>
      {statuses.map((s) => {
        const col = tasks.filter((t) => t.status_id === s.id);
        return (
          <Card key={s.id}><CardContent className="p-3">
            <div className="text-xs font-semibold mb-2">{s.name} <span className="text-muted-foreground">({col.length})</span></div>
            <div className="space-y-2">
              {col.map((t) => (
                <div key={t.id} className="p-2 rounded-md border text-xs">
                  <div className="font-medium truncate">{t.title}</div>
                  <div className="text-muted-foreground mt-0.5">{userMap.get(t.owner_id)?.name ?? "—"}{t.due_date && ` · ${t.due_date}`}</div>
                </div>
              ))}
              {col.length === 0 && <div className="text-xs text-muted-foreground">—</div>}
            </div>
          </CardContent></Card>
        );
      })}
    </div>
  );
}

function MilestoneList({ projectId, tenantId, milestones, canEdit }: { projectId: string; tenantId: string; milestones: Milestone[]; canEdit: boolean }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [due, setDue] = useState("");

  const add = async () => {
    if (!name.trim()) return;
    const { error } = await supabase.from("milestone").insert({ tenant_id: tenantId, project_id: projectId, name: name.trim(), due_date: due || null, status: "pending" });
    if (error) toast.error(error.message);
    else { setName(""); setDue(""); qc.invalidateQueries({ queryKey: ["eip", "milestones", projectId] }); }
  };
  const toggle = async (m: Milestone) => {
    const next = m.status === "done" ? "pending" : "done";
    const { error } = await supabase.from("milestone").update({ status: next, progress: next === "done" ? 100 : m.progress }).eq("id", m.id);
    if (error) toast.error(error.message);
    else qc.invalidateQueries({ queryKey: ["eip", "milestones", projectId] });
  };
  const setProgress = async (m: Milestone, v: number) => {
    const { error } = await supabase.from("milestone").update({ progress: v }).eq("id", m.id);
    if (error) toast.error(error.message);
    else qc.invalidateQueries({ queryKey: ["eip", "milestones", projectId] });
  };

  return (
    <Card><CardContent className="p-4 space-y-2">
      {milestones.map((m) => (
        <div key={m.id} className="flex items-center gap-2 p-2 border rounded-md">
          <input type="checkbox" checked={m.status === "done"} onChange={() => toggle(m)} disabled={!canEdit} className="w-4 h-4" />
          <div className="flex-1">
            <div className={`text-sm ${m.status === "done" ? "line-through text-muted-foreground" : ""}`}>{m.name}</div>
            <div className="text-xs text-muted-foreground">{m.due_date ?? "無期限"}</div>
          </div>
          {canEdit && <Input type="number" min={0} max={100} value={m.progress} onChange={(e) => setProgress(m, Number(e.target.value))} className="w-20 h-8" />}
          <span className="text-xs text-muted-foreground w-12 text-right">{m.progress}%</span>
        </div>
      ))}
      {milestones.length === 0 && <div className="text-xs text-muted-foreground py-2">尚無里程碑</div>}
      {canEdit && (
        <div className="flex gap-2 pt-2">
          <Input placeholder="新增里程碑…" value={name} onChange={(e) => setName(e.target.value)} />
          <Input type="date" className="w-[150px]" value={due} onChange={(e) => setDue(e.target.value)} />
          <Button onClick={add}>新增</Button>
        </div>
      )}
    </CardContent></Card>
  );
}

function MembersTab({ projectId, members, users, canEdit }: { projectId: string; members: any[]; users: AppUser[]; canEdit: boolean }) {
  const qc = useQueryClient();
  const [pick, setPick] = useState("none");
  const userMap = new Map(users.map((u) => [u.id, u]));

  const add = async () => {
    if (pick === "none") return;
    const { error } = await supabase.from("project_member").insert({ project_id: projectId, user_id: pick, role: "member" });
    if (error) toast.error(error.message);
    else { setPick("none"); qc.invalidateQueries({ queryKey: ["eip", "project-members", projectId] }); }
  };
  const remove = async (uid: string) => {
    const { error } = await supabase.from("project_member").delete().eq("project_id", projectId).eq("user_id", uid);
    if (error) toast.error(error.message);
    else qc.invalidateQueries({ queryKey: ["eip", "project-members", projectId] });
  };

  return (
    <Card><CardContent className="p-4 space-y-3">
      <div className="flex flex-wrap gap-2">
        {members.map((pm) => (
          <Badge key={pm.user_id} variant="secondary" className="gap-1">
            {userMap.get(pm.user_id)?.name ?? pm.user_id.slice(0, 6)}
            {canEdit && <button onClick={() => remove(pm.user_id)} className="ml-1 text-muted-foreground hover:text-destructive">×</button>}
          </Badge>
        ))}
        {members.length === 0 && <span className="text-xs text-muted-foreground">無成員</span>}
      </div>
      {canEdit && (
        <div className="flex gap-2">
          <Select value={pick} onValueChange={setPick}>
            <SelectTrigger className="w-[220px]"><SelectValue placeholder="選擇成員…" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">—</SelectItem>
              {users.filter((u) => !members.some((m) => m.user_id === u.id)).map((u) => (
                <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={add}>加入</Button>
        </div>
      )}
    </CardContent></Card>
  );
}

function GanttView({ tasks, milestones, project, doneStatusIds }: { tasks: Task[]; milestones: Milestone[]; project: Project; doneStatusIds: Set<string> }) {
  // 計算時間範圍
  const dates: number[] = [];
  tasks.forEach((t) => {
    if (t.start_date) dates.push(new Date(t.start_date).getTime());
    if (t.due_date) dates.push(new Date(t.due_date).getTime());
  });
  milestones.forEach((m) => { if (m.due_date) dates.push(new Date(m.due_date).getTime()); });
  if (project.start_date) dates.push(new Date(project.start_date).getTime());
  if (project.end_date) dates.push(new Date(project.end_date).getTime());

  if (dates.length === 0) {
    return <Card><CardContent className="p-6 text-center text-muted-foreground">尚無任務或里程碑日期可供顯示</CardContent></Card>;
  }

  const min = new Date(Math.min(...dates));
  const max = new Date(Math.max(...dates));
  min.setDate(min.getDate() - 2);
  max.setDate(max.getDate() + 2);
  const totalDays = Math.max(1, Math.round((max.getTime() - min.getTime()) / 86400000));
  const dayPx = Math.max(20, Math.min(40, Math.round(900 / totalDays)));
  const totalW = totalDays * dayPx;
  const today = new Date();
  const todayOffset = Math.round((today.getTime() - min.getTime()) / 86400000);

  // 顯示每月份標尺
  const months: { x: number; label: string }[] = [];
  const cur = new Date(min); cur.setDate(1);
  while (cur <= max) {
    const x = Math.round((cur.getTime() - min.getTime()) / 86400000) * dayPx;
    months.push({ x, label: `${cur.getFullYear()}/${cur.getMonth() + 1}` });
    cur.setMonth(cur.getMonth() + 1);
  }

  const sortedTasks = [...tasks].sort((a, b) => {
    const ad = a.start_date ?? a.due_date ?? "";
    const bd = b.start_date ?? b.due_date ?? "";
    return ad.localeCompare(bd);
  });

  return (
    <Card><CardContent className="p-4">
      <div className="overflow-x-auto">
        <div style={{ width: totalW + 220, position: "relative" }}>
          {/* 月份標尺 */}
          <div className="relative h-6 border-b mb-1" style={{ marginLeft: 220 }}>
            {months.map((m, i) => (
              <div key={i} className="absolute text-[11px] text-muted-foreground" style={{ left: m.x }}>{m.label}</div>
            ))}
            {todayOffset >= 0 && todayOffset <= totalDays && (
              <div className="absolute top-0 bottom-[-2000px] w-px bg-red-400/60 z-10" style={{ left: todayOffset * dayPx }} title="今天" />
            )}
          </div>

          {sortedTasks.map((t) => {
            const start = t.start_date ? new Date(t.start_date) : t.due_date ? new Date(t.due_date) : null;
            const end = t.due_date ? new Date(t.due_date) : start;
            if (!start || !end) return null;
            const left = Math.round((start.getTime() - min.getTime()) / 86400000) * dayPx;
            const span = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
            const w = span * dayPx;
            const overdue = t.due_date && new Date(t.due_date) < today && !doneStatusIds.has(t.status_id);
            const done = doneStatusIds.has(t.status_id) || t.progress >= 100;
            const color = done ? "bg-emerald-500" : overdue ? "bg-red-500" : "bg-blue-500";
            return (
              <div key={t.id} className="flex items-center h-7 mb-1 border-b border-dashed border-border/50">
                <div className="w-[220px] pr-2 text-xs truncate">{t.title}</div>
                <div className="flex-1 relative h-full">
                  <div className={`absolute top-1 h-5 rounded ${color} opacity-80`} style={{ left, width: w }}
                    title={`${t.start_date ?? ""} ～ ${t.due_date ?? ""}`}>
                    <div className="h-full bg-white/30" style={{ width: `${100 - t.progress}%`, marginLeft: `${t.progress}%` }} />
                  </div>
                </div>
              </div>
            );
          })}

          {milestones.filter((m) => m.due_date).map((m) => {
            const d = new Date(m.due_date as string);
            const left = Math.round((d.getTime() - min.getTime()) / 86400000) * dayPx;
            return (
              <div key={m.id} className="flex items-center h-7 mb-1">
                <div className="w-[220px] pr-2 text-xs truncate text-amber-700">◆ {m.name}</div>
                <div className="flex-1 relative h-full">
                  <div className="absolute top-1.5 w-3 h-3 bg-amber-500 rotate-45" style={{ left: left - 6 }} title={m.due_date ?? ""} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="text-[11px] text-muted-foreground mt-2 flex gap-3">
        <span><span className="inline-block w-3 h-3 bg-blue-500 rounded mr-1" />進行中</span>
        <span><span className="inline-block w-3 h-3 bg-emerald-500 rounded mr-1" />完成</span>
        <span><span className="inline-block w-3 h-3 bg-red-500 rounded mr-1" />逾期</span>
        <span><span className="inline-block w-3 h-3 bg-amber-500 rotate-45 mr-1" />里程碑</span>
      </div>
    </CardContent></Card>
  );
}
