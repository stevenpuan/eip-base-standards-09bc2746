import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useEipUser } from "@/lib/eip-user";
import { PRIORITY_COLOR, PRIORITY_LABEL } from "@/lib/eip-constants";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { TaskSourceBadge, useTaskSources, type TaskSource } from "@/components/eip/TaskSourceBadge";
import { EditTaskDialog } from "@/routes/dashboard/eip/tasks";
import type { Database } from "@/integrations/supabase/types";

export const Route = createFileRoute("/dashboard/eip/my-tasks")({ component: MyTasksPage });

type Task = Database["public"]["Tables"]["task"]["Row"];
type Status = Database["public"]["Tables"]["task_status"]["Row"];
type AppUser = Database["public"]["Tables"]["app_user"]["Row"];
type SourceFilter = "all" | "normal" | "project" | "meeting";

function MyTasksPage() {
  const { appUser } = useEipUser();
  const qc = useQueryClient();
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all"); // all | open | <status_id>
  const [groupBy, setGroupBy] = useState<"none" | "source" | "project">("none");
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const statusesQ = useQuery({
    queryKey: ["eip", "task_status"],
    queryFn: async () => {
      const { data, error } = await supabase.from("task_status").select("*").order("sort_order");
      if (error) throw error;
      return (data ?? []) as Status[];
    },
  });

  const ownedQ = useQuery({
    enabled: !!appUser?.id,
    queryKey: ["eip", "my-owned", appUser?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("task")
        .select("*")
        .eq("owner_id", appUser!.id)
        .order("due_date", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as Task[];
    },
  });

  const collabQ = useQuery({
    enabled: !!appUser?.id,
    queryKey: ["eip", "my-collab", appUser?.id],
    queryFn: async () => {
      const { data: links, error } = await supabase
        .from("task_collaborator")
        .select("task_id")
        .eq("user_id", appUser!.id);
      if (error) throw error;
      const ids = (links ?? []).map((l) => l.task_id);
      if (!ids.length) return [] as Task[];
      const { data, error: e2 } = await supabase
        .from("task")
        .select("*")
        .in("id", ids)
        .order("due_date", { ascending: true, nullsFirst: false });
      if (e2) throw e2;
      return (data ?? []) as Task[];
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
      return data ?? [];
    },
  });
  const projectsQ = useQuery({
    queryKey: ["eip", "projects"],
    queryFn: async () => {
      const { data, error } = await supabase.from("project").select("*").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const statusMap = useMemo(() => {
    const m = new Map<string, Status>();
    (statusesQ.data ?? []).forEach((s) => m.set(s.id, s));
    return m;
  }, [statusesQ.data]);

  const allMy = useMemo(() => {
    const seen = new Set<string>();
    const out: Task[] = [];
    [...(ownedQ.data ?? []), ...(collabQ.data ?? [])].forEach((t) => {
      if (!seen.has(t.id)) { seen.add(t.id); out.push(t); }
    });
    return out;
  }, [ownedQ.data, collabQ.data]);

  const sourceMap = useTaskSources(allMy);

  const sortedStatuses = useMemo(
    () => [...(statusesQ.data ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    [statusesQ.data]
  );

  const applyFilters = (list: Task[]) =>
    list.filter((t) => {
      if (sourceFilter !== "all") {
        const s = sourceMap.get(t.id);
        if (s?.type !== sourceFilter) return false;
      }
      if (statusFilter === "open") {
        if (statusMap.get(t.status_id)?.is_done_state) return false;
      } else if (statusFilter !== "all") {
        if (t.status_id !== statusFilter) return false;
      }
      return true;
    });

  if (!appUser) return <div className="text-muted-foreground py-8">EIP 帳號載入中…</div>;

  const owned = applyFilters(ownedQ.data ?? []);
  const collab = applyFilters(collabQ.data ?? []);

  const refetch = () => {
    qc.invalidateQueries({ queryKey: ["eip", "my-owned", appUser.id] });
    qc.invalidateQueries({ queryKey: ["eip", "my-collab", appUser.id] });
  };

  // 本人負責且尚未結案(狀態非完成)才可刪除
  const canDelete = (t: Task) => t.owner_id === appUser.id && !statusMap.get(t.status_id)?.is_done_state;
  const handleDelete = async (t: Task) => {
    if (!window.confirm(`確定刪除任務「${t.title}」？子任務與協作紀錄會一併移除，此動作無法復原。`)) return;
    setDeleting(t.id);
    const { error } = await supabase.from("task").delete().eq("id", t.id);
    setDeleting(null);
    if (error) { toast.error(error.message); return; }
    toast.success("已刪除任務");
    refetch();
  };

  return (
    <div>
      <PageHeader title="我的工作" description="個人聚合中心,顯示與我相關的所有任務(一般、專案、會議來源)。未結案的任務可編輯或刪除。" />

      <Card className="mb-3">
        <CardContent className="p-3 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">來源</span>
            <Tabs value={sourceFilter} onValueChange={(v) => setSourceFilter(v as SourceFilter)}>
              <TabsList className="h-8">
                <TabsTrigger value="all" className="text-xs">全部</TabsTrigger>
                <TabsTrigger value="normal" className="text-xs">一般</TabsTrigger>
                <TabsTrigger value="project" className="text-xs">專案</TabsTrigger>
                <TabsTrigger value="meeting" className="text-xs">會議</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">狀態</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            >
              <option value="all">全部狀態</option>
              <option value="open">未完成</option>
              {sortedStatuses.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">分組</span>
            <Tabs value={groupBy} onValueChange={(v) => setGroupBy(v as typeof groupBy)}>
              <TabsList className="h-8">
                <TabsTrigger value="none" className="text-xs">無</TabsTrigger>
                <TabsTrigger value="source" className="text-xs">依來源</TabsTrigger>
                <TabsTrigger value="project" className="text-xs">依專案</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="owned">
        <TabsList>
          <TabsTrigger value="owned">我負責 ({owned.length})</TabsTrigger>
          <TabsTrigger value="collab">我協作 ({collab.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="owned" className="mt-3">
          <Grouped tasks={owned} sourceMap={sourceMap} statusMap={statusMap} sortedStatuses={sortedStatuses} groupBy={groupBy} onOpen={setEditTask} canDelete={canDelete} onDelete={handleDelete} deleting={deleting} />
        </TabsContent>
        <TabsContent value="collab" className="mt-3">
          <Grouped tasks={collab} sourceMap={sourceMap} statusMap={statusMap} sortedStatuses={sortedStatuses} groupBy={groupBy} onOpen={setEditTask} canDelete={canDelete} onDelete={handleDelete} deleting={deleting} />
        </TabsContent>
      </Tabs>

      {editTask && (
        <EditTaskDialog
          key={editTask.id}
          task={editTask}
          readOnly={editTask.owner_id !== appUser.id}
          onClose={() => setEditTask(null)}
          statuses={statusesQ.data ?? []}
          users={usersQ.data ?? []}
          departments={(deptsQ.data ?? []) as any}
          projects={(projectsQ.data ?? []) as any}
          onSaved={() => { refetch(); setEditTask(null); }}
        />
      )}
    </div>
  );
}

function Grouped({
  tasks, sourceMap, statusMap, groupBy, onOpen, canDelete, onDelete, deleting,
}: {
  tasks: Task[];
  sourceMap: Map<string, TaskSource>;
  statusMap: Map<string, Status>;
  groupBy: "none" | "source" | "project";
  onOpen: (t: Task) => void;
  canDelete: (t: Task) => boolean;
  onDelete: (t: Task) => void;
  deleting: string | null;
}) {
  const sorted = useMemo(() => {
    return [...tasks].sort((a, b) => {
      const ad = a.due_date ?? "9999-12-31";
      const bd = b.due_date ?? "9999-12-31";
      return ad < bd ? -1 : ad > bd ? 1 : 0;
    });
  }, [tasks]);

  if (!sorted.length) {
    return <Card><CardContent className="py-10 text-center text-muted-foreground">目前沒有任務</CardContent></Card>;
  }

  if (groupBy === "none") {
    return <TaskList tasks={sorted} sourceMap={sourceMap} statusMap={statusMap} onOpen={onOpen} canDelete={canDelete} onDelete={onDelete} deleting={deleting} />;
  }

  const groups = new Map<string, Task[]>();
  sorted.forEach((t) => {
    const s = sourceMap.get(t.id);
    let key = "一般任務";
    if (groupBy === "source") {
      if (s?.type === "meeting") key = `會議:${s.label}`;
      else if (s?.type === "project") key = `專案:${s.label}`;
    } else {
      // groupBy === project
      if (s?.type === "project") key = `專案:${s.label}`;
      else if (s?.type === "meeting") key = `會議:${s.label}`;
    }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  });

  return (
    <div className="space-y-4">
      {Array.from(groups.entries()).map(([key, list]) => (
        <div key={key} className="space-y-2">
          <div className="text-sm font-semibold text-muted-foreground">{key} ({list.length})</div>
          <TaskList tasks={list} sourceMap={sourceMap} statusMap={statusMap} onOpen={onOpen} canDelete={canDelete} onDelete={onDelete} deleting={deleting} />
        </div>
      ))}
    </div>
  );
}

function TaskList({
  tasks, sourceMap, statusMap, onOpen, canDelete, onDelete, deleting,
}: {
  tasks: Task[];
  sourceMap: Map<string, TaskSource>;
  statusMap: Map<string, Status>;
  onOpen: (t: Task) => void;
  canDelete: (t: Task) => boolean;
  onDelete: (t: Task) => void;
  deleting: string | null;
}) {
  return (
    <div className="space-y-2">
      {tasks.map((t) => {
        const status = statusMap.get(t.status_id);
        const overdue =
          t.due_date && new Date(t.due_date) < new Date(new Date().toDateString()) && t.progress < 100;
        const src = sourceMap.get(t.id);
        const removable = canDelete(t);
        return (
          <Card
            key={t.id}
            className="group cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => onOpen(t)}
          >
            <CardContent className="p-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate flex items-center gap-2">
                  <span className="truncate">{t.title}</span>
                  {src && <TaskSourceBadge source={src} />}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {status?.name ?? "—"}
                  {t.due_date && (
                    <span className={`ml-2 ${overdue ? "text-destructive font-medium" : ""}`}>
                      期限 {new Date(t.due_date).toLocaleDateString("zh-TW")}
                    </span>
                  )}
                </div>
              </div>
              <div className="w-32 hidden md:block">
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div className="h-full bg-primary transition-all" style={{ width: `${t.progress}%` }} />
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5 text-right">{t.progress}%</div>
              </div>
              <Badge className={`text-[10px] ${PRIORITY_COLOR[t.priority]}`} variant="secondary">
                {PRIORITY_LABEL[t.priority]}
              </Badge>
              {removable && (
                <button
                  type="button"
                  title="刪除任務"
                  disabled={deleting === t.id}
                  onClick={(e) => { e.stopPropagation(); onDelete(t); }}
                  className="p-1.5 rounded-md text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity shrink-0 disabled:opacity-50"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
