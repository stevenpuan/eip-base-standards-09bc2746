import { EipUserPending } from "@/components/eip/EipUserPending";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { BellRing, Download, Repeat } from "lucide-react";

// eip_dept_routine_summary / eip_nudge_worklog 尚未進 src/integrations/supabase/types.ts，
// 這裡用 any 版 client，型別在本檔宣告。
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { useEipUser } from "@/lib/eip-user";
import { exportToExcel } from "@/lib/eip-export";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

export const Route = createFileRoute("/dashboard/eip/dept-routine")({
  component: DeptRoutinePage,
});

type Row = {
  department_id: string | null;
  department_name: string | null;
  user_id: string;
  user_name: string | null;
  log_date: string;
  expected: number;
  done: number;
  log_status: string | null;
};

const RANGES = [
  { v: "1", label: "今天" },
  { v: "7", label: "近 7 天" },
  { v: "14", label: "近 14 天" },
  { v: "30", label: "近 30 天" },
  { v: "90", label: "近 90 天" },
] as const;

const dayStr = (offset: number) =>
  new Date(Date.now() - offset * 86400000).toLocaleDateString("sv-SE");

const rate = (done: number, expected: number) => (expected === 0 ? null : (done * 100) / expected);

const fmtRate = (v: number | null) => (v == null ? "—" : `${v.toFixed(0)}%`);

// 後端一次最多接受 100 人，超過會整批被拒，所以前端先攔下來
const NUDGE_MAX = 100;

const statusLabel = (s: string | null) => {
  if (s === "submitted") return "已送出";
  if (s === "draft") return "草稿";
  if (!s) return "未建立";
  return s;
};

function rateTone(v: number | null) {
  if (v == null) return "";
  if (v >= 90) return "text-emerald-600";
  if (v >= 60) return "text-amber-600";
  return "text-destructive";
}

function DeptRoutinePage() {
  const { loading: authLoading, permsLoaded, can } = useAuth();
  const { appUser } = useEipUser();

  // 這一頁是主管視角；後端 eip_dept_routine_summary 只允許
  // company_admin / dept_manager（fail-closed），前端用 edit 權當入口旗標
  const canView = can("eip_dept_routine", "view");
  // 催填會發通知給同仁，是寫入動作，不能跟「看得到這頁」共用同一個旗標
  const canNudge = can("eip_dept_routine", "edit");

  // 預設「今天」：主管打開這頁最常問的是「今天大家做了沒」，
  // 預設 14 天累計會讓磚上的項次（項目數 × 天數）被誤讀成範本數量
  const [days, setDays] = useState("1");
  const [deptFilter, setDeptFilter] = useState("all");
  const [tab, setTab] = useState<"person" | "day">("person");
  const [pickedDate, setPickedDate] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // 兩端都含，減 1 才真的是「近 N 天」（原本近 7 天實際取 8 天）
  const from = dayStr(Number(days) - 1);
  const to = dayStr(0);

  const listQ = useQuery({
    // from / to 必須進 key：它們由「今天」推導，跨午夜時值會變但 days 不變，
    // 只用 days 當 key 會讓過夜開著的頁面繼續吃到昨天區間的快取
    queryKey: ["eip", "dept-routine", from, to],
    enabled: !!appUser && canView,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("eip_dept_routine_summary", {
        p_from: from,
        p_to: to,
      });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const rows = useMemo(() => {
    const all = listQ.data ?? [];
    return deptFilter === "all" ? all : all.filter((r) => r.department_id === deptFilter);
  }, [listQ.data, deptFilter]);

  const deptOptions = useMemo(() => {
    const m = new Map<string, string>();
    (listQ.data ?? []).forEach((r) => {
      if (r.department_id) m.set(r.department_id, r.department_name ?? "—");
    });
    return Array.from(m, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name, "zh-TW"),
    );
  }, [listQ.data]);

  // 依人彙總
  const byPerson = useMemo(() => {
    const m = new Map<
      string,
      {
        name: string;
        dept: string;
        expected: number;
        done: number;
        submitted: number;
        days: number;
      }
    >();
    rows.forEach((r) => {
      const cur = m.get(r.user_id) ?? {
        name: r.user_name ?? "—",
        dept: r.department_name ?? "—",
        expected: 0,
        done: 0,
        submitted: 0,
        days: 0,
      };
      cur.expected += Number(r.expected ?? 0);
      cur.done += Number(r.done ?? 0);
      cur.days += 1;
      if (r.log_status === "submitted") cur.submitted += 1;
      m.set(r.user_id, cur);
    });
    return Array.from(m, ([id, v]) => ({ id, ...v })).sort(
      (a, b) => (rate(a.done, a.expected) ?? 999) - (rate(b.done, b.expected) ?? 999),
    );
  }, [rows]);

  // 依日期彙總
  const byDay = useMemo(() => {
    const m = new Map<
      string,
      { expected: number; done: number; people: number; submitted: number }
    >();
    rows.forEach((r) => {
      const cur = m.get(r.log_date) ?? { expected: 0, done: 0, people: 0, submitted: 0 };
      cur.expected += Number(r.expected ?? 0);
      cur.done += Number(r.done ?? 0);
      cur.people += 1;
      if (r.log_status === "submitted") cur.submitted += 1;
      m.set(r.log_date, cur);
    });
    return Array.from(m, ([d, v]) => ({ date: d, ...v })).sort((a, b) =>
      b.date.localeCompare(a.date),
    );
  }, [rows]);

  const total = useMemo(() => {
    let expected = 0;
    let done = 0;
    let submitted = 0;
    rows.forEach((r) => {
      expected += Number(r.expected ?? 0);
      done += Number(r.done ?? 0);
      if (r.log_status === "submitted") submitted += 1;
    });
    return {
      expected,
      done,
      submitted,
      rows: rows.length,
      // 未提交人日＝區間內 log_status 不是 submitted 的人日數（草稿與完全沒建日誌都算）
      unsubmitted: rows.length - submitted,
    };
  }, [rows]);

  // 期間天數從 from/to 推導（兩端都含），不要把 days 字串直接當天數，避免又踩一次 off-by-one
  const periodDays = useMemo(
    () =>
      Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1,
    [from, to],
  );

  // 磚的副標：把「項次」的組成攤開講，避免「我只建 2 個範本，怎麼跑出 30」這種誤讀。
  // 刻意不寫成「N 天 × 平均 M 項/天」：期間內有空白天數時那個乘法乘不回應做項次，
  // 讀者拿計算機驗完只會更確信系統算錯——這正是這次客訴的成因。
  // 改成把兩個天數分開講，並明說平均的分母是「有例行的天數」，就不會誘人去乘期間天數。
  const expectedHint = useMemo(() => {
    const dataDays = byDay.length;
    if (dataDays === 0) return `期間 ${periodDays} 天，尚無例行資料`;
    const avg = (total.expected / dataDays).toFixed(1);
    return `期間 ${periodDays} 天，其中 ${dataDays} 天有例行；平均每天 ${avg} 項`;
  }, [byDay, periodDays, total.expected]);

  // 未提交名單預設看區間最後一天；只提供資料裡真的出現過的日期，避免主管選到一片空白
  const dateOptions = useMemo(() => {
    const s = new Set<string>([to]);
    (listQ.data ?? []).forEach((r) => s.add(r.log_date));
    return Array.from(s).sort((a, b) => b.localeCompare(a));
  }, [listQ.data, to]);

  // 預設不要落在今天：今天的日誌還沒到期，主管一打開就看到「全部門未提交」
  // 並且催填鈕可按，等於鼓勵去催一份晚上才要交的日誌。
  // 有昨天（或更早）的資料就選最近那一天，真的只有今天才退回今天。
  const defaultPendingDate = useMemo(
    () => dateOptions.find((d) => d < to) ?? to,
    [dateOptions, to],
  );
  // 切換區間後舊的選日可能已不在範圍內，用推導而不是 useEffect 修正，避免多一次 render
  const pendingDate = dateOptions.includes(pickedDate) ? pickedDate : defaultPendingDate;

  // 上面的 defaultPendingDate 只能「盡量」不落在今天：預設區間是「今天」時
  // from === to，dateOptions 只剩今天一天，find(d => d < to) 必然 undefined 而 fallback
  // 回今天。所以「不要催今天」的保護不能只靠預設值，一定要有這道守衛。
  // to 就是今天（dayStr(0)），只有嚴格早於今天的日期才算已到期。
  const canNudgeDate = pendingDate < to;
  const NOT_DUE_HINT =
    "今天的日誌還沒到期，不能催填。請切換到「近 7 天」以上的範圍，選一個已經到期的日期。";

  const pending = useMemo(() => {
    return rows
      .filter((r) => r.log_date === pendingDate && r.log_status !== "submitted")
      .map((r) => ({
        user_id: r.user_id,
        name: r.user_name ?? "—",
        dept: r.department_name ?? "—",
        expected: Number(r.expected ?? 0),
        done: Number(r.done ?? 0),
        status: r.log_status,
      }))
      .sort(
        (a, b) => a.dept.localeCompare(b.dept, "zh-TW") || a.name.localeCompare(b.name, "zh-TW"),
      );
  }, [rows, pendingDate]);

  // 只認「目前名單上」的勾選，換日期或換部門後殘留的 id 自動失效，不會誤催到別人
  const selectedIds = useMemo(
    () => pending.filter((p) => selected.has(p.user_id)).map((p) => p.user_id),
    [pending, selected],
  );

  const nudgeM = useMutation({
    mutationFn: async (ids: string[]) => {
      const { data, error } = await supabase.rpc("eip_nudge_worklog", {
        p_user_ids: ids,
        p_date: pendingDate,
      });
      if (error) throw error;
      return Number(data ?? 0);
    },
    onSuccess: (n, ids) => {
      if (n > 0) {
        if (n < ids.length) {
          // 差額可能是「已經催過（同日去重）」或「不在管轄範圍（後端靜默跳過）」，
          // 不講清楚主管會不知道要不要換方式跟進
          toast.warning(
            `已通知 ${n} 人；另 ${ids.length - n} 人未發出（${pendingDate} 已催過，或不在你的管轄範圍）`,
          );
        } else {
          toast.success(`已通知 ${n} 人（${pendingDate}）`);
        }
        setSelected(new Set());
        return;
      }
      // 後端會靜默跳過非管轄範圍與重複催填，回 0 不是成功，保留勾選讓主管能調整後再試
      toast.warning(`沒有發出通知（可能不在你的管轄範圍，或 ${pendingDate} 已經催過）`);
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "催填失敗");
    },
  });

  const handleNudge = () => {
    if (selectedIds.length === 0 || nudgeM.isPending) return;
    if (pendingDate > to) {
      toast.error("不能催填未來日期");
      return;
    }
    // 今天也不行：日誌是當天結束前才要交的，催一份晚上才到期的日誌等於誤催
    if (!canNudgeDate) {
      toast.error(NOT_DUE_HINT);
      return;
    }
    if (selectedIds.length > NUDGE_MAX) {
      toast.error(`一次最多催填 ${NUDGE_MAX} 人，請分批處理`);
      return;
    }
    nudgeM.mutate(selectedIds);
  };

  const handleExport = () => {
    // 每列是一個人日，單看一列看不出「項次 = 項目數 × 天數」，
    // 所以帶上這個人在區間內的列數（＝天數），跟「依人」分頁的天數欄一致
    const daysByUser = new Map(byPerson.map((p) => [p.id, p.days]));
    exportToExcel({
      filename: `部門例行彙總_${from}_${to}`,
      sheetName: "例行明細",
      rows,
      columns: [
        { header: "日期", key: "log_date" },
        { header: "部門", key: "department_name", map: (r) => r.department_name ?? "" },
        { header: "姓名", key: "user_name", map: (r) => r.user_name ?? "" },
        { header: "天數", key: "user_id", map: (r) => daysByUser.get(r.user_id) ?? 0 },
        { header: "應做項次", key: "expected", map: (r) => Number(r.expected ?? 0) },
        { header: "已做項次", key: "done", map: (r) => Number(r.done ?? 0) },
        {
          header: "達成率",
          key: "expected",
          map: (r) => fmtRate(rate(Number(r.done ?? 0), Number(r.expected ?? 0))),
        },
        { header: "日誌狀態", key: "log_status", map: (r) => statusLabel(r.log_status) },
      ],
    });
  };

  if (authLoading || !permsLoaded) return <div className="text-muted-foreground py-8">載入中…</div>;
  if (!canView) return <Navigate to="/dashboard/eip/my-tasks" replace />;
  if (!appUser) return <EipUserPending />;

  return (
    <div className="space-y-4">
      <PageHeader
        title="部門例行彙總"
        description="這份彙總是「一人一天一列」的明細累計，所以磚與表格上的數字是項次（項目數 × 天數），不是例行範本的數量。「應做」＝那一天到期的個人例行範本；「已做」＝當天工作日誌上勾選完成的例行項。達成率＝已做項次 ÷ 應做項次，是整體加總相除，不是各列比率再平均。沒建立例行範本的同仁不會列入分母。"
      />

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
          onClick={handleExport}
          disabled={listQ.isLoading || listQ.isError || rows.length === 0}
        >
          <Download className="w-4 h-4" /> 匯出 Excel
        </Button>
        <Button size="sm" variant="outline" onClick={() => void listQ.refetch()}>
          重新整理
        </Button>
      </div>

      {/* 載入中或載入失敗時不要顯示 0，否則主管會誤判成「大家都沒做」 */}
      {listQ.isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <Tile key={i} label="載入中…" value="—" />
          ))}
        </div>
      ) : listQ.isError ? (
        <Card>
          <CardContent className="py-6 text-center text-sm space-y-2">
            <div className="text-destructive">統計載入失敗</div>
            <Button size="sm" variant="outline" onClick={() => void listQ.refetch()}>
              重試
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Tile label="應做項次" value={total.expected} hint={expectedHint} />
          <Tile label="已做項次" value={total.done} hint="當天日誌上勾選完成的例行項累計" />
          <Tile
            label="例行達成率"
            value={fmtRate(rate(total.done, total.expected))}
            tone={rateTone(rate(total.done, total.expected))}
            hint={`已做 ${total.done} ÷ 應做 ${total.expected}`}
          />
          <Tile
            label="未提交人日"
            value={`${total.unsubmitted} / ${total.rows}`}
            tone={total.unsubmitted > 0 ? "text-destructive" : "text-emerald-600"}
            hint="未提交列數 ÷ 有例行的人日列數（一人一天算一列）"
          />
        </div>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as "person" | "day")}>
        <TabsList>
          <TabsTrigger value="person">依人</TabsTrigger>
          <TabsTrigger value="day">依日期</TabsTrigger>
        </TabsList>
      </Tabs>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          {listQ.isLoading ? (
            <div className="text-sm text-muted-foreground py-10 text-center">載入中…</div>
          ) : listQ.isError ? (
            <div className="text-sm text-center py-10">
              <div className="text-destructive mb-2">載入失敗</div>
              <div className="text-xs text-muted-foreground mb-2">
                這一頁只有管理者與部門主管可以看。
              </div>
              <Button size="sm" variant="outline" onClick={() => listQ.refetch()}>
                重試
              </Button>
            </div>
          ) : rows.length === 0 ? (
            <EmptyState />
          ) : tab === "person" ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>姓名</TableHead>
                  <TableHead>部門</TableHead>
                  <TableHead className="text-right">天數</TableHead>
                  <TableHead className="text-right">應做</TableHead>
                  <TableHead className="text-right">已做</TableHead>
                  <TableHead className="text-right">達成率</TableHead>
                  <TableHead className="text-right">日誌送出</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byPerson.map((p) => {
                  const r = rate(p.done, p.expected);
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{p.dept}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{p.days}</TableCell>
                      <TableCell className="text-right">{p.expected}</TableCell>
                      <TableCell className="text-right">{p.done}</TableCell>
                      <TableCell className={`text-right font-medium ${rateTone(r)}`}>
                        {fmtRate(r)}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {p.submitted}/{p.days} 天
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>日期</TableHead>
                  <TableHead className="text-right">人數</TableHead>
                  <TableHead className="text-right">應做</TableHead>
                  <TableHead className="text-right">已做</TableHead>
                  <TableHead className="text-right">達成率</TableHead>
                  <TableHead className="text-right">日誌送出</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byDay.map((d) => {
                  const r = rate(d.done, d.expected);
                  return (
                    <TableRow key={d.date}>
                      <TableCell className="font-medium">{d.date}</TableCell>
                      <TableCell className="text-right">{d.people}</TableCell>
                      <TableCell className="text-right">{d.expected}</TableCell>
                      <TableCell className="text-right">{d.done}</TableCell>
                      <TableCell className={`text-right font-medium ${rateTone(r)}`}>
                        {fmtRate(r)}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {d.submitted}/{d.people}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="font-medium text-sm">未提交名單</div>
            <Select value={pendingDate} onValueChange={setPickedDate}>
              <SelectTrigger className="w-36 h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {dateOptions.map((d) => (
                  <SelectItem key={d} value={d}>
                    {d === to ? `${d}（今天）` : d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex-1" />
            {/* 只把按鈕 disable 會讓人猜原因，所以原因就寫在按鈕旁邊 */}
            {canNudge && !canNudgeDate && (
              <span className="text-xs text-amber-700 max-w-md">{NOT_DUE_HINT}</span>
            )}
            <Button
              size="sm"
              onClick={handleNudge}
              disabled={!canNudge || !canNudgeDate || selectedIds.length === 0 || nudgeM.isPending}
            >
              <BellRing className="w-4 h-4" />
              {nudgeM.isPending
                ? "催填中…"
                : !canNudge
                  ? "沒有催填權限"
                  : !canNudgeDate
                    ? "今天還沒到期，不能催填"
                    : `催填選取的 ${selectedIds.length} 人`}
            </Button>
          </div>

          {/* 預設區間是「今天」，所以這份名單多數時候看的是還沒到期的當天 ——
              不講清楚，主管會把「全部門都在名單上」讀成「全部門都沒繳」 */}
          {!canNudgeDate && (
            <p className="text-xs text-amber-700">
              今天的日誌還沒到期，這份名單只是現況，不代表未繳。
            </p>
          )}

          <p className="text-xs text-muted-foreground">
            只列出當天「有例行範本到期或有勾選紀錄」的同仁；完全沒建立例行範本又沒填日誌的人不會出現在這裡，所以這份名單不等於全部門人數。催填會同時發送系統通知與
            LINE，一次最多 {NUDGE_MAX} 人。
          </p>

          {listQ.isLoading ? (
            <div className="text-sm text-muted-foreground py-6 text-center">載入中…</div>
          ) : listQ.isError ? (
            <div className="text-sm text-center py-6 space-y-2">
              <div className="text-destructive">名單載入失敗</div>
              <Button size="sm" variant="outline" onClick={() => void listQ.refetch()}>
                重試
              </Button>
            </div>
          ) : pending.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center">
              {rows.length === 0
                ? "這個期間完全沒有例行資料，所以無法判斷誰未提交。"
                : `${pendingDate} 沒有未提交的同仁。`}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={selectedIds.length === pending.length}
                        onCheckedChange={(v) =>
                          setSelected(v ? new Set(pending.map((p) => p.user_id)) : new Set())
                        }
                      />
                    </TableHead>
                    <TableHead>姓名</TableHead>
                    <TableHead>部門</TableHead>
                    <TableHead className="text-right">應做</TableHead>
                    <TableHead className="text-right">已做</TableHead>
                    <TableHead className="text-right">狀態</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pending.map((p) => (
                    <TableRow key={p.user_id}>
                      <TableCell>
                        <Checkbox
                          checked={selected.has(p.user_id)}
                          onCheckedChange={(v) => {
                            const s = new Set(selected);
                            if (v) s.add(p.user_id);
                            else s.delete(p.user_id);
                            setSelected(s);
                          }}
                        />
                      </TableCell>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{p.dept}</TableCell>
                      <TableCell className="text-right">{p.expected}</TableCell>
                      <TableCell className="text-right">{p.done}</TableCell>
                      <TableCell className="text-right text-sm">
                        {p.status === "draft"
                          ? "草稿未送出"
                          : p.status
                            ? statusLabel(p.status)
                            : "未建立日誌"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Tile({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: number | string;
  tone?: string;
  hint?: string;
}) {
  return (
    <div className="rounded-md border px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold ${tone ?? ""}`}>{value}</div>
      {hint && <div className="text-[12.5px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="text-center py-12 px-6">
      <Repeat className="w-8 h-8 mx-auto text-muted-foreground/50 mb-3" />
      <div className="text-sm text-muted-foreground max-w-md mx-auto space-y-1">
        <p>這個期間沒有例行資料。</p>
        <p className="text-xs">
          彙總的來源是「個人例行範本」——
          同仁要先到「個人例行」頁建立自己的例行工作，工作日誌才會每天帶出來，這一頁才會有數字。
        </p>
      </div>
    </div>
  );
}
