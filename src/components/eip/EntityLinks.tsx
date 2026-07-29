import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Link2, Plus, Trash2, ExternalLink } from "lucide-react";
import { Link } from "@tanstack/react-router";

// eip_link 尚未進 src/integrations/supabase/types.ts，用 any 版 client，型別在本檔宣告。
import { supabase } from "@/lib/supabase";
import { useEipUser } from "@/lib/eip-user";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** eip_link 支援的實體類別（與 DB 的 CHECK constraint 一致） */
export type LinkEntity =
  | "task"
  | "meeting"
  | "meeting_action_item"
  | "project"
  | "document"
  | "quick_report"
  | "work_log"
  | "announcement"
  | "defect"
  | "feature_request";

type Row = {
  id: string;
  from_type: string;
  from_id: string;
  to_type: string;
  to_id: string;
  relation: string;
  note: string | null;
  created_by: string | null;
};

/** 可以連到的目標類別：只放「有頁面可以跳過去」的，避免連了卻打不開 */
const TARGETS: { value: LinkEntity; label: string; table: string; titleCol: string }[] = [
  { value: "document", label: "文件", table: "eip_document", titleCol: "title" },
  { value: "meeting", label: "會議", table: "meeting", titleCol: "title" },
  { value: "project", label: "專案", table: "project", titleCol: "name" },
  { value: "defect", label: "異常缺失", table: "eip_anomaly", titleCol: "title" },
  { value: "task", label: "任務", table: "task", titleCol: "title" },
];

const RELATIONS = [
  { value: "related", label: "相關" },
  { value: "source_of", label: "來源" },
  { value: "follow_up", label: "後續追蹤" },
  { value: "blocks", label: "阻擋" },
  { value: "duplicates", label: "重複" },
];

const relLabel = (v: string) => RELATIONS.find((r) => r.value === v)?.label ?? v;
const targetOf = (t: string) => TARGETS.find((x) => x.value === t);

/**
 * 通用實體連結（eip_link）。
 *
 * 已知限制（DB 端也寫在 table comment 裡）：eip_link 的 RLS 只能做到 tenant 層級 ——
 * 政策裡沒辦法動態檢查兩端實體的可見性。所以「對方的標題」一律回原表查，
 * 讓那張表自己的 RLS 把關；查不到就顯示「無權檢視或已刪除」，不會洩漏內容。
 */
export function EntityLinks({
  entityType,
  entityId,
  readOnly = false,
}: {
  entityType: LinkEntity;
  entityId: string;
  readOnly?: boolean;
}) {
  const { appUser } = useEipUser();
  const { can } = useAuth();
  const isAdmin = can("users", "edit");

  const [rows, setRows] = useState<Row[]>([]);
  // string=標題、""=有資料但沒標題、null=查不到（無權檢視或已刪除）、undefined=還沒查
  const [titles, setTitles] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  const [targetType, setTargetType] = useState<LinkEntity>("document");
  const [relation, setRelation] = useState("related");
  const [keyword, setKeyword] = useState("");
  const [picked, setPicked] = useState<{ id: string; title: string } | null>(null);
  const [candidates, setCandidates] = useState<{ id: string; title: string }[]>([]);

  const load = async () => {
    // 連結是雙向的：這個實體可能在 from 或 to 任一側
    const { data, error } = await supabase
      .from("eip_link")
      .select("*")
      .or(
        `and(from_type.eq.${entityType},from_id.eq.${entityId}),` +
          `and(to_type.eq.${entityType},to_id.eq.${entityId})`,
      )
      .order("created_at", { ascending: false });
    if (error) {
      toast.error(`連結載入失敗：${error.message}`);
      setLoading(false);
      return;
    }
    setRows((data ?? []) as Row[]);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, entityId]);

  /** 對方那一側 */
  const others = useMemo(
    () =>
      rows.map((r) => {
        const isFrom = r.from_type === entityType && r.from_id === entityId;
        return {
          row: r,
          otherType: isFrom ? r.to_type : r.from_type,
          otherId: isFrom ? r.to_id : r.from_id,
        };
      }),
    [rows, entityType, entityId],
  );

  // 逐類別批次解析標題（各表 RLS 自己把關，查不到就是沒權限或已刪除）
  useEffect(() => {
    if (!others.length) return;
    let alive = true;
    void (async () => {
      const byType = new Map<string, string[]>();
      others.forEach((o) => {
        const t = targetOf(o.otherType);
        if (!t) return;
        byType.set(o.otherType, [...(byType.get(o.otherType) ?? []), o.otherId]);
      });
      // null 是哨兵值＝「查過了但查不到」（沒權限或已刪除）。
      // 一定要把查不到的 id 也填進來，否則 titles[key] 永遠是 undefined，
      // 畫面會一直停在「載入中…」，跨部門連結幾乎必踩。
      const acc: Record<string, string | null> = {};
      for (const [type, ids] of byType) {
        const t = targetOf(type)!;
        const res = await supabase.from(t.table).select(`id,${t.titleCol}`).in("id", ids);
        // 表名是動態的，typed client 的 select parser 解不出來，這裡明確轉成寬鬆型別
        const found = (res.data ?? []) as unknown as Record<string, unknown>[];
        const hit = new Set<string>();
        found.forEach((d) => {
          hit.add(String(d.id));
          acc[`${type}:${String(d.id)}`] = String(d[t.titleCol] ?? "");
        });
        ids.forEach((id) => { if (!hit.has(id)) acc[`${type}:${id}`] = null; });
      }
      if (alive) setTitles(acc);
    })();
    return () => {
      alive = false;
    };
  }, [others]);

  // 挑選目標：依關鍵字查候選
  useEffect(() => {
    if (!adding) return;
    const t = targetOf(targetType);
    if (!t) return;
    let alive = true;
    const timer = setTimeout(async () => {
      // 有寫「最近 20 筆」就必須真的排序，否則使用者搜不到明明存在的項目
      let q = supabase
        .from(t.table)
        .select(`id,${t.titleCol}`)
        .order("created_at", { ascending: false })
        .limit(20);
      const kw = keyword.trim().replace(/[,()\\%*"']/g, "");
      if (kw) q = q.ilike(t.titleCol, `%${kw}%`);
      const { data } = await q;
      if (!alive) return;
      const found = (data ?? []) as unknown as Record<string, unknown>[];
      setCandidates(
        found
          .map((d) => ({ id: String(d.id), title: String(d[t.titleCol] ?? "") }))
          // 不要把自己列進去
          .filter((c) => !(targetType === entityType && c.id === entityId)),
      );
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [adding, targetType, keyword, entityType, entityId]);

  const add = async () => {
    if (!picked) return toast.error("請先選擇要連結的項目");
    setBusy(true);
    const { error } = await supabase.from("eip_link").insert({
      from_type: entityType,
      from_id: entityId,
      to_type: targetType,
      to_id: picked.id,
      relation,
    });
    setBusy(false);
    if (error) {
      // 唯一索引擋重複連結
      if (error.code === "23505") return toast.error("這個連結已經建立過了");
      return toast.error(`建立連結失敗：${error.message}`);
    }
    toast.success("已建立連結");
    setPicked(null);
    setKeyword("");
    setAdding(false);
    void load();
  };

  const remove = async (r: Row) => {
    if (!window.confirm("移除這個連結？（只移除關聯，不會刪除任何資料）")) return;
    const { error } = await supabase.from("eip_link").delete().eq("id", r.id);
    if (error) return toast.error(`移除失敗：${error.message}`);
    void load();
  };

  const canRemove = (r: Row) => isAdmin || r.created_by === appUser?.id;

  return (
    <div className="mt-2 border-t pt-3">
      <div className="text-sm font-medium mb-2 flex items-center gap-1.5">
        <Link2 className="w-3.5 h-3.5" />
        相關連結
        {rows.length > 0 && (
          <span className="text-xs text-muted-foreground font-normal">{rows.length}</span>
        )}
      </div>

      {loading ? (
        <div className="text-xs text-muted-foreground">載入中…</div>
      ) : rows.length === 0 ? (
        <div className="text-xs text-muted-foreground">
          尚無連結。可以把相關的文件、會議、專案或異常缺失掛上來，之後從任一邊都看得到。
        </div>
      ) : (
        <div className="space-y-1">
          {others.map(({ row, otherType, otherId }) => {
            const t = targetOf(otherType);
            const title = titles[`${otherType}:${otherId}`];
            return (
              <div key={row.id} className="flex items-center gap-2 rounded-md border px-2 py-1.5">
                <span className="text-[12.5px] text-muted-foreground shrink-0">
                  {t?.label ?? otherType}・{relLabel(row.relation)}
                </span>
                <span className="text-sm flex-1 min-w-0 truncate">
                  {title === undefined ? (
                    <span className="text-muted-foreground">載入中…</span>
                  ) : title === null ? (
                    <span className="text-muted-foreground">（無權檢視或已刪除）</span>
                  ) : title === "" ? (
                    <span className="text-muted-foreground">（無標題）</span>
                  ) : (
                    title
                  )}
                </span>
                <TargetLink type={otherType} id={otherId} known={!!title} />
                {!readOnly && canRemove(row) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 w-6 p-0 shrink-0"
                    onClick={() => void remove(row)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!readOnly && !adding && (
        <Button size="sm" variant="outline" className="mt-2" onClick={() => setAdding(true)}>
          <Plus className="w-3.5 h-3.5 mr-1" />
          新增連結
        </Button>
      )}

      {!readOnly && adding && (
        <div className="mt-2 space-y-2 rounded-md border p-2">
          <div className="flex gap-2">
            <Select
              value={targetType}
              onValueChange={(v) => {
                setTargetType(v as LinkEntity);
                setPicked(null);
                setCandidates([]);
              }}
            >
              <SelectTrigger className="w-32 h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TARGETS.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={relation} onValueChange={setRelation}>
              <SelectTrigger className="w-28 h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RELATIONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              className="h-8 flex-1"
              placeholder="輸入關鍵字搜尋…"
              value={keyword}
              onChange={(e) => {
                setKeyword(e.target.value);
                setPicked(null);
              }}
            />
          </div>

          {picked ? (
            <div className="text-sm flex items-center gap-2">
              <span className="text-muted-foreground text-xs">已選：</span>
              <span className="flex-1 truncate">{picked.title || "（無標題）"}</span>
              <Button size="sm" variant="ghost" onClick={() => setPicked(null)}>
                改選
              </Button>
            </div>
          ) : candidates.length === 0 ? (
            <div className="text-xs text-muted-foreground">
              {keyword.trim()
                ? "沒有符合的項目（也可能是你沒有檢視權限）"
                : "顯示最近 20 筆，可輸入關鍵字縮小範圍"}
            </div>
          ) : (
            <div className="max-h-40 overflow-y-auto space-y-0.5">
              {candidates.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="block w-full text-left text-sm px-2 py-1 rounded hover:bg-accent truncate"
                  onClick={() => setPicked(c)}
                >
                  {c.title || "（無標題）"}
                </button>
              ))}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setAdding(false);
                setPicked(null);
                setKeyword("");
              }}
            >
              取消
            </Button>
            <Button size="sm" disabled={busy || !picked} onClick={() => void add()}>
              {busy ? "建立中…" : "建立連結"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** 跳到對方的頁面。查不到標題就代表沒權限或已刪除，不給連結。 */
function TargetLink({ type, id, known }: { type: string; id: string; known: boolean }) {
  if (!known) {
    return (
      <span className="text-[12.5px] text-muted-foreground shrink-0" title="沒有檢視權限或已被刪除">
        無法開啟
      </span>
    );
  }
  const cls = "shrink-0 text-muted-foreground hover:text-foreground";
  const icon = <ExternalLink className="w-3.5 h-3.5" />;
  if (type === "task")
    return (
      <Link to="/dashboard/eip/tasks" search={{ openTask: id }} className={cls} title="開啟任務">
        {icon}
      </Link>
    );
  if (type === "meeting")
    return (
      <Link to="/dashboard/eip/meetings/$id" params={{ id }} className={cls} title="開啟會議">
        {icon}
      </Link>
    );
  if (type === "project")
    return (
      <Link to="/dashboard/eip/projects/$id" params={{ id }} className={cls} title="開啟專案">
        {icon}
      </Link>
    );
  if (type === "document")
    return (
      <Link to="/dashboard/eip/documents" className={cls} title="開啟文件中心">
        {icon}
      </Link>
    );
  if (type === "defect")
    return (
      <Link to="/dashboard/eip/anomalies" className={cls} title="開啟異常缺失">
        {icon}
      </Link>
    );
  return null;
}
