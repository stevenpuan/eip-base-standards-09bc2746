import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ListTodo, Lightbulb, AlertCircle, type LucideIcon } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { EipDashboardSummary } from "@/components/eip/EipDashboardSummary";

export const Route = createFileRoute("/dashboard/")({ component: DashboardHome });

function DashboardHome() {
  const { profile, roleNames } = useAuth();
  const { data: stats } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: async () => {
      const [todos, fr, issues] = await Promise.all([
        supabase.from("dev_todos").select("*", { count: "exact", head: true }).eq("status", "todo"),
        supabase.from("feature_requests").select("*", { count: "exact", head: true }),
        supabase.from("issue_reports").select("*", { count: "exact", head: true }).eq("status", "open"),
      ]);
      return {
        todos: todos.count ?? 0,
        fr: fr.count ?? 0,
        issues: issues.count ?? 0,
      };
    },
  });

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
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard title="待辦事項" value={stats?.todos} icon={ListTodo} accent="primary" />
        <StatCard title="許願清單" value={stats?.fr} icon={Lightbulb} accent="accent" />
        <StatCard title="待處理問題" value={stats?.issues} icon={AlertCircle} accent="destructive" />
      </div>
      <EipDashboardSummary />
    </div>
  );
}

function StatCard({
  title,
  value,
  icon: Icon,
  accent = "primary",
}: {
  title: string;
  value?: number;
  icon: LucideIcon;
  accent?: "primary" | "accent" | "destructive";
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
  return (
    <Card className={cn("border-l-4", borderClass)}>
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
}
