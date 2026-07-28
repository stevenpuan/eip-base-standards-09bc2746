import { createFileRoute, Navigate } from "@tanstack/react-router";
import { Fragment, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, ExternalLink, Inbox, Plus, Trash2 } from "lucide-react";
// eip_quick_report 的 submitted_at / done_at / done_by / handover_note / deputy_id 與
// eip_leave_handover_item 整張表都尚未進 src/integrations/supabase/types.ts，
// 故本頁改用 any 版 client（型別在本檔自行宣告）。
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { useEipUser } from "@/lib/eip-user";
import { useActiveUsers, useAllUsers } from "@/hooks/useUsers";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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

export const Route = createFileRoute("/dashboard/eip/quick-reports")({
  component: QuickReportsPage,
});

type Row = {
  id: string;
  type: string;
  status: string;
  submitter_id: string;
  report_date: string;
  created_at: string;
  eta: string | null;
  leave_from: string | null;
  leave_to: string | null;
  detail: string | null;
  submitted_at: string | null;
  done_at: string | null;
  done_by: string | null;
  handover_note: string | null;
  // 假別已從流程移除，僅保留讀取以顯示舊資料，不提供新增／編輯入口
  leave_type: string | null;
  // 這一次請假指定的代理人，與 app_user.deputy_id 的靜態代理人是不同概念
  deputy_id: string | null;
};

/** eip_leave_handover_item：一張請假單下的逐項代辦 */
type LeaveHandoverItem = {
  id: string;
  quick_report_id: string;
  title: string;
  assignee_id: string | null;
  url: string | null;
  sort_order: number;
  done_at: string | null;
  done_by: string | null;
  created_at: string;
};

// 選單用的 sentinel：shadcn Select 不接受空字串當值
const FOLLOW_DEPUTY = "__follow_deputy__";
const NO_DEPUTY = "__none__";

// DB 對 url 有 check constraint，前端先擋掉不合格式的輸入，
// 否則使用者會直接吃到一段看不懂的 SQL 錯誤訊息
const URL_PATTERN = /^(https?:\/\/|file:\/\/|\\\\)/;

const TYPE_LABEL: Record<string, string> = {
  late: "遲到",
  leave: "請假",
  other: "事件",
};
const TYPE_COLOR: Record<string, string> = {
  late: "bg-amber-100 text-amber-700 border-amber-300",
  leave: "bg-blue-100 text-blue-700 border-blue-300",
  other: "bg-slate-100 text-slate-700 border-slate-300",
};
// 2026-07-28 起請假不做簽核，改為「代辦產生 → 代辦完成」兩段通知。
// acknowledged 為舊制「主管已確認」留下的值，視同已完成。
const STATUS_LABEL: Record<string, string> = {
  open: "待處理",
  acknowledged: "已完成",
  done: "已完成",
  closed: "已完成",
};
const DONE_STATUSES = new Set(["acknowledged", "done", "closed"]);

function formatDateTimeZh(iso: string) {
  const d = new Date(iso);
  const date = `${d.getMonth() + 1}/${d.getDate()}`;
  const time = d.toLocaleTimeString("zh-TW", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${date} ${time}`;
}
function formatLeave(from: string | null, to: string | null) {
  if (!from && !to) return "—";
  if (from && to) return `${formatDateTimeZh(from)} ～ ${formatDateTimeZh(to)}`;
  return formatDateTimeZh((from ?? to) as string);
}
function formatEta(eta: string | null) {
  if (!eta) return "—";
  if (/^\d{2}:\d{2}/.test(eta)) return eta.slice(0, 5);
  try {
    return new Date(eta).toLocaleTimeString("zh-TW", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return eta;
  }
}

// 勾完成要寫 timestamptz。這裡自己組帶時區位移的字串，不用 toISOString()：
// UTC 字串在 UTC+8 的「日期」欄位／顯示上會退回前一天。
function nowWithOffset() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const offMin = -d.getTimezoneOffset();
  const sign = offMin >= 0 ? "+" : "-";
  const abs = Math.abs(offMin);
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}` +
    `${sign}${p(Math.floor(abs / 60))}:${p(abs % 60)}`
  );
}

function formatStampZh(iso: string) {
  return new Date(iso).toLocaleString("zh-TW", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function QuickReportsPage() {
  const qc = useQueryClient();
  const { loading: authLoading, permsLoaded, can, isAdmin } = useAuth();
  const { appUser } = useEipUser();
  // 進頁與清單顯示一律讀「角色權限設定」（臨時回報模組檢視權），不寫死角色。
  // 一般同仁有檢視權時，RLS 會只回傳「自己送出的」紀錄；主管則看部門/全公司。
  const canView = can("eip_quick_reports", "view");

  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState<string>("");
  const [keyword, setKeyword] = useState("");
  const [mineOnly, setMineOnly] = useState<boolean>(false);

  const listQ = useQuery({
    queryKey: ["eip", "quick-reports"],
    enabled: !!appUser && canView,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("eip_quick_report")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Row[];
    },
  });

  // 顯示對照用：含已停用者，否則離職同仁過去的臨時回報會顯示不出姓名
  const usersQ = useAllUsers();
  const nameMap = useMemo(() => {
    const m = new Map<string, string>();
    (usersQ.data ?? []).forEach((u) => m.set(u.id, u.name ?? u.id));
    return m;
  }, [usersQ.data]);
  const nameOf = (id: string | null | undefined) => (id ? (nameMap.get(id) ?? id) : "—");

  // 「選人」一律只給在職同仁，避免把代辦指派給已離職帳號
  const activeUsersQ = useActiveUsers();

  // 代辦清單一次撈完可見請假單的所有項目：列表要顯示 n/m，展開才查會讓每列各發一次請求。
  // 用未經前端篩選的 id 集合當 key，切換篩選器不會重打 API。
  const leaveIds = useMemo(
    () =>
      (listQ.data ?? [])
        .filter((r) => r.type === "leave")
        .map((r) => r.id)
        .sort(),
    [listQ.data],
  );
  const itemsKey = useMemo(
    () => ["eip", "leave-handover-items", leaveIds.join(",")] as const,
    [leaveIds],
  );
  const itemsQ = useQuery({
    queryKey: itemsKey,
    enabled: leaveIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("eip_leave_handover_item")
        .select("*")
        .in("quick_report_id", leaveIds)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as LeaveHandoverItem[];
    },
  });
  const itemsByReport = useMemo(() => {
    const m = new Map<string, LeaveHandoverItem[]>();
    (itemsQ.data ?? []).forEach((it) => {
      const arr = m.get(it.quick_report_id);
      if (arr) arr.push(it);
      else m.set(it.quick_report_id, [it]);
    });
    return m;
  }, [itemsQ.data]);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [itemBusy, setItemBusy] = useState<Set<string>>(new Set());
  const [deputyBusy, setDeputyBusy] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<LeaveHandoverItem | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const markBusy = (id: string, on: boolean) =>
    setItemBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // 項目完成度變動會由 DB trigger 回寫請假單 status 並發通知，
  // 所以每次動到項目都要順手重讀請假單，狀態欄才不會停在舊值。
  const refreshAll = () => {
    void itemsQ.refetch();
    void qc.invalidateQueries({ queryKey: ["eip", "quick-reports"] });
  };

  /** 勾／取消勾完成。status 由 trigger 決定，前端只寫 done_at。 */
  const toggleItemDone = async (item: LeaveHandoverItem) => {
    if (itemBusy.has(item.id)) return;
    markBusy(item.id, true);
    const prev = qc.getQueryData<LeaveHandoverItem[]>(itemsKey);
    const nextDoneAt = item.done_at ? null : nowWithOffset();
    // 樂觀更新：勾選要立刻有反應，失敗再整批還原
    qc.setQueryData<LeaveHandoverItem[]>(itemsKey, (cur) =>
      (cur ?? []).map((x) =>
        x.id === item.id
          ? { ...x, done_at: nextDoneAt, done_by: nextDoneAt ? (appUser?.id ?? null) : null }
          : x,
      ),
    );
    // done_by 由 trigger 蓋章，前端不送
    const { error } = await supabase
      .from("eip_leave_handover_item")
      .update({ done_at: nextDoneAt })
      .eq("id", item.id);
    markBusy(item.id, false);
    if (error) {
      if (prev) qc.setQueryData(itemsKey, prev);
      toast.error(`更新失敗：${error.message}`);
      return;
    }
    toast.success(nextDoneAt ? "已標記完成" : "已取消完成");
    refreshAll();
  };

  /** 新增代辦項目；回傳是否成功，讓表單自行決定要不要清空 */
  const addItem = async (
    reportId: string,
    input: { title: string; assigneeId: string | null; url: string | null },
  ) => {
    const title = input.title.trim();
    if (!title) {
      toast.error("請填寫代辦事項");
      return false;
    }
    const url = input.url?.trim() || null;
    if (url && !URL_PATTERN.test(url)) {
      toast.error("連結格式需為 http(s)://、file:// 或 \\\\server\\share");
      return false;
    }
    // sort_order 給 0，由 DB 自動接續在最後
    const { error } = await supabase.from("eip_leave_handover_item").insert({
      quick_report_id: reportId,
      title,
      assignee_id: input.assigneeId,
      url,
      sort_order: 0,
    });
    if (error) {
      toast.error(`新增失敗：${error.message}`);
      return false;
    }
    toast.success("已新增代辦事項");
    refreshAll();
    return true;
  };

  const deleteItem = async () => {
    if (!deleting || deleteBusy) return;
    setDeleteBusy(true);
    const { error } = await supabase.from("eip_leave_handover_item").delete().eq("id", deleting.id);
    setDeleteBusy(false);
    if (error) {
      toast.error(`刪除失敗：${error.message}`);
      return;
    }
    setDeleting(null);
    toast.success("已刪除代辦事項");
    refreshAll();
  };

  /** 指定這一次請假的代理人；只動 deputy_id，status 不由前端決定 */
  const setDeputy = async (reportId: string, deputyId: string | null) => {
    if (deputyBusy.has(reportId)) return;
    setDeputyBusy((p) => new Set(p).add(reportId));
    const { error } = await supabase
      .from("eip_quick_report")
      .update({ deputy_id: deputyId })
      .eq("id", reportId);
    setDeputyBusy((p) => {
      const next = new Set(p);
      next.delete(reportId);
      return next;
    });
    if (error) {
      toast.error(`代理人更新失敗：${error.message}`);
      return;
    }
    toast.success(deputyId ? "已指定代理人" : "已清除代理人");
    void qc.invalidateQueries({ queryKey: ["eip", "quick-reports"] });
  };

  const rows = useMemo(() => {
    const all = listQ.data ?? [];
    return all.filter((r) => {
      if (mineOnly && appUser && r.submitter_id !== appUser.id) return false;
      if (typeFilter !== "all" && r.type !== typeFilter) return false;
      if (statusFilter !== "all") {
        if (statusFilter === "done") {
          if (!DONE_STATUSES.has(r.status)) return false;
        } else if (r.status !== statusFilter) return false;
      }
      if (dateFilter && r.report_date !== dateFilter) return false;
      if (keyword) {
        const kw = keyword.toLowerCase();
        const name = (nameMap.get(r.submitter_id) ?? "").toLowerCase();
        const detail = (r.detail ?? "").toLowerCase();
        if (!name.includes(kw) && !detail.includes(kw)) return false;
      }
      return true;
    });
  }, [listQ.data, typeFilter, statusFilter, dateFilter, keyword, nameMap, mineOnly, appUser]);

  if (authLoading || !permsLoaded) return <div className="text-muted-foreground">載入中…</div>;
  if (!canView) return <Navigate to="/dashboard/eip/my-tasks" />;

  // 只用於遲到／事件回報。請假的 status 由「代辦項目是否全部完成」的 DB trigger 決定
  // （全完成 → done 並發第二段通知；任一項取消完成 → 退回 acknowledged），前端不得插手。
  const markDone = async (id: string) => {
    if (!appUser?.id) return;
    const { error } = await supabase
      .from("eip_quick_report")
      .update({ status: "done", done_at: nowWithOffset(), done_by: appUser.id })
      .eq("id", id);
    if (error) return toast.error(`更新失敗：${error.message}`);
    toast.success("已標記完成");
    void listQ.refetch();
  };

  const hasFilter = typeFilter !== "all" || statusFilter !== "all" || dateFilter || keyword;
  // 是否可標記完成（處理他人回報）：讀臨時回報編輯權
  const canAck = can("eip_quick_reports", "edit");

  return (
    <div className="space-y-4">
      <PageHeader
        title="臨時回報"
        description="檢視遲到 / 請假 / 事件回報（同仁看自己的，主管看部門）。請假不需簽核：指定代理人並列出代辦事項，代理人逐項勾完成後系統自動通知請假人與主管。"
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={mineOnly ? "default" : "outline"}
          size="sm"
          onClick={() => setMineOnly((v) => !v)}
        >
          {mineOnly ? "顯示：只看我的" : "只看我的"}
        </Button>

        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部類型</SelectItem>
            <SelectItem value="late">遲到</SelectItem>
            <SelectItem value="leave">請假</SelectItem>
            <SelectItem value="other">事件</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部狀態</SelectItem>
            <SelectItem value="open">待處理</SelectItem>
            <SelectItem value="done">已處理</SelectItem>
          </SelectContent>
        </Select>
        <Input
          type="date"
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
          className="w-44"
        />
        <Input
          placeholder="搜尋姓名 / 內容"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          className="w-56"
        />
        {hasFilter && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setTypeFilter("all");
              setStatusFilter("all");
              setDateFilter("");
              setKeyword("");
            }}
          >
            清除
          </Button>
        )}
      </div>

      {/* 人員清單掛掉時姓名會變成 id、代理人／指派選單會是空的，要講清楚而不是讓人以為沒人可選 */}
      {(usersQ.isError || activeUsersQ.isError) && (
        <div className="flex items-center gap-2 text-xs border rounded-md px-3 py-2">
          <span className="text-destructive">人員清單載入失敗，姓名與選人清單可能不完整</span>
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-xs"
            onClick={() => {
              void usersQ.refetch();
              void activeUsersQ.refetch();
            }}
          >
            重試
          </Button>
        </div>
      )}

      {listQ.isLoading ? (
        <div className="text-muted-foreground py-12 text-center">載入中…</div>
      ) : listQ.isError ? (
        /* 讀取失敗不能退化成空清單，否則使用者會誤以為「本來就沒有回報」 */
        <div className="border rounded-md py-16 px-6 flex flex-col items-center text-center gap-3">
          <div className="text-sm text-destructive">
            載入失敗：{listQ.error instanceof Error ? listQ.error.message : "請稍後再試"}
          </div>
          <Button size="sm" variant="outline" onClick={() => void listQ.refetch()}>
            重試
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <div className="border rounded-md py-16 px-6 flex flex-col items-center text-center gap-3">
          <Inbox className="w-10 h-10 text-muted-foreground/40" />
          <div className="text-sm text-muted-foreground max-w-md">
            {hasFilter
              ? "沒有符合篩選條件的回報,試著清除篩選看看。"
              : "目前沒有回報。可點右下角「快速回報」提交遲到／請假／事件回報。"}
          </div>
        </div>
      ) : (
        <div className="border rounded-md overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>類型</TableHead>
                <TableHead>送出人</TableHead>
                <TableHead>內容</TableHead>
                <TableHead>日期</TableHead>
                <TableHead>狀態</TableHead>
                <TableHead className="text-right">動作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const isDone = DONE_STATUSES.has(r.status);
                const isLeave = r.type === "leave";
                const items = itemsByReport.get(r.id) ?? [];
                const doneCount = items.filter((i) => i.done_at).length;
                // 新增／刪除代辦：限請假本人或管理者（與 RLS 一致，避免按了才被擋）
                const canManageItems = isLeave && (appUser?.id === r.submitter_id || isAdmin);
                const isOpen = expanded.has(r.id);
                return (
                  <Fragment key={r.id}>
                    <TableRow>
                      <TableCell>
                        <Badge variant="outline" className={TYPE_COLOR[r.type] ?? ""}>
                          {TYPE_LABEL[r.type] ?? r.type}
                        </Badge>
                      </TableCell>
                      <TableCell>{nameMap.get(r.submitter_id) ?? r.submitter_id}</TableCell>
                      <TableCell className="max-w-md">
                        {r.type === "late" && (
                          <div className="text-sm">
                            預計到達 {formatEta(r.eta)}
                            {r.detail && (
                              <div className="text-muted-foreground text-xs mt-0.5">{r.detail}</div>
                            )}
                          </div>
                        )}
                        {isLeave && (
                          <div className="text-sm">
                            {formatLeave(r.leave_from, r.leave_to)}
                            <div className="text-xs text-muted-foreground mt-0.5">
                              代理人：{nameOf(r.deputy_id)}
                            </div>
                            {/* 假別與事由已從請假流程移除，只有舊資料才會出現 */}
                            {r.leave_type && (
                              <div className="text-xs text-muted-foreground mt-0.5">
                                假別（舊資料）：{r.leave_type}
                              </div>
                            )}
                            {r.detail && (
                              <div className="text-muted-foreground text-xs mt-0.5">
                                事由（舊資料）：{r.detail}
                              </div>
                            )}
                            {r.handover_note && (
                              <div className="text-xs text-muted-foreground mt-0.5">
                                接手備註：{r.handover_note}
                              </div>
                            )}
                          </div>
                        )}
                        {r.type === "other" && <div className="text-sm">{r.detail ?? "—"}</div>}
                        {r.type !== "late" && r.type !== "leave" && r.type !== "other" && (
                          <div className="text-sm text-muted-foreground">{r.detail ?? "—"}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap">
                        {r.report_date}
                        <div className="text-xs text-muted-foreground">
                          送出 {formatStampZh(r.submitted_at ?? r.created_at)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            isDone
                              ? "bg-emerald-100 text-emerald-700 border-emerald-300"
                              : "bg-amber-100 text-amber-700 border-amber-300"
                          }
                        >
                          {STATUS_LABEL[r.status] ?? r.status}
                        </Badge>
                        {isDone && r.done_at && (
                          <div className="text-xs text-muted-foreground mt-1">
                            {formatStampZh(r.done_at)}
                            {r.done_by && ` ・${nameOf(r.done_by)}`}
                          </div>
                        )}
                        {isLeave && (
                          <div className="text-xs text-muted-foreground mt-1">
                            {itemsQ.isLoading ? (
                              "代辦載入中…"
                            ) : itemsQ.isError ? (
                              <span className="text-destructive">代辦載入失敗</span>
                            ) : (
                              `代辦 ${doneCount}/${items.length}`
                            )}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {isLeave && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8"
                              onClick={() => toggleExpanded(r.id)}
                            >
                              {isOpen ? (
                                <ChevronDown className="w-3.5 h-3.5 mr-1" />
                              ) : (
                                <ChevronRight className="w-3.5 h-3.5 mr-1" />
                              )}
                              代辦事項
                            </Button>
                          )}
                          {/* 請假不再手動標記完成：完成度由代辦項目的 trigger 回寫 status */}
                          {!isLeave && !isDone && canAck && (
                            <Button size="sm" variant="outline" onClick={() => void markDone(r.id)}>
                              標記完成
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                    {isLeave && isOpen && (
                      <TableRow className="bg-muted/30 hover:bg-muted/30">
                        <TableCell colSpan={6} className="p-0">
                          <LeaveHandoverPanel
                            report={r}
                            items={items}
                            isLoading={itemsQ.isLoading}
                            isError={itemsQ.isError}
                            onRetry={() => void itemsQ.refetch()}
                            canManage={canManageItems}
                            canEditDeputy={canManageItems}
                            deputyBusy={deputyBusy.has(r.id)}
                            activeUsers={(activeUsersQ.data ?? []).map((u) => ({
                              id: u.id,
                              name: u.name ?? u.id,
                            }))}
                            nameOf={nameOf}
                            itemBusy={itemBusy}
                            onToggleDone={toggleItemDone}
                            onAdd={addItem}
                            onDelete={(it) => setDeleting(it)}
                            onDeputyChange={setDeputy}
                          />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <AlertDialog
        open={!!deleting}
        onOpenChange={(o) => {
          if (!o && !deleteBusy) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>確定刪除這項代辦？</AlertDialogTitle>
            <AlertDialogDescription>
              「{deleting?.title}」將被移除，代辦完成度會跟著重新計算，此動作無法復原。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBusy}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteBusy}
              onClick={(e) => {
                // 刪除是非同步的，讓 Dialog 自己關會在請求還沒回來前就關掉
                e.preventDefault();
                void deleteItem();
              }}
            >
              {deleteBusy ? "刪除中…" : "刪除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ---------- 請假代辦清單 ---------- */

/**
 * 一張請假單底下的逐項代辦。
 *
 * 這裡只做「項目」的增刪與勾完成，以及指定本次代理人；
 * 請假單本身的 status 由 DB trigger 依完成度回寫（全完成 → done 並發第二段通知），
 * 前端刻意不寫 status，否則兩邊會互相蓋掉。
 */
function LeaveHandoverPanel({
  report,
  items,
  isLoading,
  isError,
  onRetry,
  canManage,
  canEditDeputy,
  deputyBusy,
  activeUsers,
  nameOf,
  itemBusy,
  onToggleDone,
  onAdd,
  onDelete,
  onDeputyChange,
}: {
  report: Row;
  items: LeaveHandoverItem[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  canManage: boolean;
  canEditDeputy: boolean;
  deputyBusy: boolean;
  activeUsers: { id: string; name: string }[];
  nameOf: (id: string | null | undefined) => string;
  itemBusy: Set<string>;
  onToggleDone: (item: LeaveHandoverItem) => Promise<void>;
  onAdd: (
    reportId: string,
    input: { title: string; assigneeId: string | null; url: string | null },
  ) => Promise<boolean>;
  onDelete: (item: LeaveHandoverItem) => void;
  onDeputyChange: (reportId: string, deputyId: string | null) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState<string>(FOLLOW_DEPUTY);
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);

  const total = items.length;
  const done = items.filter((i) => i.done_at).length;
  // 分母 0 會變 NaN，沒有項目時直接視為 0%
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const submitAdd = async () => {
    if (adding) return;
    // assignee 留空時 DB 會自動掛給請假單的代理人；兩邊都空會沒有負責人，先擋下來
    if (assignee === FOLLOW_DEPUTY && !report.deputy_id) {
      toast.error("尚未指定本次代理人，請先指定代理人或直接選擇這一項的負責人");
      return;
    }
    setAdding(true);
    const ok = await onAdd(report.id, {
      title,
      assigneeId: assignee === FOLLOW_DEPUTY ? null : assignee,
      url: url || null,
    });
    setAdding(false);
    if (ok) {
      setTitle("");
      setUrl("");
      setAssignee(FOLLOW_DEPUTY);
    }
  };

  return (
    <div className="px-4 py-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">代辦事項</span>
        <span className="text-xs text-muted-foreground">
          完成度 {done}/{total}
          {total > 0 && `（${pct}%）`}
        </span>
        <div className="flex-1" />
        <span className="text-xs text-muted-foreground">本次代理人</span>
        {canEditDeputy ? (
          <Select
            value={report.deputy_id ?? NO_DEPUTY}
            disabled={deputyBusy}
            onValueChange={(v) => void onDeputyChange(report.id, v === NO_DEPUTY ? null : v)}
          >
            <SelectTrigger className="w-44 h-8 text-xs">
              <SelectValue placeholder="選擇代理人" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_DEPUTY}>未指定</SelectItem>
              {activeUsers.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="text-xs font-medium">{nameOf(report.deputy_id)}</span>
        )}
      </div>

      {isLoading ? (
        <div className="text-xs text-muted-foreground py-2">代辦事項載入中…</div>
      ) : isError ? (
        <div className="flex items-center gap-2 py-2">
          <span className="text-xs text-destructive">代辦事項載入失敗</span>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onRetry}>
            重試
          </Button>
        </div>
      ) : total === 0 ? (
        <div className="text-xs text-muted-foreground py-2">
          還沒有代辦事項{canManage ? "，可在下方新增。" : "。"}
        </div>
      ) : (
        <div className="space-y-1.5">
          {items.map((it) => {
            const busy = itemBusy.has(it.id);
            return (
              <div
                key={it.id}
                className="flex items-start gap-2 rounded-md border bg-card px-2.5 py-2 text-sm"
              >
                <Checkbox
                  className="mt-0.5"
                  checked={!!it.done_at}
                  disabled={busy}
                  onCheckedChange={() => void onToggleDone(it)}
                  aria-label={it.done_at ? "取消完成" : "標記完成"}
                />
                <div className="flex-1 min-w-0">
                  <div
                    className={
                      it.done_at ? "line-through text-muted-foreground break-words" : "break-words"
                    }
                  >
                    {it.title}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground mt-0.5">
                    <span>指派：{nameOf(it.assignee_id)}</span>
                    {it.url && (
                      <a
                        href={it.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center text-primary hover:underline break-all"
                      >
                        開啟連結
                        <ExternalLink className="w-3 h-3 ml-0.5" />
                      </a>
                    )}
                    {it.done_at && (
                      <span>
                        完成 {formatStampZh(it.done_at)}
                        {it.done_by && ` ・${nameOf(it.done_by)}`}
                      </span>
                    )}
                  </div>
                </div>
                {canManage && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-muted-foreground hover:text-destructive"
                    onClick={() => onDelete(it)}
                    title="刪除這項代辦"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {canManage && !isError && (
        <div className="flex flex-wrap items-end gap-2 pt-1">
          <div className="flex-1 min-w-[12rem]">
            <span className="text-xs text-muted-foreground">事項</span>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例：追蹤 A 客戶報價回覆"
              className="h-8 text-sm"
            />
          </div>
          <div className="w-40">
            <span className="text-xs text-muted-foreground">指派給</span>
            <Select value={assignee} onValueChange={setAssignee}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={FOLLOW_DEPUTY}>同本次代理人</SelectItem>
                {activeUsers.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-56">
            <span className="text-xs text-muted-foreground">連結（選填）</span>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https:// 或 file:// 或 \\server\share"
              className="h-8 text-sm"
            />
          </div>
          <Button size="sm" className="h-8" disabled={adding} onClick={() => void submitAdd()}>
            <Plus className="w-3.5 h-3.5 mr-1" />
            {adding ? "新增中…" : "新增"}
          </Button>
        </div>
      )}
    </div>
  );
}
