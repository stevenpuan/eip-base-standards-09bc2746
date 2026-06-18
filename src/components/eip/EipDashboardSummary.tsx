import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Megaphone, Pin, ListTodo, AlertTriangle, CheckSquare, CalendarClock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface AppUserLite {
  id: string;
  role: string | null;
  department_id: string | null;
  tenant_id: string;
}

export function EipDashboardSummary() {
  const { user, roles } = useAuth();
  const isManager =
    roles.includes("admin") ||
    roles.includes("manager") ||
    roles.includes("company_admin") ||
    roles.includes("dept_manager");

  const appUserQ = useQuery({
    enabled: !!user?.id,
    queryKey: ["dashboard", "eip-appuser", user?.id],
    queryFn: async (): Promise<AppUserLite | null> => {
      const { data } = await supabase
        .from("app_user")
        .select("id,role,department_id,tenant_id")
        .eq("id", user!.id)
        .maybeSingle();
      return (data as AppUserLite) ?? null;
    },
  });

  const appUser = appUserQ.data;
  const managerLevel =
    isManager || appUser?.role === "company_admin" || appUser?.role === "dept_manager";

  const statusesQ = useQuery({
    queryKey: ["eip", "task_status"],
    queryFn: async () => {
      const { data } = await supabase.from("task_status").select("*").order("sort_order");
      return data ?? [];
    },
  });
  const statuses = statusesQ.data ?? [];
  const doneStatusIds = useMemo(
    () => statuses.filter((s: any) => s.is_done_state).map((s: any) => s.id),
    [statuses],
  );
  const pendingStatusName = statuses.find((s: any) => s.name === "待確認");

  const tasksQ = useQuery({
    enabled: !!appUser?.id,
    queryKey: ["dashboard", "eip-tasks", appUser?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("task")
        .select("id,title,status_id,owner_id,created_by,due_date,progress,department_id,project_id");
      return data ?? [];
    },
  });

  const annQ = useQuery({
    queryKey: ["dashboard", "eip-announcements"],
    queryFn: async () => {
      const { data } = await supabase
        .from("announcement")
        .select("id,title,is_pinned,published_at,created_at")
        .not("published_at", "is", null)
        .order("is_pinned", { ascending: false })
        .order("published_at", { ascending: false })
        .limit(5);
      return data ?? [];
    },
  });

  const projectsQ = useQuery({
    enabled: managerLevel,
    queryKey: ["dashboard", "eip-projects"],
    queryFn: async () => {
      const { data } = await supabase
        .from("project")
        .select("id,name,status")
        .eq("status", "active");
      return data ?? [];
    },
  });

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  const weekEnd = useMemo(() => {
    const d = new Date(today);
    d.setDate(d.getDate() + 7);
    return d;
  }, [today]);

  const myStats = useMemo(() => {
    const tasks = (tasksQ.data ?? []) as any[];
    const mine = tasks.filter((t) => t.owner_id === appUser?.id);
    const overdue = mine.filter(
      (t) =>
        t.due_date &&
        new Date(t.due_date) < today &&
        !doneStatusIds.includes(t.status_id),
    ).length;
    const week = mine.filter(
      (t) => t.due_date && new Date(t.due_date) >= today && new Date(t.due_date) <= weekEnd,
    ).length;
    const todo = mine.filter((t) => !doneStatusIds.includes(t.status_id)).length;
    const awaiting = pendingStatusName
      ? tasks.filter(
          (t) => t.created_by === appUser?.id && t.status_id === pendingStatusName.id,
        ).length
      : 0;
    return { todo, overdue, awaiting, week };
  }, [tasksQ.data, appUser, today, weekEnd, doneStatusIds, pendingStatusName]);

  const mgrStats = useMemo(() => {
    if (!managerLevel) return null;
    const tasks = (tasksQ.data ?? []) as any[];
    const scope =
      appUser?.role === "dept_manager" && appUser?.department_id
        ? tasks.filter((t) => t.department_id === appUser.department_id)
        : tasks;
    const byStatus: Record<string, number> = {};
    scope.forEach((t) => {
      byStatus[t.status_id] = (byStatus[t.status_id] ?? 0) + 1;
    });
    const projects = (projectsQ.data ?? []) as any[];
    return { byStatus, projects };
  }, [tasksQ.data, projectsQ.data, managerLevel, appUser]);

  if (!user) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">EIP 工作概況</h2>
        <Link to="/dashboard/eip/my-tasks" className="text-xs text-primary hover:underline">
          前往我的任務 →
        </Link>
      </div>

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <MiniCard
          to="/dashboard/eip/my-tasks"
          icon={<ListTodo className="w-4 h-4" />}
          label="我的待辦"
          value={myStats.todo}
          tone="text-blue-700"
        />
        <MiniCard
          to="/dashboard/eip/my-tasks"
          icon={<AlertTriangle className="w-4 h-4" />}
          label="逾期任務"
          value={myStats.overdue}
          tone="text-rose-700"
        />
        <MiniCard
          to="/dashboard/eip/tasks"
          icon={<CheckSquare className="w-4 h-4" />}
          label="待我確認"
          value={myStats.awaiting}
          tone="text-amber-700"
        />
        <MiniCard
          to="/dashboard/eip/my-tasks"
          icon={<CalendarClock className="w-4 h-4" />}
          label="本週到期"
          value={myStats.week}
          tone="text-violet-700"
        />
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-medium flex items-center gap-2">
              <Megaphone className="w-4 h-4 text-muted-foreground" /> 最新公告
            </div>
            <Link to="/dashboard/eip/announcements" className="text-xs text-primary hover:underline">
              全部公告 →
            </Link>
          </div>
          {(annQ.data ?? []).length === 0 ? (
            <div className="text-xs text-muted-foreground py-6 text-center">尚無公告</div>
          ) : (
            <ul className="divide-y">
              {(annQ.data ?? []).map((a: any) => (
                <li key={a.id} className="py-2 flex items-center gap-2 text-sm">
                  {a.is_pinned && <Pin className="w-3 h-3 text-amber-600 shrink-0" />}
                  <Link
                    to="/dashboard/eip/announcements"
                    className="flex-1 truncate hover:text-primary hover:underline"
                  >
                    {a.title}
                  </Link>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {a.published_at ? new Date(a.published_at).toLocaleDateString("zh-TW") : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {managerLevel && mgrStats && (
        <div className="grid gap-3 md:grid-cols-2">
          <Card>
            <CardContent className="p-4">
              <div className="text-sm font-medium mb-2">
                {appUser?.role === "dept_manager" ? "部門任務分佈" : "全公司任務分佈"}
              </div>
              <div className="flex flex-wrap gap-2">
                {statuses.length === 0 && (
                  <span className="text-xs text-muted-foreground">無資料</span>
                )}
                {statuses.map((s: any) => (
                  <Link
                    key={s.id}
                    to="/dashboard/eip/tasks"
                    className="px-2.5 py-1 rounded-md bg-muted text-xs hover:bg-accent"
                  >
                    {s.name}
                    <span className="ml-1.5 font-semibold">
                      {mgrStats.byStatus[s.id] ?? 0}
                    </span>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-sm font-medium mb-2">進行中專案</div>
              {mgrStats.projects.length === 0 ? (
                <div className="text-xs text-muted-foreground">尚無進行中專案</div>
              ) : (
                <ul className="space-y-1.5">
                  {mgrStats.projects.slice(0, 5).map((p: any) => {
                    const t = (tasksQ.data ?? []).filter((x: any) =>
                      (x as any).project_id === p.id,
                    );
                    const done = t.filter((x: any) => doneStatusIds.includes(x.status_id)).length;
                    const pct = t.length ? Math.round((done / t.length) * 100) : 0;
                    return (
                      <li key={p.id} className="text-xs">
                        <div className="flex items-center justify-between">
                          <Link
                            to="/dashboard/eip/projects"
                            className="truncate hover:text-primary hover:underline"
                          >
                            {p.name}
                          </Link>
                          <Badge variant="secondary" className="text-[10px]">{pct}%</Badge>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted mt-1 overflow-hidden">
                          <div
                            className="h-full bg-primary"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function MiniCard({
  to, icon, label, value, tone,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <Link to={to as any} className="block">
      <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
        <CardContent className="p-3">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {icon} {label}
          </div>
          <div className={`text-2xl font-semibold mt-1 ${tone}`}>{value}</div>
        </CardContent>
      </Card>
    </Link>
  );
}
