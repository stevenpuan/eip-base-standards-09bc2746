import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Inbox, ExternalLink } from "lucide-react";

// eip_handover_item 尚未進 types.ts，用寬鬆型別的 client
import { supabase } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

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

/**
 * 「我的工作區」的代辦事項區塊（規劃圖第 ⑥ 類）。
 *
 * 交接待辦原本只在獨立頁面看得到，工作區完全不知道有這回事。
 * 這裡只做「有幾筆、是什麼」的提示與跳轉，不在工作區處理 ——
 * 處理動作（接手／取消）留在交接待辦頁一處，避免兩邊都能改狀態。
 *
 * 沒有待處理項目時整塊不顯示，不佔工作區版面。
 */
export function HandoverInboxCard({ meId }: { meId: string }) {
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

  const rows = q.data ?? [];
  // 載入中或本來就沒有待辦 → 不顯示（錯誤才需要讓人知道）
  if (q.isLoading || (!q.isError && rows.length === 0)) return null;

  if (q.isError) {
    return (
      <Card className="mb-3">
        <CardContent className="p-3 flex items-center gap-2 text-xs">
          <Inbox className="w-4 h-4 text-muted-foreground shrink-0" />
          <span className="text-destructive">代辦事項載入失敗</span>
          <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => void q.refetch()}>
            重試
          </Button>
        </CardContent>
      </Card>
    );
  }

  const escalated = rows.filter((r) => r.escalated_level > 0).length;

  return (
    <Card className="mb-3 border-accent/40">
      <CardContent className="p-3">
        <div className="flex items-center gap-2 mb-2">
          <Inbox className="w-4 h-4 text-accent shrink-0" />
          <span className="text-sm font-semibold">待我接手</span>
          <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">
            {rows.length}
          </span>
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
        <div className="space-y-1">
          {rows.slice(0, 5).map((r) => (
            <div key={r.id} className="flex items-center gap-2 text-sm rounded-md border px-2 py-1.5">
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
                {ENTITY_LABEL[r.entity_type] ?? r.entity_type}
              </span>
              <span className="flex-1 min-w-0 truncate">{r.entity_title ?? "（無標題）"}</span>
            </div>
          ))}
          {rows.length > 5 && (
            <div className="text-[11px] text-muted-foreground pl-1">
              另有 {rows.length - 5} 筆，請到交接待辦頁查看
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
