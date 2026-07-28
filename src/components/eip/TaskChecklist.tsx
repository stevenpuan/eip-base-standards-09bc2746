import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ListChecks, Plus, Trash2, GripVertical } from "lucide-react";

// task_checklist 尚未進 src/integrations/supabase/types.ts，
// 這裡用 any 形式的 client，型別在本檔自行宣告。
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";

export type ChecklistItem = {
  id: string;
  task_id: string;
  title: string;
  is_done: boolean;
  done_at: string | null;
  done_by: string | null;
  sort_order: number;
};

/**
 * 任務子項清單。
 *
 * 設計決策（見 docs/批3-批6_後端變更紀錄.md）：
 *  ・用 task_checklist 新表，不沿用 task.parent_task_id（子任務當成 task 會污染看板）
 *  ・勾選語意＝「今天有做、納入回報」，**不是百分比**，所以不會去改 task.progress
 *  ・done_at / done_by 由 DB trigger 自動蓋與清空，前端不要手動塞
 *  ・排序用 eip_reorder_task_checklist RPC 一次寫回，不發 N 次 PATCH
 */
export function TaskChecklist({
  taskId,
  readOnly,
  nameOf,
  onCountChange,
}: {
  taskId: string;
  readOnly: boolean;
  nameOf?: (id: string | null) => string;
  onCountChange?: () => void;
}) {
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTitle, setNewTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());

  const load = async () => {
    const { data, error } = await supabase
      .from("task_checklist")
      .select("*")
      .eq("task_id", taskId)
      .order("sort_order");
    if (error) {
      toast.error(`子項載入失敗：${error.message}`);
      setLoading(false);
      return false;   // 呼叫端要知道「重讀失敗」，否則樂觀值會留在畫面上不被更正
    }
    setItems((data ?? []) as ChecklistItem[]);
    setLoading(false);
    return true;
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  const add = async () => {
    const title = newTitle.trim();
    if (!title) return;
    setBusy(true);
    // tenant_id / created_by / sort_order 由 trg_task_checklist_defaults 補
    const { error } = await supabase.from("task_checklist").insert({ task_id: taskId, title });
    setBusy(false);
    if (error) return toast.error(`新增失敗：${error.message}`);
    setNewTitle("");
    await load();
    onCountChange?.();
  };

  const toggle = async (it: ChecklistItem) => {
    if (pending.has(it.id)) return;   // 連點會送出多筆 update，且多個 load() 亂序回來畫面會停在錯的狀態
    setPending((p) => new Set(p).add(it.id));
    // 樂觀更新：勾選是最常用的動作，等 round-trip 會頓
    setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, is_done: !x.is_done } : x)));
    const { error } = await supabase
      .from("task_checklist")
      .update({ is_done: !it.is_done })
      .eq("id", it.id);
    if (error) {
      toast.error(`更新失敗：${error.message}`);
      // 重讀也失敗時要自己把樂觀值翻回來，不能留著假的勾選狀態
      if (!(await load())) {
        setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, is_done: it.is_done } : x)));
      }
      setPending((p) => { const n = new Set(p); n.delete(it.id); return n; });
      return;
    }
    await load();
    setPending((p) => { const n = new Set(p); n.delete(it.id); return n; });
    onCountChange?.();
  };

  const remove = async (it: ChecklistItem) => {
    if (!window.confirm(`刪除子項「${it.title}」？`)) return;
    const { error } = await supabase.from("task_checklist").delete().eq("id", it.id);
    if (error) return toast.error(`刪除失敗：${error.message}`);
    await load();
    onCountChange?.();
  };

  /* ---- 拖曳排序（原生 HTML5 DnD，與個人例行範本頁一致） ---- */

  const onDrop = async (targetId: string) => {
    if (!dragId || dragId === targetId) {
      setDragId(null);
      return;
    }
    const from = items.findIndex((x) => x.id === dragId);
    const to = items.findIndex((x) => x.id === targetId);
    if (from < 0 || to < 0) {
      setDragId(null);
      return;
    }
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setItems(next);
    setDragId(null);

    const { error } = await supabase.rpc("eip_reorder_task_checklist", {
      p_task_id: taskId,
      p_ids: next.map((x) => x.id),
    });
    if (error) {
      toast.error(`排序失敗：${error.message}`);
      await load();
    }
  };

  const done = items.filter((x) => x.is_done).length;

  return (
    <div className="mt-2 border-t pt-3">
      <div className="text-sm font-medium mb-2 flex items-center gap-1.5">
        <ListChecks className="w-3.5 h-3.5" />
        子項清單
        {items.length > 0 && (
          <span className="text-xs text-muted-foreground font-normal">
            {done}/{items.length}
          </span>
        )}
      </div>

      {loading ? (
        <div className="text-xs text-muted-foreground">載入中…</div>
      ) : items.length === 0 ? (
        <div className="text-xs text-muted-foreground">
          尚無子項。子項用來拆解這個任務要做的幾件事；勾選代表「今天有做、納入回報」，不影響任務進度百分比。
        </div>
      ) : (
        <div className="space-y-1">
          {items.map((it) => (
            <div
              key={it.id}
              draggable={!readOnly}
              onDragStart={() => setDragId(it.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => void onDrop(it.id)}
              className={`flex items-center gap-2 rounded-md border px-2 py-1.5 ${
                dragId === it.id ? "opacity-50" : ""
              } ${it.is_done ? "bg-muted/40" : ""}`}
            >
              {!readOnly && (
                <GripVertical className="w-3.5 h-3.5 text-muted-foreground/50 cursor-grab shrink-0" />
              )}
              <Checkbox
                checked={it.is_done}
                disabled={readOnly || pending.has(it.id)}
                onCheckedChange={() => void toggle(it)}
              />
              <span
                className={`text-sm flex-1 ${it.is_done ? "line-through text-muted-foreground" : ""}`}
              >
                {it.title}
              </span>
              {it.is_done && it.done_at && (
                <span className="text-[11px] text-muted-foreground shrink-0">
                  {nameOf?.(it.done_by) ?? ""}{" "}
                  {new Date(it.done_at).toLocaleDateString("zh-TW", {
                    month: "2-digit",
                    day: "2-digit",
                  })}
                </span>
              )}
              {!readOnly && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0 shrink-0"
                  onClick={() => void remove(it)}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {!readOnly && (
        <div className="mt-2 flex gap-2">
          <Input
            placeholder="新增子項…"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void add();
              }
            }}
          />
          <Button size="sm" onClick={() => void add()} disabled={busy || !newTitle.trim()}>
            <Plus className="w-3.5 h-3.5 mr-1" />
            新增
          </Button>
        </div>
      )}
    </div>
  );
}
