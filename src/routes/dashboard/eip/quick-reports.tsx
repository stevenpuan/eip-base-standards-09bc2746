import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Inbox } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useEipUser } from "@/lib/eip-user";
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
const STATUS_LABEL: Record<string, string> = {
  open: "待處理",
  acknowledged: "已處理",
  done: "已處理",
  closed: "已處理",
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
  const { loading: authLoading, can } = useAuth();
  const { appUser } = useEipUser();
  // 進頁與清單顯示一律讀「角色權限設定」（臨時回報模組檢視權），不寫死角色。
  // 一般同仁有檢視權時，RLS 會只回傳「自己送出的」紀錄；主管則看部門/全公司。
  const canView = can("eip_quick_reports", "view");

  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState<string>("");
  const [keyword, setKeyword] = useState("");

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

  const usersQ = useQuery({
    queryKey: ["eip", "app_user", "lite"],
    queryFn: async () => {
      const { data } = await supabase.from("app_user").select("id,name");
      return (data ?? []) as { id: string; name: string | null }[];
    },
  });
  const nameMap = useMemo(() => {
    const m = new Map<string, string>();
    (usersQ.data ?? []).forEach((u) => m.set(u.id, u.name ?? u.id));
    return m;
  }, [usersQ.data]);

  const rows = useMemo(() => {
    const all = listQ.data ?? [];
    return all.filter((r) => {
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
  }, [listQ.data, typeFilter, statusFilter, dateFilter, keyword, nameMap]);

  if (authLoading) return <div className="text-muted-foreground">載入中…</div>;
  if (!canView) return <Navigate to="/dashboard/eip/my-tasks" />;

  const ack = async (id: string) => {
    const { error } = await supabase
      .from("eip_quick_report")
      .update({ status: "acknowledged" })
      .eq("id", id);
    if (error) return toast.error(`更新失敗：${error.message}`);
    toast.success("已標記為已處理");
    void listQ.refetch();
  };

  const hasFilter = typeFilter !== "all" || statusFilter !== "all" || dateFilter || keyword;
  // 是否可執行「確認」動作（處理他人回報）：讀臨時回報編輯權
  const canAck = can("eip_quick_reports", "edit");

  return (
    <div className="space-y-4">
      <PageHeader title="臨時回報" description="檢視遲到 / 請假 / 事件回報（同仁看自己的，主管看部門）。" />

      <div className="flex flex-wrap items-center gap-2">
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部類型</SelectItem>
            <SelectItem value="late">遲到</SelectItem>
            <SelectItem value="leave">請假</SelectItem>
            <SelectItem value="other">事件</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
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
          <Button variant="ghost" size="sm" onClick={() => { setTypeFilter("all"); setStatusFilter("all"); setDateFilter(""); setKeyword(""); }}>
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
                          {r.detail && <div className="text-muted-foreground text-xs mt-0.5">{r.detail}</div>}
                        </div>
                      )}
                      {r.type === "leave" && (
                        <div className="text-sm">
                          {formatLeave(r.leave_from, r.leave_to)}
                          {r.detail && <div className="text-muted-foreground text-xs mt-0.5">{r.detail}</div>}
                        </div>
                      )}
                      {r.type === "other" && (
                        <div className="text-sm">{r.detail ?? "—"}</div>
                      )}
                      {r.type !== "late" && r.type !== "leave" && r.type !== "other" && (
                        <div className="text-sm text-muted-foreground">{r.detail ?? "—"}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap">
                      {r.report_date}
                      <div className="text-xs text-muted-foreground">
                        {new Date(r.created_at).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={isDone
                          ? "bg-emerald-100 text-emerald-700 border-emerald-300"
                          : "bg-amber-100 text-amber-700 border-amber-300"}
                      >
                        {STATUS_LABEL[r.status] ?? r.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {!isDone && canAck && (
                        <Button size="sm" variant="outline" onClick={() => ack(r.id)}>確認</Button>
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
