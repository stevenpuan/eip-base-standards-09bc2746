import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart, Bar, PieChart, Pie, Cell, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useEipUser, canManageEip } from "@/lib/eip-user";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { exportToExcel } from "@/lib/eip-export";

export const Route = createFileRoute("/dashboard/eip/reports")({
  component: ReportsPage,
});

type Period = "month" | "30d" | "90d" | "ytd";

const PERIOD_LABEL: Record<Period, string> = {
  month: "本月",
  "30d": "近 30 天",
  "90d": "近 90 天",
  ytd: "今年",
};

const FR_STATUS_LABEL: Record<string, string> = {
  pending: "待處理",
  evaluating: "評估中",
  preparing: "準備中",
  in_progress: "進行中",
  done: "已完成",
  rejected: "不採用",
};

const COLORS = [
  "hsl(221 83% 53%)", "hsl(142 71% 45%)", "hsl(38 92% 50%)",
  "hsl(0 84% 60%)", "hsl(262 83% 58%)", "hsl(199 89% 48%)",
  "hsl(330 81% 60%)", "hsl(160 60% 45%)",
];

function periodRange(p: Period): { from: Date; to: Date } {
  const now = new Date();
  const to = new Date(now); to.setHours(23, 59, 59, 999);
  let from = new Date(now);
  if (p === "month") from = new Date(now.getFullYear(), now.getMonth(), 1);
  else if (p === "30d") { from = new Date(now); from.setDate(from.getDate() - 29); }
  else if (p === "90d") { from = new Date(now); from.setDate(from.getDate() - 89); }
  else from = new Date(now.getFullYear(), 0, 1);
  from.setHours(0, 0, 0, 0);
  return { from, to };
}

function fmtDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function ReportsPage() {
  const { roles, loading: authLoading, can } = useAuth();
  const { appUser } = useEipUser();
  const isManager =
    roles.includes("admin") || roles.includes("manager") ||
    roles.includes("company_admin") || roles.includes("dept_manager") ||
    canManageEip(appUser?.role);

  const [period, setPeriod] = useState<Period>("month");
  const [deptId, setDeptId] = useState<string>("all");
  const range = useMemo(() => periodRange(period), [period]);
  const fromStr = fmtDate(range.from);
  const toStr = fmtDate(range.to);
  const today = fmtDate(new Date());

  const deptsQ = useQuery({
    queryKey: ["eip", "departments"],
    queryFn: async () => {
      const { data } = await supabase.from("department").select("id,name").order("name");
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  const statusesQ = useQuery({
    queryKey: ["eip", "task_status"],
    queryFn: async () => {
      const { data } = await supabase.from("task_status")
        .select("id,name,is_done_state,sort_order").order("sort_order");
      return (data ?? []) as { id: string; name: string; is_done_state: boolean; sort_order: number }[];
    },
  });

  const usersQ = useQuery({
    queryKey: ["eip", "app_user", "lite"],
    queryFn: async () => {
      const { data } = await supabase.from("app_user").select("id,name,department_id");
      return (data ?? []) as { id: string; name: string | null; department_id: string | null }[];
    },
  });

  const tasksQ = useQuery({
    queryKey: ["eip", "reports", "tasks", fromStr, toStr, deptId],
    queryFn: async () => {
      let q = supabase.from("task")
        .select("id,title,status_id,owner_id,department_id,due_date,created_at,completed_at")
        .gte("created_at", range.from.toISOString())
        .lte("created_at", range.to.toISOString());
      if (deptId !== "all") q = q.eq("department_id", deptId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as {
        id: string; title: string; status_id: string | null;
        owner_id: string | null; department_id: string | null;
        due_date: string | null; created_at: string; completed_at: string | null;
      }[];
    },
  });

  const trendTasksQ = useQuery({
    queryKey: ["eip", "reports", "trend", deptId],
    queryFn: async () => {
      const start = new Date();
      start.setDate(start.getDate() - 7 * 8);
      start.setHours(0, 0, 0, 0);
      let q = supabase.from("task")
        .select("id,created_at,completed_at,department_id")
        .gte("created_at", start.toISOString());
      if (deptId !== "all") q = q.eq("department_id", deptId);
      const { data } = await q;
      return (data ?? []) as { id: string; created_at: string; completed_at: string | null }[];
    },
  });

  const recurringQ = useQuery({
    queryKey: ["eip", "reports", "recurring", fromStr, toStr, deptId],
    queryFn: async () => {
      let q = supabase.from("eip_recurring_overview" as never)
        .select("task_id,is_done,due_date,department_id")
        .gte("due_date", fromStr).lte("due_date", toStr);
      if (deptId !== "all") q = (q as never as { eq: (k: string, v: string) => typeof q }).eq("department_id", deptId);
      const { data, error } = await q;
      if (error) return [] as { task_id: string; is_done: boolean; due_date: string }[];
      return (data ?? []) as { task_id: string; is_done: boolean; due_date: string }[];
    },
  });

  const frQ = useQuery({
    queryKey: ["eip", "reports", "fr"],
    queryFn: async () => {
      const { data } = await supabase.from("eip_feature_request").select("id,status");
      return (data ?? []) as { id: string; status: string }[];
    },
  });

  const annQ = useQuery({
    queryKey: ["eip", "reports", "ann"],
    queryFn: async () => {
      const { data: anns } = await supabase.from("announcement")
        .select("id,title,published_at").not("published_at", "is", null);
      const list = (anns ?? []) as { id: string; title: string; published_at: string }[];
      if (!list.length) return [] as { id: string; title: string; rate: number }[];
      const ids = list.map((a) => a.id);
      const [{ data: reads }, { data: targets }] = await Promise.all([
        supabase.from("announcement_read").select("announcement_id").in("announcement_id", ids),
        supabase.from("announcement_target").select("announcement_id,department_id,user_id").in("announcement_id", ids),
      ]);
      const readMap = new Map<string, number>();
      (reads ?? []).forEach((r) => readMap.set(r.announcement_id, (readMap.get(r.announcement_id) ?? 0) + 1));
      // 對象數估算：若無 target 則以全公司 app_user 數為對象;有 target 以使用者數+各部門人數估算
      const allUsers = (usersQ.data ?? []).length || 1;
      const deptCount = new Map<string, number>();
      (usersQ.data ?? []).forEach((u) => {
        if (u.department_id) deptCount.set(u.department_id, (deptCount.get(u.department_id) ?? 0) + 1);
      });
      const targetMap = new Map<string, number>();
      (targets ?? []).forEach((t: { announcement_id: string; department_id: string | null; user_id: string | null }) => {
        let n = targetMap.get(t.announcement_id) ?? 0;
        if (t.user_id) n += 1;
        else if (t.department_id) n += deptCount.get(t.department_id) ?? 0;
        targetMap.set(t.announcement_id, n);
      });
      return list.map((a) => {
        const total = targetMap.get(a.id) ?? allUsers;
        const r = readMap.get(a.id) ?? 0;
        return { id: a.id, title: a.title, rate: total ? Math.round((r / total) * 100) : 0 };
      });
    },
    enabled: !!usersQ.data,
  });

  const statusMap = useMemo(() => {
    const m = new Map<string, { name: string; done: boolean }>();
    (statusesQ.data ?? []).forEach((s) => m.set(s.id, { name: s.name, done: s.is_done_state }));
    return m;
  }, [statusesQ.data]);
  const deptMap = useMemo(() => {
    const m = new Map<string, string>();
    (deptsQ.data ?? []).forEach((d) => m.set(d.id, d.name));
    return m;
  }, [deptsQ.data]);
  const userMap = useMemo(() => {
    const m = new Map<string, string>();
    (usersQ.data ?? []).forEach((u) => m.set(u.id, u.name ?? u.id));
    return m;
  }, [usersQ.data]);

  // KPI
  const tasks = tasksQ.data ?? [];
  const total = tasks.length;
  const done = tasks.filter((t) => t.status_id && statusMap.get(t.status_id)?.done).length;
  const overdue = tasks.filter((t) => {
    if (!t.due_date) return false;
    const isDone = t.status_id ? statusMap.get(t.status_id)?.done : false;
    return !isDone && t.due_date < today;
  }).length;
  const doneRate = total ? Math.round((done / total) * 100) : 0;
  const overdueRate = total ? Math.round((overdue / total) * 100) : 0;
  const cycleDays = useMemo(() => {
    const completed = tasks.filter((t) => t.completed_at);
    if (!completed.length) return 0;
    const sum = completed.reduce((acc, t) => {
      const c = new Date(t.completed_at!).getTime();
      const s = new Date(t.created_at).getTime();
      return acc + Math.max(0, (c - s) / (1000 * 60 * 60 * 24));
    }, 0);
    return Math.round((sum / completed.length) * 10) / 10;
  }, [tasks]);
  const recurring = recurringQ.data ?? [];
  const recDone = recurring.filter((r) => r.is_done).length;
  const recRate = recurring.length ? Math.round((recDone / recurring.length) * 100) : 0;

  // 狀態分佈
  const statusDist = useMemo(() => {
    const m = new Map<string, number>();
    tasks.forEach((t) => {
      const name = (t.status_id && statusMap.get(t.status_id)?.name) || "未設定";
      m.set(name, (m.get(name) ?? 0) + 1);
    });
    return Array.from(m.entries()).map(([name, value]) => ({ name, value }));
  }, [tasks, statusMap]);

  // 部門工作量
  const deptLoad = useMemo(() => {
    const m = new Map<string, { name: string; done: number; pending: number }>();
    tasks.forEach((t) => {
      const key = t.department_id ?? "__none__";
      const name = (t.department_id && deptMap.get(t.department_id)) || "未指派";
      const cur = m.get(key) ?? { name, done: 0, pending: 0 };
      const isDone = t.status_id ? statusMap.get(t.status_id)?.done : false;
      if (isDone) cur.done += 1; else cur.pending += 1;
      m.set(key, cur);
    });
    return Array.from(m.values());
  }, [tasks, deptMap, statusMap]);

  // 負責人
  const byOwner = useMemo(() => {
    const m = new Map<string, { name: string; total: number; done: number }>();
    tasks.forEach((t) => {
      const key = t.owner_id ?? "__none__";
      const name = (t.owner_id && userMap.get(t.owner_id)) || "未指派";
      const cur = m.get(key) ?? { name, total: 0, done: 0 };
      cur.total += 1;
      if (t.status_id && statusMap.get(t.status_id)?.done) cur.done += 1;
      m.set(key, cur);
    });
    return Array.from(m.values())
      .map((r) => ({ ...r, rate: r.total ? Math.round((r.done / r.total) * 100) : 0 }))
      .sort((a, b) => b.total - a.total);
  }, [tasks, userMap, statusMap]);

  // 趨勢（近 8 週）
  const trend = useMemo(() => {
    const buckets: { week: string; created: number; completed: number; start: Date }[] = [];
    const now = new Date(); now.setHours(0, 0, 0, 0);
    // 找本週週一
    const dow = (now.getDay() + 6) % 7; // 週一=0
    const thisMonday = new Date(now); thisMonday.setDate(now.getDate() - dow);
    for (let i = 7; i >= 0; i--) {
      const start = new Date(thisMonday); start.setDate(thisMonday.getDate() - i * 7);
      const label = `${start.getMonth() + 1}/${start.getDate()}`;
      buckets.push({ week: label, created: 0, completed: 0, start });
    }
    const arr = trendTasksQ.data ?? [];
    arr.forEach((t) => {
      const cd = new Date(t.created_at);
      for (let i = buckets.length - 1; i >= 0; i--) {
        if (cd >= buckets[i].start) { buckets[i].created += 1; break; }
      }
      if (t.completed_at) {
        const dd = new Date(t.completed_at);
        for (let i = buckets.length - 1; i >= 0; i--) {
          if (dd >= buckets[i].start) { buckets[i].completed += 1; break; }
        }
      }
    });
    return buckets.map(({ week, created, completed }) => ({ week, created, completed }));
  }, [trendTasksQ.data]);

  // 需求分佈
  const frDist = useMemo(() => {
    const m = new Map<string, number>();
    (frQ.data ?? []).forEach((f) => m.set(f.status, (m.get(f.status) ?? 0) + 1));
    return Array.from(m.entries()).map(([k, v]) => ({ name: FR_STATUS_LABEL[k] ?? k, value: v }));
  }, [frQ.data]);

  const canExport = can("eip_reports", "export") || roles.includes("admin");

  const handleExport = () => {
    const sheets: { name: string; rows: Record<string, unknown>[] }[] = [];
    sheets.push({
      name: "KPI",
      rows: [
        { 指標: "任務完成率", 值: `${doneRate}%` },
        { 指標: "逾期率", 值: `${overdueRate}%` },
        { 指標: "平均週期天數", 值: cycleDays },
        { 指標: "常態工作達成率", 值: `${recRate}%` },
        { 指標: "任務總數", 值: total },
        { 指標: "完成數", 值: done },
        { 指標: "逾期數", 值: overdue },
      ],
    });
    // 用 SheetJS 多分頁
    import("xlsx").then((XLSX) => {
      const wb = XLSX.utils.book_new();
      const add = (name: string, rows: Record<string, unknown>[]) => {
        const ws = XLSX.utils.json_to_sheet(rows);
        XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
      };
      add("KPI", sheets[0].rows);
      add("狀態分佈", statusDist.map((s) => ({ 狀態: s.name, 數量: s.value })));
      add("部門工作量", deptLoad.map((d) => ({ 部門: d.name, 已完成: d.done, 未完成: d.pending })));
      add("依負責人", byOwner.map((o) => ({ 負責人: o.name, 任務數: o.total, 完成數: o.done, 完成率: `${o.rate}%` })));
      add("週趨勢", trend.map((t) => ({ 週: t.week, 新增: t.created, 完成: t.completed })));
      add("需求許願池", frDist.map((f) => ({ 狀態: f.name, 數量: f.value })));
      const d = new Date();
      const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
      XLSX.writeFile(wb, `EIP報表分析_${PERIOD_LABEL[period]}_${stamp}.xlsx`);
    }).catch(() => {
      // fallback：使用既有 helper 匯出主表
      exportToExcel({
        filename: "EIP報表分析_負責人",
        rows: byOwner,
        columns: [
          { header: "負責人", key: "name" },
          { header: "任務數", key: "total" },
          { header: "完成數", key: "done" },
          { header: "完成率(%)", key: "rate" },
        ],
      });
    });
  };

  if (authLoading) return <div className="text-muted-foreground">載入中…</div>;
  if (!isManager) return <Navigate to="/dashboard/eip/my-tasks" />;

  const loading = tasksQ.isLoading || statusesQ.isLoading;

  return (
    <div className="space-y-4">
      <PageHeader
        title="報表分析"
        description="任務、常態工作、需求池等綜合績效視圖。"
        actions={
          canExport ? (
            <Button variant="outline" onClick={handleExport}>
              <Download className="h-4 w-4 mr-1" /> 匯出 Excel
            </Button>
          ) : null
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="month">本月</SelectItem>
            <SelectItem value="30d">近 30 天</SelectItem>
            <SelectItem value="90d">近 90 天</SelectItem>
            <SelectItem value="ytd">今年</SelectItem>
          </SelectContent>
        </Select>
        <Select value={deptId} onValueChange={setDeptId}>
          <SelectTrigger className="w-48"><SelectValue placeholder="部門" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部部門</SelectItem>
            {(deptsQ.data ?? []).map((d) => (
              <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">
          區間：{fromStr} ~ {toStr}
        </span>
      </div>

      {loading ? (
        <div className="text-muted-foreground py-12 text-center">載入中…</div>
      ) : (
        <>
          {/* KPI */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Metric label="任務完成率" value={`${doneRate}%`} sub={`${done} / ${total}`} progress={doneRate} />
            <Metric label="逾期率" value={`${overdueRate}%`} sub={`${overdue} 筆逾期`} progress={overdueRate} tone="danger" />
            <Metric label="平均週期(天)" value={cycleDays.toString()} sub="完成任務" />
            <Metric label="常態工作達成率" value={`${recRate}%`} sub={`${recDone} / ${recurring.length}`} progress={recRate} />
          </div>

          {/* 圖表第一列 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <ChartCard title="任務狀態分佈">
              {statusDist.length === 0 ? <Empty /> : (
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie data={statusDist} dataKey="value" nameKey="name" outerRadius={100} label>
                      {statusDist.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            <ChartCard title="依部門工作量">
              {deptLoad.length === 0 ? <Empty /> : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={deptLoad}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="done" stackId="a" name="已完成" fill={COLORS[1]} />
                    <Bar dataKey="pending" stackId="a" name="未完成" fill={COLORS[2]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
          </div>

          {/* 第二列：趨勢、需求 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <ChartCard title="任務趨勢（近 8 週）">
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="week" />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="created" name="新增" stroke={COLORS[0]} strokeWidth={2} />
                  <Line type="monotone" dataKey="completed" name="完成" stroke={COLORS[1]} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="需求許願池狀態分佈">
              {frDist.length === 0 ? <Empty /> : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={frDist}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="value" name="件數" fill={COLORS[4]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
          </div>

          {/* 依負責人 */}
          <Card>
            <CardContent className="p-4 space-y-2">
              <div className="font-medium">依負責人</div>
              {byOwner.length === 0 ? <Empty /> : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>負責人</TableHead>
                      <TableHead className="text-right">任務數</TableHead>
                      <TableHead className="text-right">完成數</TableHead>
                      <TableHead className="text-right w-48">完成率</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {byOwner.map((o) => (
                      <TableRow key={o.name}>
                        <TableCell>{o.name}</TableCell>
                        <TableCell className="text-right">{o.total}</TableCell>
                        <TableCell className="text-right">{o.done}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center gap-2 justify-end">
                            <Progress value={o.rate} className="w-24" />
                            <span className="text-xs text-muted-foreground w-10 text-right">{o.rate}%</span>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* 公告已讀率 */}
          {(annQ.data?.length ?? 0) > 0 && (
            <Card>
              <CardContent className="p-4 space-y-2">
                <div className="font-medium">公告已讀率（已發布）</div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>公告</TableHead>
                      <TableHead className="text-right w-64">已讀率</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(annQ.data ?? []).map((a) => (
                      <TableRow key={a.id}>
                        <TableCell className="max-w-md truncate">{a.title}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center gap-2 justify-end">
                            <Progress value={a.rate} className="w-32" />
                            <span className="text-xs text-muted-foreground w-10 text-right">{a.rate}%</span>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function Metric({
  label, value, sub, progress, tone,
}: { label: string; value: string; sub?: string; progress?: number; tone?: "danger" }) {
  return (
    <Card>
      <CardContent className="p-4 space-y-1">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-2xl font-bold ${tone === "danger" ? "text-destructive" : ""}`}>{value}</div>
        {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
        {progress !== undefined && <Progress value={progress} className="h-1.5 mt-1" />}
      </CardContent>
    </Card>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <div className="font-medium">{title}</div>
        {children}
      </CardContent>
    </Card>
  );
}

function Empty() {
  return <div className="text-muted-foreground py-12 text-center text-sm">尚無資料</div>;
}
