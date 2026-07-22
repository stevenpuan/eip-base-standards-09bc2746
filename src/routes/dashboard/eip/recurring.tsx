import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Play, Pencil, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useEipUser } from "@/lib/eip-user";
import { useAuth } from "@/lib/auth";
import { DEFAULT_TENANT_ID, PRIORITY_LABEL } from "@/lib/eip-constants";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Link } from "@tanstack/react-router";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import type { Database } from "@/integrations/supabase/types";

export const Route = createFileRoute("/dashboard/eip/recurring")({ component: RecurringPage });

type Rule = Database["public"]["Tables"]["recurring_rule"]["Row"];
type AppUser = Database["public"]["Tables"]["app_user"]["Row"];
type Department = Database["public"]["Tables"]["department"]["Row"];
type Priority = Database["public"]["Enums"]["task_priority"];
type ReportField = { label: string; type: "text" | "checkbox" | "number" | "date" };

const FREQ_LABEL: Record<string, string> = {
  daily: "每日", weekly: "每週", monthly: "每月", yearly: "每年", manual: "手動",
};
const WEEKDAYS = [
  { v: 1, label: "一" }, { v: 2, label: "二" }, { v: 3, label: "三" },
  { v: 4, label: "四" }, { v: 5, label: "五" }, { v: 6, label: "六" }, { v: 7, label: "日" },
];
const ALL_MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const MONTH_PRESETS: { label: string; months: number[] }[] = [
  { label: "每月", months: [] },
  { label: "單月", months: [1, 3, 5, 7, 9, 11] },
  { label: "雙月", months: [2, 4, 6, 8, 10, 12] },
  { label: "每季", months: [3, 6, 9, 12] },
  { label: "半年", months: [6, 12] },
];

function summarize(r: Rule): string {
  if (r.freq === "daily") return "每日";
  if (r.freq === "manual") return "手動";
  if (r.freq === "weekly") {
    const w = WEEKDAYS.find((x) => x.v === r.weekday);
    return `每週${w?.label ?? "?"}`;
  }
  const monthPart =
    !r.months || r.months.length === 0
      ? r.freq === "monthly" ? "每月" : "每年"
      : `${r.months.join("/")} 月`;
  const dayPart = r.use_month_end
    ? "月底"
    : r.days_of_month && r.days_of_month.length
      ? `${r.days_of_month.join("/")} 日`
      : "—";
  return `${monthPart} ${dayPart}`;
}

function RecurringPage() {
  const qc = useQueryClient();
  const { appUser } = useEipUser();
  const { can } = useAuth();
  // 權限一律讀「角色權限設定」（常態工作模組），不寫死角色
  const allowed = can("eip_recurring", "view");
  const canCreate = can("eip_recurring", "create");
  const canManage = can("eip_recurring", "edit");

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Rule | null>(null);
  const [running, setRunning] = useState(false);

  const rulesQ = useQuery({
    queryKey: ["eip", "recurring"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recurring_rule")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Rule[];
    },
  });
  const usersQ = useQuery({
    queryKey: ["eip", "app_users"],
    queryFn: async () => {
      const { data } = await supabase.from("app_user").select("*").eq("status", "active").order("name");
      return (data ?? []) as AppUser[];
    },
  });
  const deptQ = useQuery({
    queryKey: ["eip", "departments"],
    queryFn: async () => {
      const { data } = await supabase.from("department").select("*").order("name");
      return (data ?? []) as Department[];
    },
  });

  const userMap = useMemo(() => {
    const m = new Map<string, AppUser>();
    (usersQ.data ?? []).forEach((u) => m.set(u.id, u));
    return m;
  }, [usersQ.data]);
  const deptMap = useMemo(() => {
    const m = new Map<string, Department>();
    (deptQ.data ?? []).forEach((d) => m.set(d.id, d));
    return m;
  }, [deptQ.data]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["eip", "recurring"] });

  const toggleActive = async (r: Rule) => {
    const { error } = await supabase
      .from("recurring_rule")
      .update({ is_active: !r.is_active })
      .eq("id", r.id);
    if (error) toast.error(error.message);
    else { toast.success(r.is_active ? "已停用" : "已啟用"); refresh(); }
  };
  const remove = async (r: Rule) => {
    if (!confirm(`確定刪除「${r.title}」？`)) return;
    const { error } = await supabase.from("recurring_rule").delete().eq("id", r.id);
    if (error) toast.error(error.message);
    else { toast.success("已刪除"); refresh(); }
  };
  const runNow = async () => {
    if (running) return;
    setRunning(true);
    const { error } = await supabase.rpc("eip_run_recurring", {});
    setRunning(false);
    if (error) toast.error(error.message);
    else { toast.success("已執行：產生到期任務與提醒"); refresh(); }
  };

  if (!appUser) return <div className="text-muted-foreground py-8">EIP 帳號載入中…</div>;
  if (!allowed) return <Navigate to="/dashboard/eip/my-tasks" replace />;

  return (
    <div>
      <PageHeader
        title="常態工作"
        description="集中管理週期性任務（每日 / 每週 / 每月 / 每年），由系統自動依排程生成任務與提醒。"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={runNow} disabled={running}><Play className="w-4 h-4 mr-1" />{running ? "產生中…" : "立即產生/檢查"}</Button>
            {canCreate && (
              <Button onClick={() => { setEditing(null); setOpen(true); }}>
                <Plus className="w-4 h-4 mr-1" />新增規則
              </Button>
            )}
          </div>
        }
      />
      <Tabs defaultValue="rules" className="mt-2">
        <TabsList>
          <TabsTrigger value="rules">規則設定</TabsTrigger>
          <TabsTrigger value="dashboard">達成儀表板</TabsTrigger>
        </TabsList>
        <TabsContent value="rules">
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              {rulesQ.isLoading ? (
                <div className="text-sm text-muted-foreground text-center py-8">載入中…</div>
              ) : !rulesQ.data?.length ? (
                <div className="text-sm text-muted-foreground text-center py-8">尚無常態工作規則。</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>標題</TableHead>
                      <TableHead>負責人</TableHead>
                      <TableHead>部門</TableHead>
                      <TableHead>週期</TableHead>
                      <TableHead>優先級</TableHead>
                      <TableHead>上次執行</TableHead>
                      <TableHead className="text-center">啟用</TableHead>
                      <TableHead className="text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rulesQ.data.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{r.title}</TableCell>
                        <TableCell>{userMap.get(r.owner_id)?.name ?? "—"}</TableCell>
                        <TableCell>{r.department_id ? deptMap.get(r.department_id)?.name ?? "—" : "—"}</TableCell>
                        <TableCell><Badge variant="secondary">{FREQ_LABEL[r.freq] ?? r.freq}</Badge> <span className="text-xs text-muted-foreground">{summarize(r)}</span></TableCell>
                        <TableCell>{PRIORITY_LABEL[r.priority]}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{r.last_run_on ?? "—"}</TableCell>
                        <TableCell className="text-center">
                          <Switch checked={r.is_active} onCheckedChange={() => canManage && toggleActive(r)} disabled={!canManage} />
                        </TableCell>
                        <TableCell className="text-right">
                          {canManage && (
                            <div className="flex items-center justify-end gap-1">
                              <Button size="icon" variant="ghost" onClick={() => { setEditing(r); setOpen(true); }}><Pencil className="w-4 h-4" /></Button>
                              <Button size="icon" variant="ghost" onClick={() => remove(r)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="dashboard">
          <AchievementDashboard
            users={usersQ.data ?? []}
            departments={deptQ.data ?? []}
            activeRulesCount={(rulesQ.data ?? []).filter((r) => r.is_active).length}
          />
        </TabsContent>
      </Tabs>


      {open && (
        <RuleDialog
          rule={editing}
          users={usersQ.data ?? []}
          departments={deptQ.data ?? []}
          ownerFallback={appUser.id}
          onClose={() => setOpen(false)}
          onSaved={() => { setOpen(false); refresh(); }}
        />
      )}
    </div>
  );
}

function RuleDialog({
  rule, users, departments, ownerFallback, onClose, onSaved,
}: {
  rule: Rule | null;
  users: AppUser[];
  departments: Department[];
  ownerFallback: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(rule?.title ?? "");
  const [description, setDescription] = useState(rule?.description ?? "");
  const [ownerId, setOwnerId] = useState<string>(rule?.owner_id ?? ownerFallback);
  const [deptId, setDeptId] = useState<string>(rule?.department_id ?? "none");
  const [counterpart, setCounterpart] = useState(rule?.counterpart ?? "");
  const [priority, setPriority] = useState<Priority>(rule?.priority ?? "normal");
  const [freq, setFreq] = useState<string>(rule?.freq ?? "monthly");
  const [weekday, setWeekday] = useState<number>(rule?.weekday ?? 1);
  const [months, setMonths] = useState<number[]>(rule?.months ?? []);
  const [days, setDays] = useState<string>((rule?.days_of_month ?? []).join(","));
  const [useMonthEnd, setUseMonthEnd] = useState(rule?.use_month_end ?? false);
  const [advance, setAdvance] = useState<string>((rule?.advance_days ?? [1]).join(","));
  const [repeatEvery, setRepeatEvery] = useState<string>(String(rule?.repeat_every_days ?? ""));
  const [remindUntilDone, setRemindUntilDone] = useState(rule?.remind_until_done ?? true);
  const [isActive, setIsActive] = useState(rule?.is_active ?? true);
  const [fields, setFields] = useState<ReportField[]>(
    Array.isArray(rule?.report_fields) ? (rule?.report_fields as unknown as ReportField[]) : []
  );
  const [busy, setBusy] = useState(false);

  const toggleMonth = (m: number) =>
    setMonths((s) => s.includes(m) ? s.filter((x) => x !== m) : [...s, m].sort((a, b) => a - b));

  const submit = async () => {
    if (!title.trim()) return toast.error("請輸入標題");
    setBusy(true);
    try {
      const parseList = (s: string): number[] =>
        s.split(/[,\s、，]/).map((x) => parseInt(x.trim(), 10)).filter((n) => !isNaN(n) && n > 0);
      const payload = {
        tenant_id: DEFAULT_TENANT_ID,
        title: title.trim(),
        description: description.trim() || null,
        owner_id: ownerId,
        department_id: deptId === "none" ? null : deptId,
        counterpart: counterpart.trim() || null,
        priority,
        freq,
        weekday: freq === "weekly" ? weekday : null,
        months: (freq === "monthly" || freq === "yearly") ? (months.length ? months : null) : null,
        days_of_month: (freq === "monthly" || freq === "yearly") && !useMonthEnd ? parseList(days) : null,
        use_month_end: (freq === "monthly" || freq === "yearly") ? useMonthEnd : false,
        advance_days: parseList(advance),
        repeat_every_days: repeatEvery ? parseInt(repeatEvery, 10) : null,
        remind_until_done: remindUntilDone,
        is_active: isActive,
        report_fields: fields as unknown as Database["public"]["Tables"]["recurring_rule"]["Row"]["report_fields"],
      };
      if (rule) {
        const { error } = await supabase.from("recurring_rule").update(payload).eq("id", rule.id);
        if (error) throw error;
        toast.success("已更新");
      } else {
        const { error } = await supabase.from("recurring_rule").insert(payload);
        if (error) throw error;
        toast.success("已新增");
      }
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "儲存失敗");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{rule ? "編輯規則" : "新增規則"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2 space-y-1.5">
            <Label>標題 *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label>說明</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
          <div className="space-y-1.5">
            <Label>負責人</Label>
            <Select value={ownerId} onValueChange={setOwnerId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>對接部門</Label>
            <Select value={deptId} onValueChange={setDeptId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">—</SelectItem>
                {departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>對接人員</Label>
            <Input value={counterpart} onChange={(e) => setCounterpart(e.target.value)} placeholder="如：王會計" />
          </div>
          <div className="space-y-1.5">
            <Label>優先級</Label>
            <Select value={priority} onValueChange={(v) => setPriority(v as Priority)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(["low", "normal", "high", "urgent"] as Priority[]).map((p) =>
                  <SelectItem key={p} value={p}>{PRIORITY_LABEL[p]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="col-span-2 border-t pt-3 space-y-3">
            <div className="space-y-1.5">
              <Label>週期</Label>
              <Select value={freq} onValueChange={setFreq}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(FREQ_LABEL).map(([k, v]) =>
                    <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {freq === "weekly" && (
              <div className="space-y-1.5">
                <Label>星期幾</Label>
                <div className="flex flex-wrap gap-1.5">
                  {WEEKDAYS.map((w) => (
                    <Button key={w.v} type="button" size="sm"
                      variant={weekday === w.v ? "default" : "outline"}
                      onClick={() => setWeekday(w.v)}>{w.label}</Button>
                  ))}
                </div>
              </div>
            )}

            {(freq === "monthly" || freq === "yearly") && (
              <>
                <div className="space-y-1.5">
                  <Label>適用月份 {freq === "monthly" && <span className="text-xs text-muted-foreground">（留空＝每月）</span>}</Label>
                  {freq === "monthly" && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {MONTH_PRESETS.map((p) => (
                        <Button key={p.label} type="button" size="sm" variant="outline"
                          onClick={() => setMonths(p.months)}>{p.label}</Button>
                      ))}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    {ALL_MONTHS.map((m) => (
                      <Button key={m} type="button" size="sm"
                        variant={months.includes(m) ? "default" : "outline"}
                        onClick={() => toggleMonth(m)}>{m}</Button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox id="month-end" checked={useMonthEnd} onCheckedChange={(v) => setUseMonthEnd(!!v)} />
                  <Label htmlFor="month-end" className="cursor-pointer">月底</Label>
                </div>
                {!useMonthEnd && (
                  <div className="space-y-1.5">
                    <Label>每月哪幾日 <span className="text-xs text-muted-foreground">（多個以逗號分隔，如 10,20,30）</span></Label>
                    <Input value={days} onChange={(e) => setDays(e.target.value)} placeholder="10,20,30" />
                  </div>
                )}
              </>
            )}
          </div>

          <div className="col-span-2 border-t pt-3 grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>提前幾天提醒 <span className="text-xs text-muted-foreground">（多段以逗號分隔）</span></Label>
              <Input value={advance} onChange={(e) => setAdvance(e.target.value)} placeholder="30,7,1" />
            </div>
            <div className="space-y-1.5">
              <Label>逾期後每幾天再提醒</Label>
              <Input type="number" value={repeatEvery} onChange={(e) => setRepeatEvery(e.target.value)} placeholder="例如 1" />
            </div>
            <div className="col-span-2 flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Switch id="rud" checked={remindUntilDone} onCheckedChange={setRemindUntilDone} />
                <Label htmlFor="rud" className="cursor-pointer">直到回報完成才停</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch id="act" checked={isActive} onCheckedChange={setIsActive} />
                <Label htmlFor="act" className="cursor-pointer">啟用</Label>
              </div>
            </div>
          </div>

          <div className="col-span-2 border-t pt-3 space-y-2">
            <div className="flex items-center justify-between">
              <Label>回報欄位</Label>
              <Button type="button" size="sm" variant="outline"
                onClick={() => setFields((s) => [...s, { label: "", type: "text" }])}>
                <Plus className="w-3 h-3 mr-1" />新增欄位
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">定義此工作完成時要回報什麼（如：是否完成、發票號碼、金額）。</p>
            {fields.length === 0 ? (
              <div className="text-xs text-muted-foreground py-2">尚未新增回報欄位</div>
            ) : (
              <div className="space-y-2">
                {fields.map((f, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input className="flex-1" placeholder="欄位名稱" value={f.label}
                      onChange={(e) => setFields((s) => s.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} />
                    <Select value={f.type} onValueChange={(v) => setFields((s) => s.map((x, j) => j === i ? { ...x, type: v as ReportField["type"] } : x))}>
                      <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="text">文字</SelectItem>
                        <SelectItem value="checkbox">勾選</SelectItem>
                        <SelectItem value="number">數字</SelectItem>
                        <SelectItem value="date">日期</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button type="button" size="icon" variant="ghost"
                      onClick={() => setFields((s) => s.filter((_, j) => j !== i))}>
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>取消</Button>
          <Button onClick={submit} disabled={busy}>{busy ? "儲存中…" : "儲存"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type OverviewRow = Database["public"]["Views"]["eip_recurring_overview"]["Row"];
type PeriodKey = "month" | "30d" | "all";

function AchievementDashboard({
  users, departments, activeRulesCount,
}: {
  users: AppUser[];
  departments: Department[];
  activeRulesCount: number;
}) {
  const [period, setPeriod] = useState<PeriodKey>("month");
  const [ownerId, setOwnerId] = useState<string>("all");
  const [deptId, setDeptId] = useState<string>("all");

  const range = useMemo(() => {
    const today = new Date();
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    if (period === "month") {
      const s = new Date(today.getFullYear(), today.getMonth(), 1);
      const e = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      return { from: fmt(s), to: fmt(e) };
    }
    if (period === "30d") {
      const s = new Date(today); s.setDate(s.getDate() - 30);
      return { from: fmt(s), to: fmt(today) };
    }
    return { from: null as string | null, to: null as string | null };
  }, [period]);

  const overviewQ = useQuery({
    queryKey: ["eip", "recurring-overview", range.from, range.to, ownerId, deptId],
    queryFn: async () => {
      let q = supabase.from("eip_recurring_overview").select("*");
      if (range.from) q = q.gte("due_date", range.from);
      if (range.to) q = q.lte("due_date", range.to);
      if (ownerId !== "all") q = q.eq("owner_id", ownerId);
      if (deptId !== "all") q = q.eq("department_id", deptId);
      const { data, error } = await q.order("due_date", { ascending: true });
      if (error) throw error;
      return (data ?? []) as OverviewRow[];
    },
  });

  const rows = overviewQ.data ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const total = rows.length;
  const done = rows.filter((r) => r.is_done).length;
  const overdue = rows.filter((r) => r.is_overdue).length;
  const unreported = rows.filter((r) => !r.is_done && (r.due_date ?? "") <= today).length;
  const rate = total ? Math.round((done / total) * 100) : 0;

  const overdueList = rows.filter((r) => r.is_overdue);
  const unreportedList = rows.filter((r) => !r.is_done && (r.due_date ?? "") <= today);

  const daysBetween = (a: string, b: string) =>
    Math.floor((new Date(a).getTime() - new Date(b).getTime()) / 86400000);

  const byOwner = useMemo(() => {
    const m = new Map<string, { name: string; total: number; done: number; overdue: number }>();
    rows.forEach((r) => {
      const key = r.owner_id ?? "—";
      const name = r.owner_name ?? "—";
      const v = m.get(key) ?? { name, total: 0, done: 0, overdue: 0 };
      v.total += 1;
      if (r.is_done) v.done += 1;
      if (r.is_overdue) v.overdue += 1;
      m.set(key, v);
    });
    return Array.from(m.values()).sort((a, b) => b.total - a.total);
  }, [rows]);

  const byDept = useMemo(() => {
    const m = new Map<string, { name: string; total: number; done: number; overdue: number }>();
    rows.forEach((r) => {
      const key = r.department_id ?? "—";
      const name = r.department_name ?? "—";
      const v = m.get(key) ?? { name, total: 0, done: 0, overdue: 0 };
      v.total += 1;
      if (r.is_done) v.done += 1;
      if (r.is_overdue) v.overdue += 1;
      m.set(key, v);
    });
    return Array.from(m.values()).sort((a, b) => b.total - a.total);
  }, [rows]);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs">期間</Label>
            <Select value={period} onValueChange={(v) => setPeriod(v as PeriodKey)}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="month">本月</SelectItem>
                <SelectItem value="30d">近 30 天</SelectItem>
                <SelectItem value="all">全部</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">負責人</Label>
            <Select value={ownerId} onValueChange={setOwnerId}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">部門</Label>
            <Select value={deptId} onValueChange={setDeptId}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                {departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <MetricCard label="啟用規則" value={activeRulesCount} />
        <MetricCard label="本期到期" value={total} />
        <MetricCard label="已完成" value={done} tone="success" />
        <MetricCard label="逾期未完成" value={overdue} tone="danger" />
        <MetricCard label="未回報" value={unreported} tone="warning" />
        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="text-xs text-muted-foreground">達成率</div>
            <div className="text-2xl font-bold">{rate}%</div>
            <Progress value={rate} className="h-2" />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-4 space-y-2">
          <div className="font-medium">逾期清單</div>
          {overviewQ.isLoading ? (
            <div className="text-sm text-muted-foreground text-center py-6">載入中…</div>
          ) : overdueList.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-6">沒有逾期項目 🎉</div>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>工作</TableHead><TableHead>負責人</TableHead>
                <TableHead>到期日</TableHead><TableHead className="text-right">逾期天數</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {overdueList.map((r) => (
                  <TableRow key={r.task_id ?? ""}>
                    <TableCell className="font-medium">
                      <Link to="/dashboard/eip/tasks" className="text-primary hover:underline">{r.rule_title}</Link>
                    </TableCell>
                    <TableCell>{r.owner_name ?? "—"}</TableCell>
                    <TableCell className="text-destructive">{r.due_date ?? "—"}</TableCell>
                    <TableCell className="text-right text-destructive font-medium">
                      {r.due_date ? daysBetween(today, r.due_date) : "—"} 天
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-2">
          <div className="font-medium">未回報 / 待處理</div>
          {unreportedList.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-6">沒有待處理項目</div>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>負責人</TableHead><TableHead>工作</TableHead><TableHead>到期日</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {unreportedList.map((r) => (
                  <TableRow key={r.task_id ?? ""}>
                    <TableCell>{r.owner_name ?? "—"}</TableCell>
                    <TableCell>
                      <Link to="/dashboard/eip/tasks" className="text-primary hover:underline">{r.rule_title}</Link>
                    </TableCell>
                    <TableCell>{r.due_date ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="font-medium">依負責人</div>
            {byOwner.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-6">無資料</div>
            ) : (
              <Table>
                <TableHeader><TableRow>
                  <TableHead>負責人</TableHead><TableHead className="text-right">到期</TableHead>
                  <TableHead className="text-right">完成</TableHead><TableHead className="text-right">逾期</TableHead>
                  <TableHead className="text-right">達成率</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {byOwner.map((o, i) => (
                    <TableRow key={i}>
                      <TableCell>{o.name}</TableCell>
                      <TableCell className="text-right">{o.total}</TableCell>
                      <TableCell className="text-right">{o.done}</TableCell>
                      <TableCell className="text-right text-destructive">{o.overdue}</TableCell>
                      <TableCell className="text-right">{o.total ? Math.round((o.done / o.total) * 100) : 0}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="font-medium">依部門</div>
            {byDept.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-6">無資料</div>
            ) : (
              <Table>
                <TableHeader><TableRow>
                  <TableHead>部門</TableHead><TableHead className="text-right">到期</TableHead>
                  <TableHead className="text-right">完成</TableHead><TableHead className="text-right">逾期</TableHead>
                  <TableHead className="text-right">達成率</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {byDept.map((o, i) => (
                    <TableRow key={i}>
                      <TableCell>{o.name}</TableCell>
                      <TableCell className="text-right">{o.total}</TableCell>
                      <TableCell className="text-right">{o.done}</TableCell>
                      <TableCell className="text-right text-destructive">{o.overdue}</TableCell>
                      <TableCell className="text-right">{o.total ? Math.round((o.done / o.total) * 100) : 0}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MetricCard({ label, value, tone }: { label: string; value: number; tone?: "success" | "danger" | "warning" }) {
  const toneCls =
    tone === "success" ? "text-emerald-600" :
    tone === "danger" ? "text-destructive" :
    tone === "warning" ? "text-amber-600" : "";
  return (
    <Card>
      <CardContent className="p-4 space-y-1">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-2xl font-bold ${toneCls}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
