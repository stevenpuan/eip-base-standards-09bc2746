import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Inbox, ExternalLink, Link2 } from "lucide-react";
import { toast } from "sonner";

// eip_handover_item 與 eip_leave_handover_item 尚未進 types.ts，用寬鬆型別的 client
import { supabase } from "@/lib/supabase";
import { useAllUsers } from "@/hooks/useUsers";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

const ENTITY_LABEL: Record<string, string> = {
  task: "任務",
  task_collaborator: "任務協作",
  project: "專案",
  recurring_rule: "常態工作",
  meeting_action_item: "會議決議",
  deputy: "職務代理人",
};

type Row = {
  id: string;
  entity_type: string;
  entity_title: string | null;
  escalated_level: number;
};

/** eip_leave_handover_item + 所屬請假單的請假人與區間 */
type LeaveRow = {
  id: string;
  title: string;
  url: string | null;
  quick_report_id: string;
  done_at: string | null;
  submitter_id: string | null;
  leave_from: string | null;
  leave_to: string | null;
};

// 請假區間只需要「哪幾天」，用本地日期字串；toISOString() 在 UTC+8 會退回前一天
const localDate = (iso: string) => new Date(iso).toLocaleDateString("sv-SE");

// 寫回 done_at 用「帶時區位移」的本地時間戳，同樣是為了避開 UTC 字串造成的日期偏移
function nowWithOffset() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const offMin = -d.getTimezoneOffset();
  const abs = Math.abs(offMin);
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}` +
    `${offMin >= 0 ? "+" : "-"}${p(Math.floor(abs / 60))}:${p(abs % 60)}`
  );
}
const formatRange = (from: string | null, to: string | null) => {
  if (!from && !to) return "未填區間";
  if (from && to) {
    const a = localDate(from);
    const b = localDate(to);
    return a === b ? a : `${a} ～ ${b}`;
  }
  return localDate((from ?? to) as string);
};

/**
 * 「我的工作區」的代辦事項區塊（規劃圖第 ⑥ 類）。
 *
 * 兩段來源都是「別人的事落到我身上」，放同一張卡才不會讓人以為只有離職交接：
 *  - 離職交接（eip_handover_item）：只提示與跳轉，處理動作留在交接待辦頁一處，
 *    避免兩邊都能改狀態。
 *  - 請假代辦（eip_leave_handover_item）：可以直接勾完成 —— 這類項目本來就是
 *    「代理人做完就打勾」，多繞一頁反而沒人打勾；請假單的 status 由 DB trigger
 *    依完成度回寫，前端只寫 done_at。
 *
 * 兩段都沒東西時整塊不顯示，不佔工作區版面。
 */
export function HandoverInboxCard({ meId }: { meId: string }) {
  const qc = useQueryClient();
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  const q = useQuery({
    enabled: !!meId,
    queryKey: ["eip", "handover-inbox", meId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("eip_handover_item")
        .select("id,entity_type,entity_title,escalated_level")
        .eq("assignee_id", meId)
        .eq("status", "pending")
        .order("escalated_level", { ascending: false })
        .order("created_at", { ascending: true })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });

  const leaveKey = useMemo(() => ["eip", "leave-handover-inbox", meId] as const, [meId]);
  const leaveQ = useQuery({
    enabled: !!meId,
    queryKey: leaveKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("eip_leave_handover_item")
        .select("id,title,url,quick_report_id,done_at")
        .eq("assignee_id", meId)
        .is("done_at", null)
        .order("created_at", { ascending: true })
        .limit(20);
      if (error) throw error;
      const items = (data ?? []) as unknown as Omit<
        LeaveRow,
        "submitter_id" | "leave_from" | "leave_to"
      >[];
      if (items.length === 0) return [] as LeaveRow[];

      // 請假人與區間分開查：這張表還沒進 types.ts，巢狀 select 的關聯名稱無法用型別驗證，
      // 拆成兩次查詢出錯時比較容易判斷是哪一段被 RLS 擋掉
      const reportIds = Array.from(new Set(items.map((i) => i.quick_report_id)));
      const { data: reports, error: repErr } = await supabase
        .from("eip_quick_report")
        .select("id,submitter_id,leave_from,leave_to")
        .in("id", reportIds);
      if (repErr) throw repErr;
      const byId = new Map(
        (
          (reports ?? []) as unknown as {
            id: string;
            submitter_id: string | null;
            leave_from: string | null;
            leave_to: string | null;
          }[]
        ).map((r) => [r.id, r]),
      );
      return items.map((i) => {
        const rep = byId.get(i.quick_report_id);
        return {
          ...i,
          submitter_id: rep?.submitter_id ?? null,
          leave_from: rep?.leave_from ?? null,
          leave_to: rep?.leave_to ?? null,
        } satisfies LeaveRow;
      });
    },
  });

  // 請假人可能已停用，姓名對照要用含停用的版本
  const usersQ = useAllUsers();
  const nameMap = useMemo(() => {
    const m = new Map<string, string>();
    (usersQ.data ?? []).forEach((u) => m.set(u.id, u.name ?? "—"));
    return m;
  }, [usersQ.data]);
  const nameOf = (id: string | null) => (id ? (nameMap.get(id) ?? "—") : "—");

  const rows = q.data ?? [];
  const leaveRows = leaveQ.data ?? [];
  const total = rows.length + leaveRows.length;
  const hasError = q.isError || leaveQ.isError;

  // 沒東西可顯示（含載入中，data 尚未回來）就整塊不顯示；只有錯誤才需要讓人知道
  if (!hasError && total === 0) return null;

  // 勾完成：done_by 由 trigger 蓋章，前端只寫 done_at
  const toggleLeaveDone = async (row: LeaveRow) => {
    if (busyIds.has(row.id)) return;
    setBusyIds((p) => new Set(p).add(row.id));
    const prev = qc.getQueryData<LeaveRow[]>(leaveKey);
    // 樂觀更新：勾完即從清單消失（本卡只列未完成），失敗再還原
    qc.setQueryData<LeaveRow[]>(leaveKey, (cur) => (cur ?? []).filter((x) => x.id !== row.id));
    const { error } = await supabase
      .from("eip_leave_handover_item")
      .update({ done_at: nowWithOffset() })
      .eq("id", row.id);
    setBusyIds((p) => {
      const next = new Set(p);
      next.delete(row.id);
      return next;
    });
    if (error) {
      if (prev) qc.setQueryData(leaveKey, prev);
      toast.error(`更新失敗：${error.message}`);
      return;
    }
    toast.success("已標記完成");
    void leaveQ.refetch();
    // 請假單 status 由 trigger 依完成度回寫，臨時回報頁要跟著重讀
    void qc.invalidateQueries({ queryKey: ["eip", "quick-reports"] });
  };

  const escalated = rows.filter((r) => r.escalated_level > 0).length;

  return (
    <Card className="mb-3 border-accent/40">
      <CardContent className="p-3">
        <div className="flex items-center gap-2 mb-2">
          <Inbox className="w-4 h-4 text-accent shrink-0" />
          <span className="text-sm font-semibold">待我處理</span>
          {total > 0 && (
            <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">
              {total}
            </span>
          )}
        </div>

        {/* 離職交接 */}
        {(q.isError || rows.length > 0) && (
          <div className="mb-3">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-xs font-medium text-muted-foreground">離職交接</span>
              {escalated > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-destructive/10 text-destructive">
                  {escalated} 筆已催辦
                </span>
              )}
              <div className="flex-1" />
              <Button asChild size="sm" variant="ghost" className="h-7 text-xs">
                <Link to="/dashboard/eip/handover">
                  前往處理
                  <ExternalLink className="w-3 h-3 ml-1" />
                </Link>
              </Button>
            </div>
            {q.isError ? (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-destructive">離職交接載入失敗</span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-xs"
                  onClick={() => void q.refetch()}
                >
                  重試
                </Button>
              </div>
            ) : (
              <div className="space-y-1">
                {rows.slice(0, 5).map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center gap-2 text-sm rounded-md border px-2 py-1.5"
                  >
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
                      {ENTITY_LABEL[r.entity_type] ?? r.entity_type}
                    </span>
                    <span className="flex-1 min-w-0 truncate">
                      {r.entity_title ?? "（無標題）"}
                    </span>
                  </div>
                ))}
                {rows.length > 5 && (
                  <div className="text-[11px] text-muted-foreground pl-1">
                    另有 {rows.length - 5} 筆，請到交接待辦頁查看
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* 請假代辦 */}
        {(leaveQ.isError || leaveRows.length > 0) && (
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-xs font-medium text-muted-foreground">請假代辦</span>
              <div className="flex-1" />
              <Button asChild size="sm" variant="ghost" className="h-7 text-xs">
                <Link to="/dashboard/eip/quick-reports">
                  查看請假單
                  <ExternalLink className="w-3 h-3 ml-1" />
                </Link>
              </Button>
            </div>
            {leaveQ.isError ? (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-destructive">請假代辦載入失敗</span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-xs"
                  onClick={() => void leaveQ.refetch()}
                >
                  重試
                </Button>
              </div>
            ) : (
              <div className="space-y-1">
                {leaveRows.slice(0, 5).map((row) => (
                  <div
                    key={row.id}
                    className="flex items-start gap-2 text-sm rounded-md border px-2 py-1.5"
                  >
                    <Checkbox
                      className="mt-0.5"
                      checked={false}
                      disabled={busyIds.has(row.id)}
                      onCheckedChange={() => void toggleLeaveDone(row)}
                      aria-label="標記完成"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="break-words">{row.title}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {nameOf(row.submitter_id)} 請假 {formatRange(row.leave_from, row.leave_to)}
                      </div>
                    </div>
                    {row.url && (
                      <a
                        href={row.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline shrink-0 mt-0.5"
                        title="開啟連結"
                      >
                        <Link2 className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </div>
                ))}
                {leaveRows.length > 5 && (
                  <div className="text-[11px] text-muted-foreground pl-1">
                    另有 {leaveRows.length - 5} 筆，請到臨時回報頁查看
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
