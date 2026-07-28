import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Inbox } from "lucide-react";
// eip_quick_report 的 submitted_at / done_at / done_by / handover_note 尚未進
// src/integrations/supabase/types.ts，故本頁改用 any 版 client（型別在本檔自行宣告）。
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { useEipUser } from "@/lib/eip-user";
import { useAllUsers } from "@/hooks/useUsers";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
  leave_type: string | null;
};

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

function QuickReportsPage() {
  const { loading: authLoading, permsLoaded, can } = useAuth();
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

  // 標記代辦完成。請假類會由 DB trigger 發出第二段「代辦完成」通知給請假者與部門主管。
  const markDone = async (id: string) => {
    if (!appUser?.id) return;
    const { error } = await supabase
      .from("eip_quick_report")
      .update({ status: "done", done_at: new Date().toISOString(), done_by: appUser.id })
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
        description="檢視遲到 / 請假 / 事件回報（同仁看自己的，主管看部門）。請假不需簽核，送出後由代理人接手、處理完成後系統自動通知。"
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

      {listQ.isLoading ? (
        <div className="text-muted-foreground py-12 text-center">載入中…</div>
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
                return (
                  <TableRow key={r.id}>
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
                      {r.type === "leave" && (
                        <div className="text-sm">
                          {formatLeave(r.leave_from, r.leave_to)}
                          {r.detail && (
                            <div className="text-muted-foreground text-xs mt-0.5">{r.detail}</div>
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
                        送出{" "}
                        {new Date(r.submitted_at ?? r.created_at).toLocaleString("zh-TW", {
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
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
                          {new Date(r.done_at).toLocaleString("zh-TW", {
                            month: "2-digit",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                          {r.done_by && ` ・${nameMap.get(r.done_by) ?? ""}`}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {!isDone && canAck && (
                        <Button size="sm" variant="outline" onClick={() => void markDone(r.id)}>
                          {r.type === "leave" ? "代辦完成" : "標記完成"}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
