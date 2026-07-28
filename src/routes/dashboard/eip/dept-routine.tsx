import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Repeat } from "lucide-react";

// eip_dept_routine_summary 尚未進 src/integrations/supabase/types.ts，
// 這裡用 any 版 client，型別在本檔宣告。
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { useEipUser } from "@/lib/eip-user";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
  { v: "7", label: "近 7 天" },
  { v: "14", label: "近 14 天" },
  { v: "30", label: "近 30 天" },
  { v: "90", label: "近 90 天" },
] as const;

const dayStr = (offset: number) =>
  new Date(Date.now() - offset * 86400000).toLocaleDateString("sv-SE");

const rate = (done: number, expected: number) => (expected === 0 ? null : (done * 100) / expected);

const fmtRate = (v: number | null) => (v == null ? "—" : `${v.toFixed(0)}%`);

function rateTone(v: number | null) {
  if (v == null) return "";
  if (v >= 90) return "text-emerald-600";
  if (v >= 60) return "text-amber-600";
  return "text-destructive";
}

function DeptRoutinePage() {
  const { loading: authLoading, can } = useAuth();
  const { appUser } = useEipUser();

  // 這一頁是主管視角；後端 eip_dept_routine_summary 只允許
  // company_admin / dept_manager（fail-closed），前端用 edit 權當入口旗標
  const canView = can("eip_dept_routine", "view");

  const [days, setDays] = useState("14");
  const [deptFilter, setDeptFilter] = useState("all");
  const [tab, setTab] = useState<"person" | "day">("person");

  const from = dayStr(Number(days));
  const to = dayStr(0);

  const listQ = useQuery({
    queryKey: ["eip", "dept-routine", days],
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
    return { expected, done, submitted, rows: rows.length };
  }, [rows]);

  if (authLoading) return <div className="text-muted-foreground py-8">載入中…</div>;
  if (!canView) return <Navigate to="/dashboard/eip/my-tasks" replace />;
  if (!appUser) return <div className="text-muted-foreground py-8">EIP 帳號載入中…</div>;

  return (
    <div className="space-y-4">
      <PageHeader
        title="部門例行彙總"
        description="「應做」＝當日到期的個人例行範本項數；「已做」＝工作日誌上午／下午區裡勾選完成的例行項。分母只算當日真的有範本到期的人日，沒建立範本的同仁不會被算進來。"
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
        <Button size="sm" variant="outline" onClick={() => void listQ.refetch()}>
          重新整理
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Tile label="應做項次" value={total.expected} />
        <Tile label="已做項次" value={total.done} />
        <Tile
          label="達成率"
          value={fmtRate(rate(total.done, total.expected))}
          tone={rateTone(rate(total.done, total.expected))}
        />
        <Tile label="日誌已送出" value={`${total.submitted} / ${total.rows} 人日`} />
      </div>

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
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold ${tone ?? ""}`}>{value}</div>
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
