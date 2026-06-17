import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEipUser } from "@/lib/eip-user";
import { PRIORITY_COLOR, PRIORITY_LABEL } from "@/lib/eip-constants";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { Database } from "@/integrations/supabase/types";

export const Route = createFileRoute("/dashboard/eip/my-tasks")({ component: MyTasksPage });

type Task = Database["public"]["Tables"]["task"]["Row"];
type Status = Database["public"]["Tables"]["task_status"]["Row"];

function MyTasksPage() {
  const { appUser } = useEipUser();

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

  const statusMap = useMemo(() => {
    const m = new Map<string, Status>();
    (statusesQ.data ?? []).forEach((s) => m.set(s.id, s));
    return m;
  }, [statusesQ.data]);

  if (!appUser) return <div className="text-muted-foreground py-8">EIP 帳號載入中…</div>;

  return (
    <div>
      <PageHeader title="我的任務" description="顯示我負責或協作中的任務。" />
      <Tabs defaultValue="owned">
        <TabsList>
          <TabsTrigger value="owned">我負責 ({ownedQ.data?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="collab">我協作 ({collabQ.data?.length ?? 0})</TabsTrigger>
        </TabsList>
        <TabsContent value="owned" className="mt-3">
          <TaskList tasks={ownedQ.data ?? []} statusMap={statusMap} />
        </TabsContent>
        <TabsContent value="collab" className="mt-3">
          <TaskList tasks={collabQ.data ?? []} statusMap={statusMap} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function TaskList({ tasks, statusMap }: { tasks: Task[]; statusMap: Map<string, Status> }) {
  if (!tasks.length) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">目前沒有任務</CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-2">
      {tasks.map((t) => {
        const status = statusMap.get(t.status_id);
        const overdue =
          t.due_date && new Date(t.due_date) < new Date(new Date().toDateString()) && t.progress < 100;
        return (
          <Card key={t.id}>
            <CardContent className="p-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">
                  <Link to="/dashboard/eip/tasks" className="hover:underline">{t.title}</Link>
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
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
