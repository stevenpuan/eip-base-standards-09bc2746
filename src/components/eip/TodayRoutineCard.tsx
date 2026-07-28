import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ListChecks, Clock, ExternalLink } from "lucide-react";
import { toast } from "sonner";

import {
  fetchRoutineToday,
  toggleRoutineItem,
  taipeiToday,
  ROUTINE_SOURCE_LABEL,
  type RoutineRow,
} from "@/lib/eip-routine";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";

/**
 * 「我的工作區」的今日例行區塊。
 *
 * 為什麼要有這一塊（規劃圖第 ① 類）：
 *  個人例行範本是「範本」不是任務，沒有 owner／status／due_date，
 *  每天由 eip_worklog_seed 展開成工作日誌的項目。原本只有進工作日誌，
 *  所以「我的工作區」號稱單一入口卻看不到今天要做的例行 —— 這一塊補的就是它。
 *
 * 勾選會立即寫進今天的日誌（走 eip_toggle_routine_item，全系統唯一的寫入實作）。
 * 「執行內容」不在這裡編輯：那是工作日誌的職責，避免同一份文字兩邊都能改。
 */
export function TodayRoutineCard() {
  const date = taipeiToday();
  const [busy, setBusy] = useState<string | null>(null);
  const [rows, setRows] = useState<RoutineRow[] | null>(null);

  const q = useQuery({
    queryKey: ["eip", "routine-today", date],
    queryFn: () => fetchRoutineToday(date),
  });

  // 樂觀更新用的本地副本；query 重抓後以 server 為準
  const list = rows ?? q.data ?? [];
  const keyOf = (r: RoutineRow) => `${r.section}:${r.source ?? ""}:${r.ref_id ?? r.text}`;

  const { morning, afternoon, done, total } = useMemo(
    () => ({
      morning: list.filter((r) => r.section === "morning"),
      afternoon: list.filter((r) => r.section === "afternoon"),
      done: list.filter((r) => r.done).length,
      total: list.length,
    }),
    [list],
  );

  const toggle = async (r: RoutineRow) => {
    const k = keyOf(r);
    if (busy) return;
    setBusy(k);
    const next = !r.done;
    setRows(list.map((x) => (keyOf(x) === k ? { ...x, done: next } : x)));
    try {
      await toggleRoutineItem({
        date,
        section: r.section,
        done: next,
        source: r.source,
        refId: r.ref_id,
        text: r.text,
      });
      const fresh = await fetchRoutineToday(date);
      setRows(fresh);
      if (next && r.require_content) {
        toast.info("這項需要填執行內容，請到工作日誌補寫後再送出");
      }
    } catch (e) {
      // 失敗一律回到 server 狀態，不留假的勾選
      toast.error(`更新失敗：${e instanceof Error ? e.message : String(e)}`);
      try {
        setRows(await fetchRoutineToday(date));
      } catch {
        setRows(null);
        void q.refetch();
      }
    } finally {
      setBusy(null);
    }
  };

  if (q.isLoading) {
    return (
      <Card className="mb-3">
        <CardContent className="p-3 text-xs text-muted-foreground">今日例行載入中…</CardContent>
      </Card>
    );
  }

  if (q.isError) {
    return (
      <Card className="mb-3">
        <CardContent className="p-3 flex items-center gap-2 text-xs">
          <span className="text-destructive">今日例行載入失敗</span>
          <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => void q.refetch()}>
            重試
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mb-3">
      <CardContent className="p-3">
        <div className="flex items-center gap-2 mb-2">
          <ListChecks className="w-4 h-4 text-primary shrink-0" />
          <span className="text-sm font-semibold">今天的例行</span>
          {total > 0 && (
            <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">
              {done}/{total}
            </span>
          )}
          <div className="flex-1" />
          <Button asChild size="sm" variant="ghost" className="h-7 text-xs">
            <Link to="/dashboard/eip/work-log">
              工作日誌
              <ExternalLink className="w-3 h-3 ml-1" />
            </Link>
          </Button>
        </div>

        {total === 0 ? (
          <div className="text-xs text-muted-foreground">
            今天沒有例行項目。個人例行範本在
            <Link to="/dashboard/eip/personal-routine" className="text-primary hover:underline mx-1">
              個人例行
            </Link>
            設定（時段、週期），設定好之後每天會自動出現在這裡與工作日誌。
          </div>
        ) : (
          <div className="space-y-2">
            <RoutineGroup label="上午 / 全天" Icon={ListChecks} rows={morning} busy={busy} keyOf={keyOf} onToggle={toggle} />
            <RoutineGroup label="下午" Icon={Clock} rows={afternoon} busy={busy} keyOf={keyOf} onToggle={toggle} />
            <p className="text-[11px] text-muted-foreground pt-0.5">
              勾選會立即存進今天的日誌，不需要再按儲存。執行內容請到工作日誌填寫。
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RoutineGroup({
  label,
  Icon,
  rows,
  busy,
  keyOf,
  onToggle,
}: {
  label: string;
  Icon: typeof ListChecks;
  rows: RoutineRow[];
  busy: string | null;
  keyOf: (r: RoutineRow) => string;
  onToggle: (r: RoutineRow) => void;
}) {
  if (!rows.length) return null;
  return (
    <div>
      <div className="text-[11px] text-muted-foreground flex items-center gap-1 mb-1">
        <Icon className="w-3 h-3" />
        {label}
      </div>
      <div className="space-y-1">
        {rows.map((r) => {
          const k = keyOf(r);
          return (
            <div key={k} className="flex items-center gap-2 rounded-md border px-2 py-1.5">
              <Checkbox
                checked={r.done}
                disabled={busy === k}
                onCheckedChange={() => onToggle(r)}
              />
              <span className={`text-sm flex-1 min-w-0 truncate ${r.done ? "line-through text-muted-foreground" : ""}`}>
                {r.text}
              </span>
              {r.source && ROUTINE_SOURCE_LABEL[r.source] && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
                  {ROUTINE_SOURCE_LABEL[r.source]}
                </span>
              )}
              {r.require_content && (
                <span
                  className={`text-[10px] shrink-0 ${r.done && !r.note ? "text-destructive font-medium" : "text-amber-600"}`}
                  title="需填執行內容（送出日誌前必填）"
                >
                  需填
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
