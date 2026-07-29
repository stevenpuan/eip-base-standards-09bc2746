import { EipUserPending } from "@/components/eip/EipUserPending";
import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { UserMinus, ArrowRight, Check, Inbox } from "lucide-react";

// eip_handover_item 尚未進 src/integrations/supabase/types.ts，
// 這裡用 any 形式的 client，型別在本檔自行宣告。
import { supabase } from "@/lib/supabase";
import { useEipUser } from "@/lib/eip-user";
import { useAuth } from "@/lib/auth";
import { useAllUsers } from "@/hooks/useUsers";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/dashboard/eip/handover")({
  component: HandoverPage,
});

/* ---------- 型別與文案 ---------- */

type EntityType =
  "task" | "task_collaborator" | "project" | "recurring_rule" | "meeting_action_item" | "deputy";

type HandoverItem = {
  id: string;
  leaver_id: string;
  entity_type: EntityType | string;
  entity_id: string;
  entity_title: string | null;
  assignee_id: string | null;
  assignee_reason: string | null;
  department_id: string | null;
  status: "pending" | "resolved" | "void" | string;
  resolution: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  escalated_level: number;
  created_at: string;
};

const ENTITY_LABEL: Record<string, string> = {
  task: "任務",
  task_collaborator: "任務協作",
  project: "專案",
  recurring_rule: "常態工作",
  meeting_action_item: "會議決議",
  deputy: "職務代理人",
};

const REASON_LABEL: Record<string, string> = {
  creator: "（您是建立者）",
  dept_manager: "（原建立者已離職，轉由您這位部門主管處理）",
  parent_dept_manager: "（轉由上層主管處理）",
  company_admin: "（查無適合處理人，轉由管理者處理）",
};

const STATUS_TABS = [
  { value: "pending", label: "待處理" },
  { value: "resolved", label: "已完成" },
  { value: "void", label: "已取消" },
] as const;

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

/* ---------- 主頁面 ---------- */

function HandoverPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { appUser } = useEipUser();
  const { can, permsLoaded } = useAuth();

  // 權限一律讀角色權限設定，不寫死角色字串
  const allowed = can("eip_handover", "view");
  const canResolve = can("eip_handover", "edit");

  const [tab, setTab] = useState<string>("pending");
  const [busyId, setBusyId] = useState<string | null>(null);

  // 離職者一定是已停用帳號，姓名對照必須用「含停用」的版本
  const usersQ = useAllUsers();
  const nameOf = useMemo(() => {
    const m = new Map<string, string>();
    (usersQ.data ?? []).forEach((u) => m.set(u.id, u.name ?? "—"));
    return (id: string | null) => (id ? (m.get(id) ?? "—") : "—");
  }, [usersQ.data]);

  // RLS 已限定可見範圍（指派給我／我是離職者／我管轄部門／管理者看全部），前端不再過濾
  const listQ = useQuery({
    queryKey: ["eip", "handover", tab],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("eip_handover_item")
        .select("*")
        .eq("status", tab)
        .order("escalated_level", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as HandoverItem[];
    },
  });

  const rows = useMemo(() => listQ.data ?? [], [listQ.data]);

  // 會議決議要導到「所屬會議」，需要先換出 meeting_id
  const actionIds = useMemo(
    () => rows.filter((r) => r.entity_type === "meeting_action_item").map((r) => r.entity_id),
    [rows],
  );
  const meetingOfQ = useQuery({
    queryKey: ["eip", "handover", "action-meetings", actionIds.join(",")],
    enabled: actionIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meeting_action_item")
        .select("id,meeting_id")
        .in("id", actionIds);
      if (error) throw error;
      const m = new Map<string, string>();
      ((data ?? []) as { id: string; meeting_id: string }[]).forEach((x) =>
        m.set(x.id, x.meeting_id),
      );
      return m;
    },
  });

  const goHandle = (r: HandoverItem) => {
    switch (r.entity_type) {
      case "task":
      case "task_collaborator":
        void navigate({ to: "/dashboard/eip/tasks", search: { openTask: r.entity_id } });
        break;
      case "project":
        void navigate({ to: "/dashboard/eip/projects/$id", params: { id: r.entity_id } });
        break;
      case "recurring_rule":
        void navigate({ to: "/dashboard/eip/recurring" });
        break;
      case "meeting_action_item": {
        if (meetingOfQ.isLoading) {
          toast.info("會議資料還在載入，請稍候再按");
          return;
        }
        const mid = meetingOfQ.data?.get(r.entity_id);
        if (!mid) {
          toast.error("找不到該行動項所屬的會議");
          return;
        }
        void navigate({ to: "/dashboard/eip/meetings/$id", params: { id: mid } });
        break;
      }
      case "deputy":
        void navigate({ to: "/dashboard/users" });
        break;
      default:
        toast.error(`未知的項目類別：${r.entity_type}`);
    }
  };

  // 只允許標記完成，不提供刪除；也不從前端 insert（RLS 已禁止）
  const resolve = async (r: HandoverItem) => {
    if (!appUser?.id || busyId) return;
    setBusyId(r.id);
    const { error } = await supabase
      .from("eip_handover_item")
      .update({
        status: "resolved",
        resolution: "使用者手動確認",
        resolved_by: appUser.id,
        resolved_at: new Date().toISOString(),
      })
      .eq("id", r.id);
    setBusyId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("已標記完成");
    void qc.invalidateQueries({ queryKey: ["eip", "handover"] });
    void qc.invalidateQueries({ queryKey: ["eip", "handover-pending-count"] });
  };

  if (!appUser) return <EipUserPending />;
  // 權限還沒載入完就判斷 allowed 會把有權限的人踢走（重新整理／書籤必中）
  if (!permsLoaded) return <div className="text-muted-foreground py-8">載入中…</div>;
  if (!allowed) return <Navigate to="/dashboard/eip/my-tasks" replace />;

  return (
    <div>
      <PageHeader
        title="交接待辦"
        description="同仁停用（離職）後，仍指向他且尚未結案的項目會列在這裡，由建立者或主管重新指派。改好負責人後系統隔天會自動結案，也可以直接按「我已處理完成」。"
      />

      <Tabs value={tab} onValueChange={setTab} className="mt-2">
        <TabsList>
          {STATUS_TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
              {t.value === tab && rows.length > 0 && (
                <span className="ml-1.5 text-xs text-muted-foreground">{rows.length}</span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Card className="mt-3">
        <CardContent className="p-0 overflow-x-auto">
          {listQ.isLoading ? (
            <div className="text-sm text-muted-foreground text-center py-8">載入中…</div>
          ) : listQ.isError ? (
            <div className="text-sm text-center py-8">
              <div className="text-destructive mb-2">載入失敗</div>
              <Button size="sm" variant="outline" onClick={() => listQ.refetch()}>
                重試
              </Button>
            </div>
          ) : !rows.length ? (
            <EmptyState tab={tab} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">類別</TableHead>
                  <TableHead>項目</TableHead>
                  <TableHead className="min-w-[16rem]">原因</TableHead>
                  <TableHead className="w-36">產生時間</TableHead>
                  <TableHead className="w-24">逾期</TableHead>
                  <TableHead className="w-52 text-right">動作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Badge variant="secondary">
                        {ENTITY_LABEL[r.entity_type] ?? r.entity_type}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium">{r.entity_title ?? "（無標題）"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      因 {nameOf(r.leaver_id)} 停用
                      {r.assignee_reason && REASON_LABEL[r.assignee_reason] && (
                        <span className="block">{REASON_LABEL[r.assignee_reason]}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {fmt(r.created_at)}
                    </TableCell>
                    <TableCell>
                      <OverdueBadge level={r.escalated_level} />
                    </TableCell>
                    <TableCell className="text-right">
                      {r.status === "pending" ? (
                        <div className="flex items-center justify-end gap-1.5">
                          <Button size="sm" variant="outline" onClick={() => goHandle(r)}>
                            前往處理
                            <ArrowRight className="w-3.5 h-3.5 ml-1" />
                          </Button>
                          {canResolve && (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busyId === r.id}
                              onClick={() => void resolve(r)}
                              title="立即標記完成，不用等隔天自動結案"
                            >
                              <Check className="w-3.5 h-3.5 mr-1" />
                              已處理
                            </Button>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {r.status === "resolved"
                            ? `${r.resolution ?? "已完成"}${r.resolved_at ? `・${fmt(r.resolved_at)}` : ""}`
                            : "已取消（帳號重新啟用）"}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {tab === "pending" && rows.length > 0 && (
        <p className="text-xs text-muted-foreground mt-2">
          任務類的項目可以在「任務」頁開啟「待重新指派」篩選，用批次改負責人一次處理多筆。
        </p>
      )}
    </div>
  );
}

/* ---------- 小元件 ---------- */

function OverdueBadge({ level }: { level: number }) {
  if (level >= 2) {
    return (
      <Badge
        variant="secondary"
        className="bg-destructive/10 text-destructive hover:bg-destructive/10"
      >
        逾期 7 天
      </Badge>
    );
  }
  if (level >= 1) {
    return (
      <Badge variant="secondary" className="bg-amber-100 text-amber-700 hover:bg-amber-100">
        逾期 3 天
      </Badge>
    );
  }
  return <span className="text-xs text-muted-foreground">—</span>;
}

function EmptyState({ tab }: { tab: string }) {
  const msg =
    tab === "pending"
      ? "目前沒有待處理的交接項目。"
      : tab === "resolved"
        ? "還沒有已完成的交接項目。"
        : "沒有已取消的交接項目。帳號被重新啟用時，未處理的項目會自動移到這裡。";
  const Icon = tab === "pending" ? UserMinus : Inbox;
  return (
    <div className="text-center py-12 px-6">
      <Icon className="w-8 h-8 mx-auto text-muted-foreground/50 mb-3" />
      <div className="text-sm text-muted-foreground max-w-md mx-auto">{msg}</div>
    </div>
  );
}
