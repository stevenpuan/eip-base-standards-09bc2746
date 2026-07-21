import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ListTodo, AlertCircle, ClipboardCheck, type LucideIcon } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { EipDashboardSummary } from "@/components/eip/EipDashboardSummary";


export const Route = createFileRoute("/dashboard/")({ component: DashboardHome });


function DashboardHome() {
  const { profile, roleNames, can } = useAuth();
  const { data: stats } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: async () => {
      const [todos, issues] = await Promise.all([
        supabase.from("dev_todos").select("*", { count: "exact", head: true }).eq("status", "todo"),
        supabase.from("issue_reports").select("*", { count: "exact", head: true }).eq("status", "open"),
      ]);
      return {
        todos: todos.count ?? 0,
        issues: issues.count ?? 0,
      };
    },
  });

  // 待我批示的部門工作日誌（已送出、非本人；RLS 只會回傳本人可監督的日誌）
  const { data: pendingReviews = 0 } = useQuery({
    queryKey: ["dashboard-worklog-review", profile?.id],
    enabled: !!profile?.id,
    queryFn: async () => {
      const { count } = await supabase
        .from("work_log")
        .select("*", { count: "exact", head: true })
        .eq("status", "submitted")
        .neq("user_id", profile!.id);
      return count ?? 0;
    },
  });

  const showTodos = can("dev_todos", "view");
  const showIssues = can("issue_reports", "view");
  const showReview = pendingReviews > 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">
          歡迎回來，{profile?.full_name ?? profile?.email}
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          角色：{roleNames.join("、") || "—"}
        </p>
      </div>
      {(showTodos || showIssues || showReview) && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {showReview && (
            <StatCard
              title="待批示日誌"
              value={pendingReviews}
              icon={ClipboardCheck}
              accent="accent"
              to="/dashboard/eip/work-log"
            />
          )}
          {showTodos && (
            <StatCard title="待辦事項" value={stats?.todos} icon={ListTodo} accent="primary" to="/dashboard/dev-todos" />
          )}
          {showIssues && (
            <StatCard title="待處理問題" value={stats?.issues} icon={AlertCircle} accent="destructive" to="/dashboard/issue-reports" />
          )}
        </div>
      )}

      <EipDashboardSummary />
    </div>
  );
}

function StatCard({
  title,
  value,
  icon: Icon,
  accent = "primary",
  to,
}: {
  title: string;
  value?: number;
  icon: LucideIcon;
  accent?: "primary" | "accent" | "destructive";
  to?: string;
}) {
  const borderClass =
    accent === "accent"
      ? "border-l-accent"
      : accent === "destructive"
        ? "border-l-destructive"
        : "border-l-primary";
  const iconWrap =
    accent === "accent"
      ? "bg-accent/10 text-accent"
      : accent === "destructive"
        ? "bg-destructive/10 text-destructive"
        : "bg-primary/10 text-primary";
  const card = (
    <Card className={cn("border-l-4 transition-all duration-200", to && "hover:-translate-y-0.5 hover:shadow-md cursor-pointer", borderClass)}>
      <CardContent className="p-5 flex items-center gap-4">
        <div className={cn("h-11 w-11 rounded-full flex items-center justify-center shrink-0", iconWrap)}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-muted-foreground">{title}</div>
          <div className="text-3xl font-bold mt-0.5 leading-tight">{value ?? "—"}</div>
        </div>
      </CardContent>
    </Card>
  );
  if (to) return <Link to={to as any} className="block">{card}</Link>;
  return card;
}
