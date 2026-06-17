import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, FolderKanban, Download } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { exportToExcel } from "@/lib/eip-export";
import { supabase } from "@/integrations/supabase/client";
import { useEipUser, canManageEip } from "@/lib/eip-user";
import { DEFAULT_TENANT_ID } from "@/lib/eip-constants";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import type { Database } from "@/integrations/supabase/types";

export const Route = createFileRoute("/dashboard/eip/projects")({ component: ProjectsPage });

type Project = Database["public"]["Tables"]["project"]["Row"];
type AppUser = Database["public"]["Tables"]["app_user"]["Row"];
type Task = Database["public"]["Tables"]["task"]["Row"];
type Milestone = Database["public"]["Tables"]["milestone"]["Row"];
type ProjectStatus = Database["public"]["Enums"]["project_status"];
type MilestoneStatus = Database["public"]["Enums"]["milestone_status"];

const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  planning: "規劃中", active: "進行中", on_hold: "暫停", done: "已完成",
};
const PROJECT_STATUS_COLOR: Record<ProjectStatus, string> = {
  planning: "bg-slate-100 text-slate-700",
  active: "bg-emerald-100 text-emerald-700",
  on_hold: "bg-amber-100 text-amber-700",
  done: "bg-blue-100 text-blue-700",
};

function ProjectsPage() {
  const qc = useQueryClient();
  const { appUser } = useEipUser();
  const canCreate = canManageEip(appUser?.role);
  const [openCreate, setOpenCreate] = useState(false);
  

  const projectsQ = useQuery({
    queryKey: ["eip", "projects-full"],
    queryFn: async () => {
      const { data, error } = await supabase.from("project").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Project[];
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

  if (projectsQ.isLoading) return <div className="text-muted-foreground py-8">載入中…</div>;

  return (
    <div>
      <PageHeader title="專案"
        description="管理跨部門專案、里程碑與成員，並關聯任務與會議。"
        actions={
          <div className="flex items-center gap-2">
            <ExportProjectsBtn projects={projectsQ.data ?? []} userMap={userMap} />
            {canCreate && appUser && (
              <Button onClick={() => setOpenCreate(true)}><Plus className="w-4 h-4" />新增專案</Button>
            )}
          </div>
        }
      />
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {(projectsQ.data ?? []).map((p) => (
          <Link key={p.id} to="/dashboard/eip/projects/$id" params={{ id: p.id }}>
            <Card className="cursor-pointer hover:shadow-md transition-shadow">
              <CardContent className="p-4 space-y-2">
                <div className="flex items-start gap-2">
                  <FolderKanban className="w-4 h-4 mt-0.5 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{p.name}</div>
                    {p.goal && <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{p.goal}</div>}
                  </div>
                  <Badge className={`text-[10px] ${PROJECT_STATUS_COLOR[p.status]}`} variant="secondary">
                    {PROJECT_STATUS_LABEL[p.status]}
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground flex items-center gap-2">
                  <span>負責人：{userMap.get(p.owner_id)?.name ?? "—"}</span>
                  {p.end_date && <span>截止 {p.end_date}</span>}
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
        {(projectsQ.data ?? []).length === 0 && (
          <Card className="md:col-span-2 lg:col-span-3"><CardContent className="py-10 text-center text-muted-foreground">尚無專案</CardContent></Card>
        )}
      </div>

      {openCreate && appUser && (
        <CreateProjectDialog
          open={openCreate} onClose={() => setOpenCreate(false)} appUser={appUser} users={usersQ.data ?? []}
          onCreated={() => qc.invalidateQueries({ queryKey: ["eip", "projects-full"] })}
        />
      )}
      {selected && (
        <ProjectDetailDialog
          project={selected} users={usersQ.data ?? []} appUser={appUser} onClose={() => setSelected(null)}
          onChanged={() => qc.invalidateQueries({ queryKey: ["eip", "projects-full"] })}
        />
      )}
    </div>
  );
}

function CreateProjectDialog({
  open, onClose, appUser, users, onCreated,
}: { open: boolean; onClose: () => void; appUser: AppUser; users: AppUser[]; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [description, setDescription] = useState("");
  const [ownerId, setOwnerId] = useState(appUser.id);
  const [status, setStatus] = useState<ProjectStatus>("planning");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim()) return toast.error("請輸入專案名稱");
    setBusy(true);
    try {
      const { error } = await supabase.from("project").insert({
        tenant_id: appUser.tenant_id ?? DEFAULT_TENANT_ID,
        name: name.trim(),
        goal: goal.trim() || null,
        description: description.trim() || null,
        owner_id: ownerId,
        status,
        start_date: startDate || null,
        end_date: endDate || null,
      });
      if (error) throw error;
      toast.success("專案已建立");
      onCreated(); onClose();
    } catch (e) { toast.error(`建立失敗：${e instanceof Error ? e.message : String(e)}`); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>新增專案</DialogTitle></DialogHeader>
        <div className="grid gap-3 py-2">
          <Field label="名稱"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="目標"><Input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="一句話描述專案目標" /></Field>
          <Field label="描述"><Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="負責人">
              <Select value={ownerId} onValueChange={setOwnerId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="狀態">
              <Select value={status} onValueChange={(v) => setStatus(v as ProjectStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(PROJECT_STATUS_LABEL) as ProjectStatus[]).map((s) =>
                    <SelectItem key={s} value={s}>{PROJECT_STATUS_LABEL[s]}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="開始日"><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></Field>
            <Field label="結束日"><Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></Field>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>取消</Button>
          <Button onClick={submit} disabled={busy}>建立</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProjectDetailDialog({
  project, users, appUser, onClose, onChanged,
}: { project: Project; users: AppUser[]; appUser: AppUser | null; onClose: () => void; onChanged: () => void }) {
  const qc = useQueryClient();
  const canEdit = canManageEip(appUser?.role) || appUser?.id === project.owner_id;
  const userMap = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

  const membersQ = useQuery({
    queryKey: ["eip", "project-members", project.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("project_member").select("*").eq("project_id", project.id);
      if (error) throw error;
      return (data ?? []) as Database["public"]["Tables"]["project_member"]["Row"][];
    },
  });
  const milestonesQ = useQuery({
    queryKey: ["eip", "milestones", project.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("milestone").select("*").eq("project_id", project.id).order("due_date", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as Milestone[];
    },
  });
  const tasksQ = useQuery({
    queryKey: ["eip", "project-tasks", project.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("task").select("*").eq("project_id", project.id);
      if (error) throw error;
      return (data ?? []) as Task[];
    },
  });

  const [status, setStatus] = useState<ProjectStatus>(project.status);
  const saveStatus = async (v: ProjectStatus) => {
    setStatus(v);
    const { error } = await supabase.from("project").update({ status: v }).eq("id", project.id);
    if (error) toast.error(error.message); else { toast.success("已更新狀態"); onChanged(); }
  };

  const [newMilestone, setNewMilestone] = useState("");
  const [newMsDue, setNewMsDue] = useState("");
  const addMilestone = async () => {
    if (!newMilestone.trim() || !appUser) return;
    const { error } = await supabase.from("milestone").insert({
      tenant_id: appUser.tenant_id, project_id: project.id,
      name: newMilestone.trim(), due_date: newMsDue || null, status: "pending",
    });
    if (error) toast.error(error.message);
    else { setNewMilestone(""); setNewMsDue(""); qc.invalidateQueries({ queryKey: ["eip", "milestones", project.id] }); }
  };
  const toggleMilestone = async (m: Milestone) => {
    const next: MilestoneStatus = m.status === "done" ? "pending" : "done";
    const { error } = await supabase.from("milestone").update({ status: next }).eq("id", m.id);
    if (error) toast.error(error.message);
    else qc.invalidateQueries({ queryKey: ["eip", "milestones", project.id] });
  };

  const [newMember, setNewMember] = useState<string>("none");
  const addMember = async () => {
    if (newMember === "none") return;
    const { error } = await supabase.from("project_member").insert({ project_id: project.id, user_id: newMember, role: "member" });
    if (error) toast.error(error.message);
    else { setNewMember("none"); qc.invalidateQueries({ queryKey: ["eip", "project-members", project.id] }); }
  };
  const removeMember = async (uid: string) => {
    const { error } = await supabase.from("project_member").delete().eq("project_id", project.id).eq("user_id", uid);
    if (error) toast.error(error.message);
    else qc.invalidateQueries({ queryKey: ["eip", "project-members", project.id] });
  };

  const totalTasks = (tasksQ.data ?? []).length;
  const doneTasks = (tasksQ.data ?? []).filter((t) => t.progress >= 100).length;
  const overallProgress = totalTasks ? Math.round((doneTasks / totalTasks) * 100) : 0;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>{project.name}</DialogTitle></DialogHeader>
        <div className="grid gap-4 py-2 max-h-[70vh] overflow-y-auto pr-1">
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">負責人：</span>
            <span>{userMap.get(project.owner_id)?.name ?? "—"}</span>
            <span className="text-muted-foreground ml-3">狀態：</span>
            {canEdit ? (
              <Select value={status} onValueChange={(v) => saveStatus(v as ProjectStatus)}>
                <SelectTrigger className="h-7 w-[120px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(PROJECT_STATUS_LABEL) as ProjectStatus[]).map((s) =>
                    <SelectItem key={s} value={s}>{PROJECT_STATUS_LABEL[s]}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : (
              <Badge className={PROJECT_STATUS_COLOR[project.status]} variant="secondary">{PROJECT_STATUS_LABEL[project.status]}</Badge>
            )}
          </div>
          {project.goal && <div className="text-sm">{project.goal}</div>}
          {project.description && <div className="text-sm text-muted-foreground whitespace-pre-wrap">{project.description}</div>}

          <div>
            <div className="text-xs font-semibold text-muted-foreground mb-1">整體進度</div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-primary transition-all" style={{ width: `${overallProgress}%` }} />
            </div>
            <div className="text-xs text-muted-foreground mt-1">{doneTasks}/{totalTasks} 任務完成（{overallProgress}%）</div>
          </div>

          <div>
            <div className="text-xs font-semibold text-muted-foreground mb-2">里程碑</div>
            <div className="space-y-1.5">
              {(milestonesQ.data ?? []).map((m) => (
                <div key={m.id} className="flex items-center gap-2 p-2 rounded-md border">
                  <input type="checkbox" checked={m.status === "done"} onChange={() => toggleMilestone(m)} disabled={!canEdit} className="w-4 h-4" />
                  <span className={`flex-1 text-sm ${m.status === "done" ? "line-through text-muted-foreground" : ""}`}>{m.name}</span>
                  {m.due_date && <span className="text-xs text-muted-foreground">{m.due_date}</span>}
                </div>
              ))}
              {(milestonesQ.data ?? []).length === 0 && <div className="text-xs text-muted-foreground py-1">尚無里程碑</div>}
            </div>
            {canEdit && (
              <div className="mt-2 flex gap-2">
                <Input placeholder="新增里程碑…" value={newMilestone} onChange={(e) => setNewMilestone(e.target.value)} />
                <Input type="date" className="w-[150px]" value={newMsDue} onChange={(e) => setNewMsDue(e.target.value)} />
                <Button onClick={addMilestone}>新增</Button>
              </div>
            )}
          </div>

          <div>
            <div className="text-xs font-semibold text-muted-foreground mb-2">專案成員</div>
            <div className="flex flex-wrap gap-1.5">
              {(membersQ.data ?? []).map((pm) => (
                <Badge key={pm.user_id} variant="secondary" className="gap-1">
                  {userMap.get(pm.user_id)?.name ?? pm.user_id.slice(0, 6)}
                  {canEdit && (
                    <button onClick={() => removeMember(pm.user_id)} className="ml-1 text-muted-foreground hover:text-destructive">×</button>
                  )}
                </Badge>
              ))}
              {(membersQ.data ?? []).length === 0 && <span className="text-xs text-muted-foreground">無</span>}
            </div>
            {canEdit && (
              <div className="mt-2 flex gap-2">
                <Select value={newMember} onValueChange={setNewMember}>
                  <SelectTrigger className="w-[200px]"><SelectValue placeholder="選擇成員…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {users.filter((u) => !(membersQ.data ?? []).some((pm) => pm.user_id === u.id))
                      .map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button onClick={addMember}>加入</Button>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function ExportProjectsBtn({ projects, userMap }: { projects: Project[]; userMap: Map<string, AppUser> }) {
  const { can } = useAuth();
  if (!can("eip_projects", "export")) return null;
  return (
    <Button variant="outline" onClick={() => exportToExcel({
      filename: "EIP專案", sheetName: "專案", rows: projects,
      columns: [
        { header: "名稱", key: "name" },
        { header: "狀態", key: "status", map: (r) => PROJECT_STATUS_LABEL[r.status] ?? r.status },
        { header: "負責人", key: "owner_id", map: (r) => r.owner_id ? userMap.get(r.owner_id)?.name ?? "" : "" },
        { header: "開始", key: "start_date", map: (r) => r.start_date ?? "" },
        { header: "結束", key: "end_date", map: (r) => r.end_date ?? "" },
        { header: "描述", key: "description", map: (r) => r.description ?? "" },
        { header: "建立時間", key: "created_at", map: (r) => new Date(r.created_at).toLocaleString("zh-TW") },
      ],
    })}>
      <Download className="w-4 h-4" /> 匯出 Excel
    </Button>
  );
}
