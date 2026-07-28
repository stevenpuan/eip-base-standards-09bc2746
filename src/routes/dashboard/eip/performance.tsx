import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart,
  Bar,
  LabelList,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { BarChart3 } from "lucide-react";

// eip_performance_summary / eip_performance_by_dept 尚未進
// src/integrations/supabase/types.ts，這裡用 any 版 client，型別在本檔宣告。
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { useEipUser } from "@/lib/eip-user";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/dashboard/eip/performance")({
  component: PerformancePage,
});

/* ---------- 型別 ---------- */

type PerfRow = {
  user_id: string;
  user_name: string | null;
  department_id: string | null;
  department_name: string | null;
  tasks_done: number;
  tasks_overdue_now: number;
  tasks_open_now: number;
  routine_expected: number;
  routine_done: number;
  routine_rate: number | string | null;
  worklog_submitted: number;
  worklog_draft: number;
  // 準時＝送出當天的台北日期還沒超過日誌日期；rate 的分母為 0 時後端回 null
  worklog_ontime: number;
  worklog_ontime_rate: number | string | null;
  // 請假代辦：指派給本人的總項數與其中已完成數
  handover_items: number;
  handover_done: number;
  handover_rate: number | string | null;
  meeting_actions_done: number;
  meeting_actions_open_now: number;
  anomalies_raised: number;
  anomalies_closed: number;
  anomalies_unfilled: number;
};

type DeptRow = {
  department_id: string | null;
  department_name: string | null;
  headcount: number;
  tasks_done: number;
  tasks_overdue_now: number;
  routine_rate: number | string | null;
  worklog_submit_rate: number | string | null;
  worklog_ontime_rate: number | string | null;
  handover_rate: number | string | null;
  anomalies_raised: number;
  anomalies_unfilled: number;
};

/* 兩個色只做「完成 vs 逾期」，用專案既有調色盤裡的藍與紅。
   不用綠/紅：紅綠對紅色盲的區辨度只有 ΔE 7.2（在 6–8 的下限帶），
   藍/紅是 26.7，且明度與對比度在淺色與深色底都通過。 */
const C_DONE = "hsl(221 83% 53%)"; // #2463EB
const C_OVERDUE = "hsl(0 84% 60%)"; // #EF4343

const RANGES = [
  { v: "7", label: "近 7 天" },
  { v: "30", label: "近 30 天" },
  { v: "90", label: "近 90 天" },
  { v: "180", label: "近 180 天" },
] as const;

const dayStr = (offsetDays: number) =>
  new Date(Date.now() - offsetDays * 86400000).toLocaleDateString("sv-SE");

const pct = (v: number | string | null) => (v == null ? "—" : `${Number(v).toFixed(1)}%`);

/* ---------- 主頁面 ---------- */

function PerformancePage() {
  const { loading: authLoading, permsLoaded, can } = useAuth();
  const { appUser } = useEipUser();

  const canView = can("eip_performance", "view");
  // 部門/全公司彙總只有管理者與部門主管拿得到（後端 fail-closed 會擋）
  const canSeeDept = can("eip_performance", "export");

  const [days, setDays] = useState("30");
  const [deptFilter, setDeptFilter] = useState("all");

  const from = dayStr(Number(days));
  const to = dayStr(0);

  const perfQ = useQuery({
    queryKey: ["eip", "performance", days],
    enabled: !!appUser && canView,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("eip_performance_summary", {
        p_from: from,
        p_to: to,
      });
      if (error) throw error;
      return (data ?? []) as PerfRow[];
    },
  });

  const deptQ = useQuery({
    queryKey: ["eip", "performance-dept", days],
    enabled: !!appUser && canSeeDept,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("eip_performance_by_dept", {
        p_from: from,
        p_to: to,
      });
      if (error) throw error;
      return (data ?? []) as DeptRow[];
    },
  });

  const deptOptions = useMemo(() => {
    const m = new Map<string, string>();
    (perfQ.data ?? []).forEach((r) => {
      if (r.department_id) m.set(r.department_id, r.department_name ?? "—");
    });
    return Array.from(m, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name, "zh-TW"),
    );
  }, [perfQ.data]);

  const rows = useMemo(() => {
    const all = perfQ.data ?? [];
    return deptFilter === "all" ? all : all.filter((r) => r.department_id === deptFilter);
  }, [perfQ.data, deptFilter]);

  // 圖只畫「件數」這一種量度，不把百分比混進同一個 y 軸。
  // 比率放在下方部門表格裡，避免雙軸。
  const chartData = useMemo(
    () =>
      (deptQ.data ?? [])
        .map((d) => ({
          name: d.department_name ?? "未分部門",
          done: Number(d.tasks_done ?? 0),
          overdue: Number(d.tasks_overdue_now ?? 0),
        }))
        .filter((d) => d.done > 0 || d.overdue > 0)
        .sort((a, b) => b.done + b.overdue - (a.done + a.overdue)),
    [deptQ.data],
  );

  const totals = useMemo(() => {
    const t = { done: 0, overdue: 0, sub: 0, draft: 0, ontime: 0, unfilled: 0 };
    rows.forEach((r) => {
      t.done += Number(r.tasks_done ?? 0);
      t.overdue += Number(r.tasks_overdue_now ?? 0);
      t.sub += Number(r.worklog_submitted ?? 0);
      t.draft += Number(r.worklog_draft ?? 0);
      t.ontime += Number(r.worklog_ontime ?? 0);
      t.unfilled += Number(r.anomalies_unfilled ?? 0);
    });
    return t;
  }, [rows]);

  const logTotal = totals.sub + totals.draft;
  const submitRate = logTotal === 0 ? null : (totals.sub * 100) / logTotal;
  // 全體準時率自己加總，不能平均各人的百分比（每人日誌份數不同，平均會失真）
  const ontimeRate = logTotal === 0 ? null : (totals.ontime * 100) / logTotal;

  if (authLoading || !permsLoaded) return <div className="text-muted-foreground py-8">載入中…</div>;
  if (!canView) return <Navigate to="/dashboard/eip/my-tasks" replace />;
  if (!appUser) return <div className="text-muted-foreground py-8">EIP 帳號載入中…</div>;

  return (
    <div className="space-y-4">
      <PageHeader
        title="績效儀表板"
        description="口徑走「例行／特殊」兩軸，資料一律來自工作日誌與任務看板。一般同仁只看得到自己的數字，主管看管轄範圍，管理者看全公司。"
      />

      {/* 篩選：一列放在圖表上方 */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RANGES.map((r) => (
              <SelectItem key={r.v} value={r.v}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {deptOptions.length > 1 && (
          <Select value={deptFilter} onValueChange={setDeptFilter}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部部門</SelectItem>
              {deptOptions.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <span className="text-xs text-muted-foreground">
          {from} ～ {to}
        </span>
        <div className="flex-1" />
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            // 部門彙總是另一支 query，只 refetch perfQ 會讓上下兩塊數字互相矛盾
            void perfQ.refetch();
            if (canSeeDept) void deptQ.refetch();
          }}
        >
          重新整理
        </Button>
      </div>

      {/* 單一數字用數字磚，不用圖 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatTile label="任務完成" value={totals.done} />
        <StatTile label="任務逾期" value={totals.overdue} tone={totals.overdue > 0 ? "bad" : ""} />
        <StatTile
          label="日誌送出率"
          value={submitRate == null ? "—" : `${submitRate.toFixed(0)}%`}
          hint={`${totals.sub} 送出 / ${totals.draft} 草稿`}
        />
        <StatTile
          label="日誌準時率"
          value={ontimeRate == null ? "—" : `${ontimeRate.toFixed(0)}%`}
          hint={logTotal === 0 ? "這個期間沒有日誌" : `${totals.ontime} 準時 / ${logTotal} 份`}
        />
        <StatTile
          label="異常未填報"
          value={totals.unfilled}
          tone={totals.unfilled > 0 ? "bad" : ""}
        />
      </div>

      {/* 依部門：只比件數，一個 y 軸 */}
      {canSeeDept && (
        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="font-medium">依部門：任務完成與逾期</div>
            {deptQ.isLoading ? (
              <div className="text-sm text-muted-foreground py-10 text-center">載入中…</div>
            ) : deptQ.isError ? (
              <div className="text-sm text-muted-foreground py-10 text-center">
                沒有部門彙總的檢視權限，或載入失敗。
              </div>
            ) : chartData.length === 0 ? (
              <div className="text-sm text-muted-foreground py-10 text-center">
                這個期間沒有任務完成或逾期的紀錄。
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(240, chartData.length * 34 + 60)}>
                <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 28 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} />
                  <YAxis type="category" dataKey="name" width={96} tickLine={false} />
                  <Tooltip />
                  <Legend />
                  {/* 直接標數字：紅/藍雖然通過色盲檢核，仍給第二層編碼 */}
                  <Bar dataKey="done" name="完成" fill={C_DONE} radius={[0, 4, 4, 0]} barSize={10}>
                    <LabelList dataKey="done" position="right" className="text-[11px]" />
                  </Bar>
                  <Bar
                    dataKey="overdue"
                    name="逾期"
                    fill={C_OVERDUE}
                    radius={[0, 4, 4, 0]}
                    barSize={10}
                  >
                    <LabelList dataKey="overdue" position="right" className="text-[11px]" />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      )}

      {/* 部門彙總表：比率放這裡，不跟件數擠同一個座標軸 */}
      {canSeeDept && (deptQ.data ?? []).length > 0 && (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>部門</TableHead>
                  <TableHead className="text-right">人數</TableHead>
                  <TableHead className="text-right">完成</TableHead>
                  <TableHead className="text-right">逾期（當下）</TableHead>
                  <TableHead className="text-right">例行達成率</TableHead>
                  <TableHead className="text-right">日誌送出率</TableHead>
                  <TableHead className="text-right">準時率</TableHead>
                  <TableHead className="text-right">代辦完成率</TableHead>
                  <TableHead className="text-right">異常</TableHead>
                  <TableHead className="text-right">未填報</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(deptQ.data ?? []).map((d) => (
                  <TableRow key={d.department_id ?? "none"}>
                    <TableCell className="font-medium">{d.department_name ?? "未分部門"}</TableCell>
                    <TableCell className="text-right">{d.headcount}</TableCell>
                    <TableCell className="text-right">{d.tasks_done}</TableCell>
                    <TableCell
                      className={`text-right ${Number(d.tasks_overdue_now) > 0 ? "text-destructive font-medium" : ""}`}
                    >
                      {d.tasks_overdue_now}
                    </TableCell>
                    <TableCell className="text-right">{pct(d.routine_rate)}</TableCell>
                    <TableCell className="text-right">{pct(d.worklog_submit_rate)}</TableCell>
                    {/* 後端分母為 0 時回 null，pct() 會顯示破折號而不是 0% */}
                    <TableCell className="text-right">{pct(d.worklog_ontime_rate)}</TableCell>
                    <TableCell className="text-right">{pct(d.handover_rate)}</TableCell>
                    <TableCell className="text-right">{d.anomalies_raised}</TableCell>
                    <TableCell
                      className={`text-right ${Number(d.anomalies_unfilled) > 0 ? "text-destructive font-medium" : ""}`}
                    >
                      {d.anomalies_unfilled}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* 個人明細：欄位多，表格才是對的形式 */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          {perfQ.isLoading ? (
            <div className="text-sm text-muted-foreground py-10 text-center">載入中…</div>
          ) : perfQ.isError ? (
            <div className="text-sm text-center py-10">
              <div className="text-destructive mb-2">載入失敗</div>
              <Button size="sm" variant="outline" onClick={() => perfQ.refetch()}>
                重試
              </Button>
            </div>
          ) : rows.length === 0 ? (
            <div className="text-center py-12 px-6">
              <BarChart3 className="w-8 h-8 mx-auto text-muted-foreground/50 mb-3" />
              <div className="text-sm text-muted-foreground max-w-md mx-auto">
                這個期間沒有可統計的資料。
              </div>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>姓名</TableHead>
                  <TableHead>部門</TableHead>
                  <TableHead className="text-right">完成</TableHead>
                  <TableHead className="text-right">逾期（當下）</TableHead>
                  <TableHead className="text-right">未完成（當下）</TableHead>
                  <TableHead className="text-right">例行</TableHead>
                  <TableHead className="text-right">日誌</TableHead>
                  <TableHead className="text-right">日誌準時</TableHead>
                  <TableHead className="text-right">代辦</TableHead>
                  <TableHead className="text-right">會議決議</TableHead>
                  <TableHead className="text-right">異常</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.user_id}>
                    <TableCell className="font-medium">{r.user_name ?? "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {r.department_name ?? "—"}
                    </TableCell>
                    <TableCell className="text-right">{r.tasks_done}</TableCell>
                    <TableCell
                      className={`text-right ${r.tasks_overdue_now > 0 ? "text-destructive font-medium" : ""}`}
                    >
                      {r.tasks_overdue_now}
                    </TableCell>
                    <TableCell className="text-right">{r.tasks_open_now}</TableCell>
                    <TableCell className="text-right text-sm">
                      {r.routine_expected === 0 ? (
                        <span className="text-muted-foreground">無範本</span>
                      ) : (
                        <>
                          {r.routine_done}/{r.routine_expected}
                          <span className="text-muted-foreground ml-1">
                            ({pct(r.routine_rate)})
                          </span>
                        </>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {r.worklog_submitted}
                      {r.worklog_draft > 0 && (
                        <span className="text-muted-foreground ml-1">
                          （草稿 {r.worklog_draft}）
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {/* 分母是「送出 + 草稿」，也就是這期間該有的日誌份數；沒有日誌就不給百分比 */}
                      {Number(r.worklog_submitted ?? 0) + Number(r.worklog_draft ?? 0) === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <>
                          {Number(r.worklog_ontime ?? 0)}/
                          {Number(r.worklog_submitted ?? 0) + Number(r.worklog_draft ?? 0)}
                          <span className="text-muted-foreground ml-1">
                            ({pct(r.worklog_ontime_rate)})
                          </span>
                        </>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {/* 沒被指派過代辦的人分母是 0，顯示破折號而不是 0% */}
                      {Number(r.handover_items ?? 0) === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <>
                          {Number(r.handover_done ?? 0)}/{Number(r.handover_items ?? 0)}
                          <span className="text-muted-foreground ml-1">
                            ({pct(r.handover_rate)})
                          </span>
                        </>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {r.meeting_actions_done}
                      {r.meeting_actions_open_now > 0 && (
                        <span className="text-muted-foreground ml-1">
                          （當下未結 {r.meeting_actions_open_now}）
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {r.anomalies_raised === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <>
                          {r.anomalies_raised}
                          {r.anomalies_unfilled > 0 && (
                            <span className="text-destructive ml-1">
                              （未填 {r.anomalies_unfilled}）
                            </span>
                          )}
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        例行達成率的分母是「當期到期的個人例行範本項數」——
        還沒建立例行範本的同仁會顯示「無範本」而不是 0%，避免分母灌水。
      </p>
      <p className="text-xs text-muted-foreground">
        「日誌準時」比的是送出時間的台北日期與日誌日期：當天（或更早）就送出才算準時，
        隔天以後才補交的不算，所以準時率一定小於或等於送出率。「代辦」是請假交接指派給本人的項目，
        沒被指派過的人分母是 0，顯示「—」而不是 0%。
      </p>
      <p className="text-xs text-muted-foreground px-1">
        標「當下」的欄位是即時狀態、和上面的日期區間無關（逾期／未完成／會議決議未結）；
        其餘欄位才是區間內的統計。會議決議的「完成」是以會議日期落在區間界定歸屬。
      </p>
    </div>
  );
}

/* ---------- 數字磚 ---------- */

function StatTile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number | string;
  hint?: string;
  tone?: string;
}) {
  return (
    <div className="rounded-md border px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold ${tone === "bad" ? "text-destructive" : ""}`}>
        {value}
      </div>
      {hint && <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}
