import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState, useEffect } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, GripVertical, Download, Paperclip, ListChecks, Repeat, SlidersHorizontal, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger, SheetTitle, SheetHeader } from "@/components/ui/sheet";

import { supabase } from "@/integrations/supabase/client";
import { useEipUser, canManageEip } from "@/lib/eip-user";
import { useAuth } from "@/lib/auth";
import { DEFAULT_TENANT_ID, PRIORITY_COLOR, PRIORITY_LABEL } from "@/lib/eip-constants";
import { exportToExcel } from "@/lib/eip-export";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Database } from "@/integrations/supabase/types";
import { RecurringReportDialog } from "@/components/eip/RecurringReportDialog";

function canEditTask(task: Task, appUser: AppUser | null): boolean {
  if (!appUser) return false;
  if (appUser.role === "company_admin") return true;
  if (appUser.role === "dept_manager" && task.department_id && task.department_id === appUser.department_id) return true;
  if (task.owner_id === appUser.id) return true;
  return false;
}
function canDeleteTask(task: Task, appUser: AppUser | null): boolean {
  if (!appUser) return false;
  if (appUser.role === "company_admin") return true;
  if (appUser.role === "dept_manager" && task.department_id && task.department_id === appUser.department_id) return true;
  return false;
}

export const Route = createFileRoute("/dashboard/eip/tasks")({ component: TasksPage });

type Task = Database["public"]["Tables"]["task"]["Row"];
type Status = Database["public"]["Tables"]["task_status"]["Row"];
type TaskType = Database["public"]["Tables"]["task_type"]["Row"];
type AppUser = Database["public"]["Tables"]["app_user"]["Row"];
type Department = Database["public"]["Tables"]["department"]["Row"];
type Project = Database["public"]["Tables"]["project"]["Row"];
type Priority = Database["public"]["Enums"]["task_priority"];

const ALL_PRIORITIES: Priority[] = ["low", "normal", "high", "urgent"];

function TasksPage() {
  const qc = useQueryClient();
  const { appUser } = useEipUser();
  const { can } = useAuth();
  const canCreate = canManageEip(appUser?.role) || appUser?.role === "member";
  const canExport = can("eip_tasks", "export");

  // 共用篩選 state
  const [filterDept, setFilterDept] = useState("all");
  const [filterProject, setFilterProject] = useState("all");
  const [filterOwner, setFilterOwner] = useState("all");
  const [filterPriority, setFilterPriority] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [dueFrom, setDueFrom] = useState("");
  const [dueTo, setDueTo] = useState("");
  const [keyword, setKeyword] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [detailTask, setDetailTask] = useState<Task | null>(null);
  const [deleteTask, setDeleteTask] = useState<Task | null>(null);
  const [deleting, setDeleting] = useState(false);

  const statusesQ = useQuery({
    queryKey: ["eip", "task_status"],
    queryFn: async () => {
      const { data, error } = await supabase.from("task_status").select("*").order("sort_order");
      if (error) throw error;
      return data as Status[];
    },
  });

  const tasksQ = useQuery({
    queryKey: ["eip", "tasks-full"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("task")
        .select("*")
        .order("board_position", { ascending: true })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Task[];
    },
  });

  const subtasksQ = useQuery({
    queryKey: ["eip", "tasks-subcount"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("task")
        .select("id,parent_task_id,status_id")
        .not("parent_task_id", "is", null);
      if (error) throw error;
      return data ?? [];
    },
  });

  const usersQ = useQuery({
    queryKey: ["eip", "users"],
    queryFn: async () => {
      const { data, error } = await supabase.from("app_user").select("*");
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

  const userMap = useMemo(() => new Map((usersQ.data ?? []).map((u) => [u.id, u])), [usersQ.data]);
  const statusMap = useMemo(() => new Map((statusesQ.data ?? []).map((s) => [s.id, s])), [statusesQ.data]);
  const projectMap = useMemo(() => new Map((projectsQ.data ?? []).map((p) => [p.id, p])), [projectsQ.data]);
  const deptMap = useMemo(() => new Map((deptsQ.data ?? []).map((d) => [d.id, d])), [deptsQ.data]);

  const subtaskMap = useMemo(() => {
    const m = new Map<string, { total: number; done: number }>();
    const doneIds = new Set((statusesQ.data ?? []).filter((s) => s.is_done_state).map((s) => s.id));
    (subtasksQ.data ?? []).forEach((s: any) => {
      const cur = m.get(s.parent_task_id) ?? { total: 0, done: 0 };
      cur.total++;
      if (doneIds.has(s.status_id)) cur.done++;
      m.set(s.parent_task_id, cur);
    });
    return m;
  }, [subtasksQ.data, statusesQ.data]);

  const filteredTasks = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return (tasksQ.data ?? []).filter((t) => {
      if (t.parent_task_id) return false; // 不在主清單顯示子任務
      if (filterDept !== "all" && t.department_id !== filterDept) return false;
      if (filterProject !== "all" && t.project_id !== filterProject) return false;
      if (filterOwner !== "all" && t.owner_id !== filterOwner) return false;
      if (filterPriority !== "all" && t.priority !== filterPriority) return false;
      if (filterStatus !== "all" && t.status_id !== filterStatus) return false;
      if (dueFrom && (!t.due_date || t.due_date < dueFrom)) return false;
      if (dueTo && (!t.due_date || t.due_date > dueTo)) return false;
      if (kw) {
        const hay = `${t.title} ${t.description ?? ""}`.toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });
  }, [tasksQ.data, filterDept, filterProject, filterOwner, filterPriority, filterStatus, dueFrom, dueTo, keyword]);

  const moveMutation = useMutation({
    mutationFn: async (vars: { taskId: string; toStatusId: string; newPosition: number }) => {
      if (!appUser) throw new Error("尚未取得 EIP 身分");
      const status = (statusesQ.data ?? []).find((s) => s.id === vars.toStatusId);
      const patch: Database["public"]["Tables"]["task"]["Update"] = {
        status_id: vars.toStatusId,
        board_position: vars.newPosition,
      };
      if (status?.is_done_state) {
        patch.progress = 100;
        patch.completed_at = new Date().toISOString();
      } else {
        patch.completed_at = null;
      }
      const { error } = await supabase.from("task").update(patch).eq("id", vars.taskId);
      if (error) throw error;
      await supabase.from("task_update").insert({
        task_id: vars.taskId,
        tenant_id: appUser.tenant_id,
        user_id: appUser.id,
        status_changed_to_id: vars.toStatusId,
        progress: status?.is_done_state ? 100 : null,
        comment: null,
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["eip", "tasks-full"] }),
    onError: (e) => toast.error(`更新失敗：${e instanceof Error ? e.message : String(e)}`),
  });

  const handleExport = () => {
    exportToExcel({
      filename: "EIP任務",
      sheetName: "任務",
      rows: filteredTasks,
      columns: [
        { header: "標題", key: "title" },
        { header: "狀態", key: "status_id", map: (r) => statusMap.get(r.status_id)?.name ?? "" },
        { header: "優先級", key: "priority", map: (r) => PRIORITY_LABEL[r.priority] ?? r.priority },
        { header: "進度(%)", key: "progress" },
        { header: "負責人", key: "owner_id", map: (r) => userMap.get(r.owner_id)?.name ?? "" },
        { header: "部門", key: "department_id", map: (r) => (r.department_id ? deptMap.get(r.department_id)?.name ?? "" : "") },
        { header: "專案", key: "project_id", map: (r) => (r.project_id ? projectMap.get(r.project_id)?.name ?? "" : "") },
        { header: "期限", key: "due_date", map: (r) => r.due_date ?? "" },
        { header: "建立時間", key: "created_at", map: (r) => new Date(r.created_at).toLocaleString("zh-TW") },
        { header: "描述", key: "description", map: (r) => r.description ?? "" },
      ],
    });
  };

  if (statusesQ.isLoading || tasksQ.isLoading) {
    return <div className="text-muted-foreground py-8">載入中…</div>;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="任務"
        description="支援看板 / 列表 / 行事曆三種視圖，所有篩選共用。"
        actions={
          <div className="flex items-center gap-2">
            {canExport && (
              <Button variant="outline" onClick={handleExport}>
                <Download className="w-4 h-4" /> 匯出 Excel
              </Button>
            )}
            {canCreate && appUser && (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="w-4 h-4" /> 建立任務
              </Button>
            )}
          </div>
        }
      />

      <SharedFilters
        keyword={keyword} setKeyword={setKeyword}
        filterDept={filterDept} setFilterDept={setFilterDept}
        filterProject={filterProject} setFilterProject={setFilterProject}
        filterOwner={filterOwner} setFilterOwner={setFilterOwner}
        filterPriority={filterPriority} setFilterPriority={setFilterPriority}
        filterStatus={filterStatus} setFilterStatus={setFilterStatus}
        dueFrom={dueFrom} setDueFrom={setDueFrom}
        dueTo={dueTo} setDueTo={setDueTo}
        statuses={statusesQ.data ?? []}
        users={usersQ.data ?? []}
        departments={deptsQ.data ?? []}
        projects={projectsQ.data ?? []}
      />

      <Tabs defaultValue="board">
        <TabsList>
          <TabsTrigger value="board">看板</TabsTrigger>
          <TabsTrigger value="list">列表</TabsTrigger>
          <TabsTrigger value="calendar">行事曆</TabsTrigger>
        </TabsList>

        <TabsContent value="board" className="mt-3">
          <BoardView
            tasks={filteredTasks}
            statuses={statusesQ.data ?? []}
            userMap={userMap}
            subtaskMap={subtaskMap}
            appUser={appUser}
            onMove={(taskId, toStatusId, newPosition) =>
              moveMutation.mutate({ taskId, toStatusId, newPosition })
            }
            onOpenDetail={(t) => setDetailTask(t)}
            onAskDelete={(t) => setDeleteTask(t)}
          />
        </TabsContent>

        <TabsContent value="list" className="mt-3">
          <ListView
            tasks={filteredTasks}
            statusMap={statusMap}
            userMap={userMap}
            projectMap={projectMap}
            statuses={statusesQ.data ?? []}
            users={usersQ.data ?? []}
            appUser={appUser}
            canManage={canManageEip(appUser?.role)}
            onChanged={() => qc.invalidateQueries({ queryKey: ["eip", "tasks-full"] })}
          />
        </TabsContent>

        <TabsContent value="calendar" className="mt-3">
          <CalendarView tasks={filteredTasks} statusMap={statusMap} userMap={userMap} />
        </TabsContent>
      </Tabs>

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
          onCreated={() => qc.invalidateQueries({ queryKey: ["eip", "tasks-full"] })}
        />
      )}

      {detailTask && (
        <EditTaskDialog
          key={detailTask.id}
          task={detailTask}
          readOnly={!canEditTask(detailTask, appUser)}
          onClose={() => setDetailTask(null)}
          statuses={statusesQ.data ?? []}
          users={usersQ.data ?? []}
          departments={deptsQ.data ?? []}
          projects={projectsQ.data ?? []}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["eip", "tasks-full"] });
            setDetailTask(null);
          }}
        />
      )}

      <AlertDialog open={!!deleteTask} onOpenChange={(o) => !o && !deleting && setDeleteTask(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>確定刪除任務？</AlertDialogTitle>
            <AlertDialogDescription>
              即將刪除「{deleteTask?.title}」。刪除後無法復原。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async (e) => {
                e.preventDefault();
                if (!deleteTask) return;
                setDeleting(true);
                const { error } = await supabase.from("task").delete().eq("id", deleteTask.id);
                setDeleting(false);
                if (error) {
                  toast.error(`刪除失敗：${error.message}`);
                  return;
                }
                toast.success("任務已刪除");
                setDeleteTask(null);
                qc.invalidateQueries({ queryKey: ["eip", "tasks-full"] });
              }}
            >
              {deleting ? "刪除中…" : "確認刪除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ============ 共用篩選 ============ */
function SharedFilters(props: {
  keyword: string; setKeyword: (v: string) => void;
  filterDept: string; setFilterDept: (v: string) => void;
  filterProject: string; setFilterProject: (v: string) => void;
  filterOwner: string; setFilterOwner: (v: string) => void;
  filterPriority: string; setFilterPriority: (v: string) => void;
  filterStatus: string; setFilterStatus: (v: string) => void;
  dueFrom: string; setDueFrom: (v: string) => void;
  dueTo: string; setDueTo: (v: string) => void;
  statuses: Status[]; users: AppUser[]; departments: Department[]; projects: Project[];
}) {
  const [open, setOpen] = useState(false);
  const activeCount = [
    props.filterStatus !== "all",
    props.filterPriority !== "all",
    props.filterDept !== "all",
    props.filterProject !== "all",
    props.filterOwner !== "all",
    !!props.dueFrom,
    !!props.dueTo,
  ].filter(Boolean).length;

  const filterFields = (
    <div className="grid gap-3">
      <MiniSelect value={props.filterStatus} onChange={props.setFilterStatus}
        options={[{ value: "all", label: "全部狀態" }, ...props.statuses.map((s) => ({ value: s.id, label: s.name }))]} />
      <MiniSelect value={props.filterPriority} onChange={props.setFilterPriority}
        options={[{ value: "all", label: "全部優先級" }, ...ALL_PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))]} />
      <MiniSelect value={props.filterDept} onChange={props.setFilterDept}
        options={[{ value: "all", label: "全部部門" }, ...props.departments.map((d) => ({ value: d.id, label: d.name }))]} />
      <MiniSelect value={props.filterProject} onChange={props.setFilterProject}
        options={[{ value: "all", label: "全部專案" }, ...props.projects.map((p) => ({ value: p.id, label: p.name }))]} />
      <MiniSelect value={props.filterOwner} onChange={props.setFilterOwner}
        options={[{ value: "all", label: "全部負責人" }, ...props.users.map((u) => ({ value: u.id, label: u.name }))]} />
      <div className="grid gap-1">
        <Input type="date" value={props.dueFrom} onChange={(e) => props.setDueFrom(e.target.value)} className="h-9 w-full" />
        <span className="text-xs text-muted-foreground text-center">至</span>
        <Input type="date" value={props.dueTo} onChange={(e) => props.setDueTo(e.target.value)} className="h-9 w-full" />
      </div>
    </div>
  );

  return (
    <Card>
      <CardContent className="p-3">
        {/* < lg：搜尋 + 篩選按鈕(Sheet) */}
        <div className="flex gap-2 lg:hidden">
          <Input placeholder="搜尋標題 / 描述" value={props.keyword}
            onChange={(e) => props.setKeyword(e.target.value)} className="flex-1 min-w-0" />
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" className="shrink-0">
                <SlidersHorizontal className="w-4 h-4" />
                篩選{activeCount > 0 && <Badge variant="secondary" className="ml-1">{activeCount}</Badge>}
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[90vw] sm:w-[400px] overflow-y-auto">
              <SheetHeader><SheetTitle>篩選條件</SheetTitle></SheetHeader>
              <div className="mt-4">{filterFields}</div>
              <div className="mt-4 flex justify-end">
                <Button onClick={() => setOpen(false)}>完成</Button>
              </div>
            </SheetContent>
          </Sheet>
        </div>

        {/* ≥ lg：grid 完整展開 */}
        <div className="hidden lg:grid gap-2 lg:grid-cols-3 xl:grid-cols-5">
          <Input placeholder="搜尋標題 / 描述" value={props.keyword}
            onChange={(e) => props.setKeyword(e.target.value)} className="w-full" />
          <MiniSelect value={props.filterStatus} onChange={props.setFilterStatus}
            options={[{ value: "all", label: "全部狀態" }, ...props.statuses.map((s) => ({ value: s.id, label: s.name }))]} />
          <MiniSelect value={props.filterPriority} onChange={props.setFilterPriority}
            options={[{ value: "all", label: "全部優先級" }, ...ALL_PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))]} />
          <MiniSelect value={props.filterDept} onChange={props.setFilterDept}
            options={[{ value: "all", label: "全部部門" }, ...props.departments.map((d) => ({ value: d.id, label: d.name }))]} />
          <MiniSelect value={props.filterProject} onChange={props.setFilterProject}
            options={[{ value: "all", label: "全部專案" }, ...props.projects.map((p) => ({ value: p.id, label: p.name }))]} />
          <MiniSelect value={props.filterOwner} onChange={props.setFilterOwner}
            options={[{ value: "all", label: "全部負責人" }, ...props.users.map((u) => ({ value: u.id, label: u.name }))]} />
          <div className="flex items-center gap-1 xl:col-span-2 min-w-0">
            <Input type="date" value={props.dueFrom} onChange={(e) => props.setDueFrom(e.target.value)} className="h-9 w-full" />
            <span className="text-xs text-muted-foreground shrink-0">至</span>
            <Input type="date" value={props.dueTo} onChange={(e) => props.setDueTo(e.target.value)} className="h-9 w-full" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}


function MiniSelect({ value, onChange, options }: {
  value: string; onChange: (v: string) => void; options: { value: string; label: string }[];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
      <SelectContent>
        {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/* ============ 看板視圖 ============ */
function BoardView({
  tasks, statuses, userMap, subtaskMap, appUser, onMove, onOpenDetail, onAskDelete,
}: {
  tasks: Task[]; statuses: Status[];
  userMap: Map<string, AppUser>;
  subtaskMap: Map<string, { total: number; done: number }>;
  appUser: AppUser | null;
  onMove: (taskId: string, toStatusId: string, newPosition: number) => void;
  onOpenDetail: (t: Task) => void;
  onAskDelete: (t: Task) => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);

  const colTasks = (statusId: string) =>
    tasks.filter((t) => t.status_id === statusId)
      .sort((a, b) => a.board_position - b.board_position);

  const handleColumnDrop = (statusId: string, beforeId?: string) => {
    if (!dragId) return;
    const list = colTasks(statusId).filter((t) => t.id !== dragId);
    const idx = beforeId ? list.findIndex((t) => t.id === beforeId) : list.length;
    const prev = idx > 0 ? list[idx - 1].board_position : 0;
    const next = idx < list.length ? list[idx].board_position : prev + 2;
    const newPos = (prev + next) / 2;
    onMove(dragId, statusId, newPos);
    setDragId(null);
  };

  return (
    <div className="grid gap-3 overflow-x-auto"
      style={{ gridTemplateColumns: `repeat(${statuses.length}, minmax(260px, 1fr))` }}>
      {statuses.map((s) => {
        const list = colTasks(s.id);
        return (
          <div key={s.id}
            className="bg-muted/40 rounded-lg p-2 min-h-[420px]"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); handleColumnDrop(s.id); }}>
            <div className="flex items-center justify-between px-2 py-1.5 mb-2">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm">{s.name}</span>
                {s.is_done_state && <Badge variant="secondary" className="text-[10px]">完成</Badge>}
              </div>
              <span className="text-xs text-muted-foreground">{list.length}</span>
            </div>
            <div className="space-y-2 max-h-[calc(100vh-360px)] overflow-y-auto pr-1">
              {list.map((t) => (
                <div key={t.id}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); e.stopPropagation(); handleColumnDrop(s.id, t.id); }}>
                  <TaskCard task={t} owner={userMap.get(t.owner_id)}
                    subtask={subtaskMap.get(t.id)}
                    canEdit={canEditTask(t, appUser)}
                    canDelete={canDeleteTask(t, appUser)}
                    onDragStart={() => setDragId(t.id)}
                    onOpenDetail={() => onOpenDetail(t)}
                    onAskDelete={() => onAskDelete(t)} />
                </div>
              ))}
              {list.length === 0 && (
                <div className="text-xs text-muted-foreground px-2 py-6 text-center border border-dashed rounded-md">
                  無任務
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TaskCard({ task, owner, subtask, canEdit, canDelete, onDragStart, onOpenDetail, onAskDelete }: {
  task: Task; owner?: AppUser;
  subtask?: { total: number; done: number };
  canEdit: boolean; canDelete: boolean;
  onDragStart: () => void;
  onOpenDetail: () => void;
  onAskDelete: () => void;
}) {
  const [reportOpen, setReportOpen] = useState(false);
  const overdue = task.due_date &&
    new Date(task.due_date) < new Date(new Date().toDateString()) && task.progress < 100;
  const initial = owner?.name ? owner.name.slice(0, 1) : "?";
  const showMenu = canEdit || canDelete;
  return (
    <Card draggable onDragStart={onDragStart}
      onClick={onOpenDetail}
      className="cursor-pointer hover:shadow-md transition-shadow">
      <CardContent className="p-3 space-y-2">
        <div className="flex items-start gap-2">
          <GripVertical className="w-3.5 h-3.5 mt-0.5 text-muted-foreground shrink-0 cursor-grab active:cursor-grabbing" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium leading-snug line-clamp-2">{task.title}</div>
          </div>
          {task.recurring_rule_id && (
            <Badge variant="outline" className="text-[10px] gap-0.5"><Repeat className="w-2.5 h-2.5" />週期</Badge>
          )}
          <Badge className={`text-[10px] ${PRIORITY_COLOR[task.priority]}`} variant="secondary">
            {PRIORITY_LABEL[task.priority]}
          </Badge>
          {showMenu && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  onClick={(e) => e.stopPropagation()}
                  className="h-6 w-6 inline-flex items-center justify-center rounded hover:bg-accent text-muted-foreground shrink-0"
                  aria-label="更多操作"
                >
                  <MoreHorizontal className="w-3.5 h-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                {canEdit && (
                  <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onOpenDetail(); }}>
                    <Pencil className="w-3.5 h-3.5 mr-2" /> 編輯
                  </DropdownMenuItem>
                )}
                {canDelete && (
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={(e) => { e.stopPropagation(); onAskDelete(); }}
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-2" /> 刪除
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5 min-w-0">
            <div className="w-5 h-5 rounded-full bg-primary/15 text-primary text-[10px] flex items-center justify-center shrink-0">
              {initial}
            </div>
            <span className="truncate">{owner?.name ?? "未指派"}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {subtask && subtask.total > 0 && (
              <span className="flex items-center gap-0.5">
                <ListChecks className="w-3 h-3" /> {subtask.done}/{subtask.total}
              </span>
            )}
            {task.due_date && (
              <span className={overdue ? "text-destructive font-medium" : ""}>
                {overdue && "🚩 "}
                {new Date(task.due_date).toLocaleDateString("zh-TW", { month: "2-digit", day: "2-digit" })}
              </span>
            )}
          </div>
        </div>
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div className="h-full bg-primary transition-all" style={{ width: `${task.progress}%` }} />
        </div>
        {task.recurring_rule_id && task.progress < 100 && (
          <Button size="sm" variant="outline" className="w-full h-7 text-xs"
            onClick={(e) => { e.stopPropagation(); setReportOpen(true); }}>
            週期回報
          </Button>
        )}
      </CardContent>
      {reportOpen && task.recurring_rule_id && (
        <RecurringReportDialog
          open={reportOpen}
          onClose={() => setReportOpen(false)}
          taskId={task.id}
          recurringRuleId={task.recurring_rule_id}
          initialData={task.report_data as Record<string, unknown> | null}
        />
      )}
    </Card>
  );
}

/* ============ 列表視圖 ============ */
type SortKey = "title" | "owner" | "status" | "priority" | "progress" | "due" | "project";

function ListView({
  tasks, statusMap, userMap, projectMap, statuses, users, appUser, canManage, onChanged,
}: {
  tasks: Task[];
  statusMap: Map<string, Status>; userMap: Map<string, AppUser>; projectMap: Map<string, Project>;
  statuses: Status[]; users: AppUser[];
  appUser: AppUser | null; canManage: boolean;
  onChanged: () => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("due");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkOwner, setBulkOwner] = useState("");
  const [bulkDue, setBulkDue] = useState("");

  const sorted = useMemo(() => {
    const list = [...tasks];
    const dir = sortDir === "asc" ? 1 : -1;
    list.sort((a, b) => {
      const getVal = (t: Task): string | number => {
        switch (sortKey) {
          case "title": return t.title;
          case "owner": return userMap.get(t.owner_id)?.name ?? "";
          case "status": return statusMap.get(t.status_id)?.sort_order ?? 0;
          case "priority": return ALL_PRIORITIES.indexOf(t.priority);
          case "progress": return t.progress;
          case "due": return t.due_date ?? "9999-12-31";
          case "project": return t.project_id ? projectMap.get(t.project_id)?.name ?? "" : "";
        }
      };
      const va = getVal(a), vb = getVal(b);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
    return list;
  }, [tasks, sortKey, sortDir, userMap, statusMap, projectMap]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const paged = sorted.slice((page - 1) * pageSize, page * pageSize);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("asc"); }
  };

  const allChecked = paged.length > 0 && paged.every((t) => selected.has(t.id));
  const toggleAll = () => {
    const s = new Set(selected);
    if (allChecked) paged.forEach((t) => s.delete(t.id));
    else paged.forEach((t) => s.add(t.id));
    setSelected(s);
  };

  const applyBulk = async () => {
    if (!selected.size) return toast.error("請先勾選任務");
    const patch: Database["public"]["Tables"]["task"]["Update"] = {};
    if (bulkStatus) patch.status_id = bulkStatus;
    if (bulkOwner) patch.owner_id = bulkOwner;
    if (bulkDue) patch.due_date = bulkDue;
    if (!Object.keys(patch).length) return toast.error("請選擇要套用的欄位");
    const ids = Array.from(selected);
    const { error } = await supabase.from("task").update(patch).in("id", ids);
    if (error) return toast.error(error.message);
    toast.success(`已更新 ${ids.length} 筆`);
    setSelected(new Set()); setBulkStatus(""); setBulkOwner(""); setBulkDue("");
    onChanged();
  };

  const canBulk = canManage || appUser?.role === "member";

  return (
    <div className="space-y-3">
      {canBulk && selected.size > 0 && (
        <Card>
          <CardContent className="p-3 flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">已選 {selected.size} 筆</span>
            <Select value={bulkStatus} onValueChange={setBulkStatus}>
              <SelectTrigger className="h-9 w-36"><SelectValue placeholder="改狀態" /></SelectTrigger>
              <SelectContent>
                {statuses.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={bulkOwner} onValueChange={setBulkOwner}>
              <SelectTrigger className="h-9 w-40"><SelectValue placeholder="改負責人" /></SelectTrigger>
              <SelectContent>
                {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input type="date" value={bulkDue} onChange={(e) => setBulkDue(e.target.value)} className="h-9 w-40" placeholder="改期限" />
            <Button size="sm" onClick={applyBulk}>套用</Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>清除</Button>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {canBulk && (
                  <TableHead className="w-10">
                    <Checkbox checked={allChecked} onCheckedChange={toggleAll} />
                  </TableHead>
                )}
                <ThSort label="標題" k="title" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <ThSort label="負責人" k="owner" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <ThSort label="狀態" k="status" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <ThSort label="優先級" k="priority" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <ThSort label="進度" k="progress" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <ThSort label="期限" k="due" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <ThSort label="專案" k="project" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {paged.map((t) => {
                const overdue = t.due_date && new Date(t.due_date) < new Date(new Date().toDateString()) && t.progress < 100;
                return (
                  <TableRow key={t.id} className={overdue ? "text-destructive" : ""}>
                    {canBulk && (
                      <TableCell>
                        <Checkbox
                          checked={selected.has(t.id)}
                          onCheckedChange={(v) => {
                            const s = new Set(selected);
                            if (v) s.add(t.id); else s.delete(t.id);
                            setSelected(s);
                          }}
                        />
                      </TableCell>
                    )}
                    <TableCell className="text-sm font-medium">{t.title}</TableCell>
                    <TableCell className="text-sm">{userMap.get(t.owner_id)?.name ?? "—"}</TableCell>
                    <TableCell className="text-sm">{statusMap.get(t.status_id)?.name ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={`text-[10px] ${PRIORITY_COLOR[t.priority]}`}>
                        {PRIORITY_LABEL[t.priority]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">{t.progress}%</TableCell>
                    <TableCell className="text-sm">
                      {t.due_date ? new Date(t.due_date).toLocaleDateString("zh-TW") : "—"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {t.project_id ? projectMap.get(t.project_id)?.name ?? "—" : "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
              {paged.length === 0 && (
                <TableRow>
                  <TableCell colSpan={canBulk ? 8 : 7} className="py-10 text-center text-muted-foreground">
                    無符合條件的任務
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>共 {sorted.length} 筆</span>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一頁</Button>
          <span>{page} / {totalPages}</span>
          <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>下一頁</Button>
        </div>
      </div>
    </div>
  );
}

function ThSort({ label, k, sortKey, sortDir, onClick }: {
  label: string; k: SortKey; sortKey: SortKey; sortDir: "asc" | "desc"; onClick: (k: SortKey) => void;
}) {
  const active = sortKey === k;
  return (
    <TableHead>
      <button type="button" onClick={() => onClick(k)} className="flex items-center gap-1 hover:text-foreground">
        {label}
        {active && <span className="text-xs">{sortDir === "asc" ? "▲" : "▼"}</span>}
      </button>
    </TableHead>
  );
}

/* ============ 行事曆視圖 ============ */
function CalendarView({ tasks, statusMap, userMap }: {
  tasks: Task[]; statusMap: Map<string, Status>; userMap: Map<string, AppUser>;
}) {
  const [month, setMonth] = useState(() => {
    const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d;
  });

  const start = useMemo(() => {
    const d = new Date(month);
    d.setDate(1 - d.getDay()); // 週日為起
    return d;
  }, [month]);

  const cells: { date: Date; tasks: Task[] }[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const ds = d.toISOString().slice(0, 10);
    const inDay = tasks.filter((t) => t.due_date === ds);
    cells.push({ date: d, tasks: inDay });
  }

  const today = new Date(); today.setHours(0, 0, 0, 0);

  return (
    <Card>
      <CardContent className="p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium">
            {month.getFullYear()} 年 {month.getMonth() + 1} 月
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => {
              const d = new Date(month); d.setMonth(d.getMonth() - 1); setMonth(d);
            }}>上月</Button>
            <Button size="sm" variant="outline" onClick={() => {
              const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); setMonth(d);
            }}>本月</Button>
            <Button size="sm" variant="outline" onClick={() => {
              const d = new Date(month); d.setMonth(d.getMonth() + 1); setMonth(d);
            }}>下月</Button>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-px bg-border rounded-md overflow-hidden text-xs">
          {["日", "一", "二", "三", "四", "五", "六"].map((d) => (
            <div key={d} className="bg-muted/60 p-2 text-center font-medium">{d}</div>
          ))}
          {cells.map(({ date, tasks: dayTasks }, i) => {
            const inMonth = date.getMonth() === month.getMonth();
            const isToday = date.getTime() === today.getTime();
            return (
              <div key={i}
                className={`bg-background min-h-[100px] p-1.5 ${inMonth ? "" : "text-muted-foreground/50"}`}>
                <div className={`text-[11px] mb-1 ${isToday ? "font-bold text-primary" : ""}`}>
                  {date.getDate()}
                </div>
                <div className="space-y-1">
                  {dayTasks.slice(0, 3).map((t) => (
                    <div key={t.id} title={`${t.title} - ${userMap.get(t.owner_id)?.name ?? ""}`}
                      className={`text-[10px] truncate px-1 py-0.5 rounded ${PRIORITY_COLOR[t.priority]}`}>
                      {t.title}
                    </div>
                  ))}
                  {dayTasks.length > 3 && (
                    <div className="text-[10px] text-muted-foreground">+{dayTasks.length - 3} 更多</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="text-xs text-muted-foreground">
          顯示有期限 (due_date) 的任務。
        </div>
      </CardContent>
    </Card>
  );
}

/* ============ 建立任務對話框 ============ */
function CreateTaskDialog({
  open, onClose, appUser, statuses, users, departments, projects, types, onCreated,
}: {
  open: boolean; onClose: () => void; appUser: AppUser;
  statuses: Status[]; users: AppUser[]; departments: Department[]; projects: Project[]; types: TaskType[];
  onCreated: () => void;
}) {
  const defaultStatusId = statuses.find((s) => !s.is_done_state)?.id ?? statuses[0]?.id ?? "";
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [typeId, setTypeId] = useState("none");
  const [ownerId, setOwnerId] = useState(appUser.id);
  const [deptId, setDeptId] = useState(appUser.department_id ?? "none");
  const [projectId, setProjectId] = useState("none");
  const [priority, setPriority] = useState<Priority>("normal");
  const [dueDate, setDueDate] = useState("");
  const [collaborators, setCollaborators] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!title.trim()) return toast.error("請輸入標題");
    setBusy(true);
    try {
      const { data: created, error } = await supabase.from("task").insert({
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
      }).select("*").single();
      if (error) throw error;
      const parentId = (created as Task).id;
      if (collaborators.length) {
        await supabase.from("task_collaborator")
          .insert(collaborators.map((uid) => ({ task_id: parentId, user_id: uid })));
      }
      const t = types.find((x) => x.id === typeId);
      const steps = Array.isArray(t?.default_steps) ? (t!.default_steps as unknown as string[]) : [];
      if (steps.length) {
        const rows = steps.filter((s) => typeof s === "string" && s.trim()).map((s) => ({
          tenant_id: appUser.tenant_id, title: s, owner_id: ownerId,
          status_id: defaultStatusId, priority: "normal" as Priority, progress: 0,
          parent_task_id: parentId, project_id: projectId === "none" ? null : projectId,
          department_id: deptId === "none" ? null : deptId, created_by: appUser.id,
        }));
        if (rows.length) await supabase.from("task").insert(rows);
      }
      toast.success("任務已建立");
      onCreated(); onClose();
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
          <Field label="標題"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="任務標題" /></Field>
          <Field label="描述"><Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} /></Field>
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
                  {ALL_PRIORITIES.map((p) => <SelectItem key={p} value={p}>{PRIORITY_LABEL[p]}</SelectItem>)}
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
                  <button key={u.id} type="button"
                    onClick={() => setCollaborators((s) => on ? s.filter((x) => x !== u.id) : [...s, u.id])}
                    className={`text-xs px-2 py-1 rounded border ${on ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-accent"}`}>
                    {u.name}
                  </button>
                );
              })}
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

/* ============ 任務詳情/編輯對話框 ============ */
function EditTaskDialog({
  task, readOnly, onClose, onSaved, statuses, users, departments, projects,
}: {
  task: Task; readOnly: boolean;
  onClose: () => void; onSaved: () => void;
  statuses: Status[]; users: AppUser[]; departments: Department[]; projects: Project[];
}) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [statusId, setStatusId] = useState(task.status_id);
  const [priority, setPriority] = useState<Priority>(task.priority);
  const [ownerId, setOwnerId] = useState(task.owner_id);
  const [deptId, setDeptId] = useState(task.department_id ?? "none");
  const [projectId, setProjectId] = useState(task.project_id ?? "none");
  const [dueDate, setDueDate] = useState(task.due_date ?? "");
  const [progress, setProgress] = useState<number>(task.progress);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    if (!title.trim()) { setErr("請輸入標題"); return; }
    setBusy(true); setErr(null);
    const status = statuses.find((s) => s.id === statusId);
    const patch: Database["public"]["Tables"]["task"]["Update"] = {
      title: title.trim(),
      description: description.trim() || null,
      status_id: statusId,
      priority,
      owner_id: ownerId,
      department_id: deptId === "none" ? null : deptId,
      project_id: projectId === "none" ? null : projectId,
      due_date: dueDate || null,
      progress: Math.max(0, Math.min(100, Number(progress) || 0)),
    };
    if (status?.is_done_state) {
      patch.progress = 100;
      patch.completed_at = new Date().toISOString();
    } else {
      patch.completed_at = null;
    }
    const { error } = await supabase.from("task").update(patch).eq("id", task.id);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    toast.success("已儲存");
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{readOnly ? "任務詳情" : "編輯任務"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2 max-h-[60vh] overflow-y-auto pr-1">
          <Field label="標題">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} disabled={readOnly} />
          </Field>
          <Field label="說明">
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} disabled={readOnly} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="狀態">
              <Select value={statusId} onValueChange={setStatusId} disabled={readOnly}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {statuses.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="優先級">
              <Select value={priority} onValueChange={(v) => setPriority(v as Priority)} disabled={readOnly}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ALL_PRIORITIES.map((p) => <SelectItem key={p} value={p}>{PRIORITY_LABEL[p]}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="負責人">
              <Select value={ownerId} onValueChange={setOwnerId} disabled={readOnly}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="部門">
              <Select value={deptId} onValueChange={setDeptId} disabled={readOnly}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">無</SelectItem>
                  {departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="專案">
              <Select value={projectId} onValueChange={setProjectId} disabled={readOnly}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">無</SelectItem>
                  {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="期限">
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} disabled={readOnly} />
            </Field>
            <Field label="進度 (%)">
              <Input type="number" min={0} max={100} value={progress}
                onChange={(e) => setProgress(Number(e.target.value))} disabled={readOnly} />
            </Field>
          </div>
          {err && <div className="text-sm text-destructive">{err}</div>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {readOnly ? "關閉" : "取消"}
          </Button>
          {!readOnly && (
            <Button onClick={save} disabled={busy}>{busy ? "儲存中…" : "儲存"}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
