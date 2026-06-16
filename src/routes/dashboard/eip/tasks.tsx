import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, GripVertical } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useEipUser, canManageEip } from "@/lib/eip-user";
import { DEFAULT_TENANT_ID, PRIORITY_COLOR, PRIORITY_LABEL } from "@/lib/eip-constants";
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

export const Route = createFileRoute("/dashboard/eip/tasks")({ component: TasksBoard });

type Task = Database["public"]["Tables"]["task"]["Row"];
type Status = Database["public"]["Tables"]["task_status"]["Row"];
type TaskType = Database["public"]["Tables"]["task_type"]["Row"];
type AppUser = Database["public"]["Tables"]["app_user"]["Row"];
type Department = Database["public"]["Tables"]["department"]["Row"];
type Project = Database["public"]["Tables"]["project"]["Row"];
type Priority = Database["public"]["Enums"]["task_priority"];

function TasksBoard() {
  const qc = useQueryClient();
  const { appUser } = useEipUser();
  const canCreate = canManageEip(appUser?.role) || appUser?.role === "member";

  const [filterDept, setFilterDept] = useState<string>("all");
  const [filterProject, setFilterProject] = useState<string>("all");
  const [filterOwner, setFilterOwner] = useState<string>("all");
  const [createOpen, setCreateOpen] = useState(false);

  const statusesQ = useQuery({
    queryKey: ["eip", "task_status"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("task_status")
        .select("*")
        .order("sort_order");
      if (error) throw error;
      return data as Status[];
    },
  });

  const tasksQ = useQuery({
    queryKey: ["eip", "tasks"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("task")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Task[];
    },
  });

  const usersQ = useQuery({
    queryKey: ["eip", "users"],
    queryFn: async () => {
      const { data, error } = await supabase.from("app_user").select("id,name,email,department_id,role,status,tenant_id,line_user_id,created_at,updated_at");
      if (error) throw error;
      return (data ?? []) as AppUser[];
    },
  });

  const deptsQ = useQuery({
    queryKey: ["eip", "departments"],
    queryFn: async () => {
      const { data, error } = await supabase.from("department").select("*").order("name");
      if (error) throw error;
      return (data ?? []) as Department[];
    },
  });

  const projectsQ = useQuery({
    queryKey: ["eip", "projects"],
    queryFn: async () => {
      const { data, error } = await supabase.from("project").select("*").order("name");
      if (error) throw error;
      return (data ?? []) as Project[];
    },
  });

  const typesQ = useQuery({
    queryKey: ["eip", "task_types"],
    queryFn: async () => {
      const { data, error } = await supabase.from("task_type").select("*").order("name");
      if (error) throw error;
      return (data ?? []) as TaskType[];
    },
  });

  const userMap = useMemo(() => {
    const m = new Map<string, AppUser>();
    (usersQ.data ?? []).forEach((u) => m.set(u.id, u));
    return m;
  }, [usersQ.data]);

  const filteredTasks = useMemo(() => {
    return (tasksQ.data ?? []).filter((t) => {
      if (filterDept !== "all" && t.department_id !== filterDept) return false;
      if (filterProject !== "all" && t.project_id !== filterProject) return false;
      if (filterOwner !== "all" && t.owner_id !== filterOwner) return false;
      return true;
    });
  }, [tasksQ.data, filterDept, filterProject, filterOwner]);

  const moveMutation = useMutation({
    mutationFn: async (vars: { taskId: string; toStatusId: string }) => {
      if (!appUser) throw new Error("尚未取得 EIP 身分");
      const status = (statusesQ.data ?? []).find((s) => s.id === vars.toStatusId);
      const patch: Database["public"]["Tables"]["task"]["Update"] = {
        status_id: vars.toStatusId,
      };
      if (status?.is_done_state) {
        patch.progress = 100;
        patch.completed_at = new Date().toISOString();
      } else {
        patch.completed_at = null;
      }
      const { error: upErr } = await supabase.from("task").update(patch).eq("id", vars.taskId);
      if (upErr) throw upErr;
      const { error: logErr } = await supabase.from("task_update").insert({
        task_id: vars.taskId,
        tenant_id: appUser.tenant_id,
        user_id: appUser.id,
        status_changed_to_id: vars.toStatusId,
        progress: status?.is_done_state ? 100 : null,
        comment: null,
      });
      if (logErr) throw logErr;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["eip", "tasks"] });
    },
    onError: (e) => toast.error(`更新失敗：${e instanceof Error ? e.message : String(e)}`),
  });

  const [dragId, setDragId] = useState<string | null>(null);

  if (statusesQ.isLoading || tasksQ.isLoading) {
    return <div className="text-muted-foreground py-8">載入中…</div>;
  }

  return (
    <div>
      <PageHeader
        title="任務看板"
        description="拖曳卡片可變更狀態；點擊卡片檢視詳情。"
        actions={
          canCreate && appUser ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="w-4 h-4" /> 建立任務
            </Button>
          ) : undefined
        }
      />

      {/* 篩選 */}
      <div className="flex flex-wrap gap-3 mb-4">
        <FilterSelect label="部門" value={filterDept} onChange={setFilterDept}
          options={[{ value: "all", label: "全部部門" }, ...(deptsQ.data ?? []).map((d) => ({ value: d.id, label: d.name }))]}
        />
        <FilterSelect label="專案" value={filterProject} onChange={setFilterProject}
          options={[{ value: "all", label: "全部專案" }, ...(projectsQ.data ?? []).map((p) => ({ value: p.id, label: p.name }))]}
        />
        <FilterSelect label="負責人" value={filterOwner} onChange={setFilterOwner}
          options={[{ value: "all", label: "全部負責人" }, ...(usersQ.data ?? []).map((u) => ({ value: u.id, label: u.name }))]}
        />
      </div>

      <div className="grid gap-3 overflow-x-auto" style={{ gridTemplateColumns: `repeat(${(statusesQ.data ?? []).length}, minmax(260px, 1fr))` }}>
        {(statusesQ.data ?? []).map((s) => {
          const colTasks = filteredTasks.filter((t) => t.status_id === s.id);
          return (
            <div
              key={s.id}
              className="bg-muted/40 rounded-lg p-2 min-h-[420px]"
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragId) moveMutation.mutate({ taskId: dragId, toStatusId: s.id });
                setDragId(null);
              }}
            >
              <div className="flex items-center justify-between px-2 py-1.5 mb-2">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm">{s.name}</span>
                  {s.is_done_state && <Badge variant="secondary" className="text-[10px]">完成</Badge>}
                </div>
                <span className="text-xs text-muted-foreground">{colTasks.length}</span>
              </div>
              <div className="space-y-2">
                {colTasks.map((t) => (
                  <TaskCard
                    key={t.id}
                    task={t}
                    owner={userMap.get(t.owner_id)}
                    onDragStart={() => setDragId(t.id)}
                  />
                ))}
                {colTasks.length === 0 && (
                  <div className="text-xs text-muted-foreground px-2 py-6 text-center border border-dashed rounded-md">
                    無任務
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {createOpen && appUser && (
        <CreateTaskDialog
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          appUser={appUser}
          statuses={statusesQ.data ?? []}
          users={usersQ.data ?? []}
          departments={deptsQ.data ?? []}
          projects={projectsQ.data ?? []}
          types={typesQ.data ?? []}
          onCreated={() => qc.invalidateQueries({ queryKey: ["eip", "tasks"] })}
        />
      )}
    </div>
  );
}

function FilterSelect({
  label, value, onChange, options,
}: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex items-center gap-2">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 w-[160px]"><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function TaskCard({
  task, owner, onDragStart,
}: { task: Task; owner: AppUser | undefined; onDragStart: () => void }) {
  const overdue =
    task.due_date && new Date(task.due_date) < new Date(new Date().toDateString()) && task.progress < 100;
  return (
    <Card
      draggable
      onDragStart={onDragStart}
      className="cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow"
    >
      <CardContent className="p-3 space-y-2">
        <div className="flex items-start gap-2">
          <GripVertical className="w-3.5 h-3.5 mt-0.5 text-muted-foreground shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium leading-snug line-clamp-2">{task.title}</div>
          </div>
          <Badge className={`text-[10px] ${PRIORITY_COLOR[task.priority]}`} variant="secondary">
            {PRIORITY_LABEL[task.priority]}
          </Badge>
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="truncate">{owner?.name ?? "未指派"}</span>
          {task.due_date && (
            <span className={overdue ? "text-destructive font-medium" : ""}>
              {new Date(task.due_date).toLocaleDateString("zh-TW", { month: "2-digit", day: "2-digit" })}
            </span>
          )}
        </div>
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div className="h-full bg-primary transition-all" style={{ width: `${task.progress}%` }} />
        </div>
      </CardContent>
    </Card>
  );
}

function CreateTaskDialog({
  open, onClose, appUser, statuses, users, departments, projects, types, onCreated,
}: {
  open: boolean; onClose: () => void; appUser: AppUser;
  statuses: Status[]; users: AppUser[]; departments: Department[]; projects: Project[]; types: TaskType[];
  onCreated: () => void;
}) {
  const defaultStatusId =
    statuses.find((s) => !s.is_done_state)?.id ?? statuses[0]?.id ?? "";
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [typeId, setTypeId] = useState<string>("none");
  const [ownerId, setOwnerId] = useState<string>(appUser.id);
  const [deptId, setDeptId] = useState<string>(appUser.department_id ?? "none");
  const [projectId, setProjectId] = useState<string>("none");
  const [priority, setPriority] = useState<Priority>("normal");
  const [dueDate, setDueDate] = useState<string>("");
  const [collaborators, setCollaborators] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!title.trim()) return toast.error("請輸入標題");
    setBusy(true);
    try {
      const { data: created, error: createErr } = await supabase
        .from("task")
        .insert({
          tenant_id: appUser.tenant_id ?? DEFAULT_TENANT_ID,
          title: title.trim(),
          description: description.trim() || null,
          type_id: typeId === "none" ? null : typeId,
          owner_id: ownerId,
          department_id: deptId === "none" ? null : deptId,
          project_id: projectId === "none" ? null : projectId,
          priority,
          status_id: defaultStatusId,
          progress: 0,
          due_date: dueDate || null,
          created_by: appUser.id,
        })
        .select("*")
        .single();
      if (createErr) throw createErr;
      const parentId = (created as Task).id;

      // 協作者
      if (collaborators.length) {
        const { error: cErr } = await supabase
          .from("task_collaborator")
          .insert(collaborators.map((uid) => ({ task_id: parentId, user_id: uid })));
        if (cErr) throw cErr;
      }

      // 任務類型 default_steps → 子任務
      const t = types.find((x) => x.id === typeId);
      const steps = Array.isArray(t?.default_steps) ? (t!.default_steps as unknown as string[]) : [];
      if (steps.length) {
        const rows = steps
          .filter((s) => typeof s === "string" && s.trim().length > 0)
          .map((s) => ({
            tenant_id: appUser.tenant_id,
            title: s,
            owner_id: ownerId,
            status_id: defaultStatusId,
            priority: "normal" as Priority,
            progress: 0,
            parent_task_id: parentId,
            project_id: projectId === "none" ? null : projectId,
            department_id: deptId === "none" ? null : deptId,
            created_by: appUser.id,
          }));
        if (rows.length) {
          const { error: subErr } = await supabase.from("task").insert(rows);
          if (subErr) throw subErr;
        }
      }

      toast.success("任務已建立");
      onCreated();
      onClose();
    } catch (e) {
      toast.error(`建立失敗：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>建立任務</DialogTitle></DialogHeader>
        <div className="grid gap-3 py-2 max-h-[60vh] overflow-y-auto pr-1">
          <Field label="標題">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="任務標題" />
          </Field>
          <Field label="描述">
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="類型">
              <Select value={typeId} onValueChange={setTypeId}>
                <SelectTrigger><SelectValue placeholder="選擇類型" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">無</SelectItem>
                  {types.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="優先級">
              <Select value={priority} onValueChange={(v) => setPriority(v as Priority)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(["low", "normal", "high", "urgent"] as Priority[]).map((p) =>
                    <SelectItem key={p} value={p}>{PRIORITY_LABEL[p]}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="負責人">
              <Select value={ownerId} onValueChange={setOwnerId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="部門">
              <Select value={deptId} onValueChange={setDeptId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">無</SelectItem>
                  {departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="專案">
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">無</SelectItem>
                  {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="期限">
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </Field>
          </div>
          <Field label="協作者">
            <div className="flex flex-wrap gap-2 p-2 border rounded-md max-h-32 overflow-y-auto">
              {users.filter((u) => u.id !== ownerId).map((u) => {
                const on = collaborators.includes(u.id);
                return (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() =>
                      setCollaborators((s) => on ? s.filter((x) => x !== u.id) : [...s, u.id])
                    }
                    className={`text-xs px-2 py-1 rounded border ${on ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-accent"}`}
                  >
                    {u.name}
                  </button>
                );
              })}
              {users.length <= 1 && (
                <span className="text-xs text-muted-foreground">尚無其他 EIP 成員</span>
              )}
            </div>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>取消</Button>
          <Button onClick={submit} disabled={busy}>{busy ? "建立中…" : "建立"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
