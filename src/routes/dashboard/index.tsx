import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

export const Route = createFileRoute("/dashboard/")({ component: DashboardHome });

function DashboardHome() {
  const { profile, roles } = useAuth();
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
          角色：{roles.join("、") || "—"}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard title="待辦事項" value={stats?.todos} />
        <StatCard title="許願清單" value={stats?.fr} />
        <StatCard title="待處理問題" value={stats?.issues} />
      </div>
    </div>
  );
}

function StatCard({ title, value }: { title: string; value?: number }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold">{value ?? "—"}</div>
      </CardContent>
    </Card>
  );
}
