import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ListChecks, Clock, ExternalLink, X, Link2, FolderOpen } from "lucide-react";
import { toast } from "sonner";

import {
  fetchRoutineToday,
  setRoutineItem,
  removeRoutineItem,
  taipeiToday,
  ROUTINE_SOURCE_LABEL,
  ROUTINE_LINK_SHAPE,
  type RoutineRow,
} from "@/lib/eip-routine";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";

const keyOf = (r: RoutineRow) => `${r.section}:${r.source ?? ""}:${r.ref_id ?? r.text}`;

/**
 * 「我的工作區」的今日例行區塊。
 *
 * 為什麼要有這一塊（規劃圖第 ① 類）：
 *  個人例行範本是「範本」不是任務，沒有 owner／status／due_date，
 *  每天由 eip_worklog_seed 展開成工作日誌的項目。原本只有進工作日誌，
 *  所以「我的工作區」號稱單一入口卻看不到今天要做的例行 —— 這一塊補的就是它。
 *
 * 勾選與執行內容都在這裡完成，不必再跳工作日誌。
 * 兩者都走 eip_set_routine_item（0138）—— 全系統唯一的寫入實作，
 * 只改命中那一項的欄位，不整批覆寫。
 */
export function TodayRoutineCard() {
  const date = taipeiToday();
  const [rows, setRows] = useState<RoutineRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [savingNote, setSavingNote] = useState<Set<string>>(new Set());

  const q = useQuery({
    queryKey: ["eip", "routine-today", date],
    queryFn: () => fetchRoutineToday(date),
  });

  // server 資料一到就同步到本地副本（本地副本負責輸入中的即時回饋）
  useEffect(() => {
    if (q.data) setRows(q.data);
  }, [q.data]);

  const list = rows ?? [];

  const { morning, afternoon, done, total, missing } = useMemo(
    () => ({
      morning: list.filter((r) => r.section === "morning"),
      afternoon: list.filter((r) => r.section === "afternoon"),
      done: list.filter((r) => r.done).length,
      total: list.length,
      missing: list.filter((r) => r.require_content && r.done && !(r.note ?? "").trim()).length,
    }),
    [list],
  );

  const patchLocal = (k: string, patch: Partial<RoutineRow>) =>
    setRows((prev) => (prev ?? []).map((x) => (keyOf(x) === k ? { ...x, ...patch } : x)));

  const reload = async () => {
    try {
      setRows(await fetchRoutineToday(date));
    } catch {
      void q.refetch();
    }
  };

  const toggle = async (r: RoutineRow) => {
    const k = keyOf(r);
    if (busy) return;
    setBusy(k);
    const next = !r.done;
    patchLocal(k, { done: next });
    try {
      await setRoutineItem({
        date,
        section: r.section,
        done: next,
        source: r.source,
        refId: r.ref_id,
        text: r.text,
      });
    } catch (e) {
      patchLocal(k, { done: r.done });
      toast.error(`更新失敗：${e instanceof Error ? e.message : String(e)}`);
      await reload();
    } finally {
      setBusy(null);
    }
  };

  /**
   * 從今天的日誌移除這一項。
   * 只影響今天這一筆，不會動到個人例行範本 —— 對話框裡要講清楚，
   * 否則使用者會以為自己把範本刪掉了。
   */
  const remove = async (r: RoutineRow) => {
    const k = keyOf(r);
    if (busy) return;
    const isTemplate = r.source === "personal_routine" || r.source === "recurring";
    const msg = isTemplate
      ? `把「${r.text}」從今天的日誌移除？\n\n只影響今天這一筆，範本不會被刪除，明天還是會帶進來。要永久移除請到「個人例行」頁停用或刪除範本。`
      : `把「${r.text}」從今天的日誌移除？`;
    if (!window.confirm(msg)) return;
    setBusy(k);
    setRows((prev) => (prev ?? []).filter((x) => keyOf(x) !== k));
    try {
      await removeRoutineItem({
        date,
        section: r.section,
        source: r.source,
        refId: r.ref_id,
        text: r.text,
      });
    } catch (e) {
      toast.error(`移除失敗：${e instanceof Error ? e.message : String(e)}`);
      await reload();
    } finally {
      setBusy(null);
    }
  };

  /** 執行內容：輸入時只更新本地，失焦或停止輸入 1 秒後才寫 DB */
  const saveNote = async (r: RoutineRow, note: string) => {
    const k = keyOf(r);
    if ((r.note ?? "") === note) return;
    setSavingNote((s) => new Set(s).add(k));
    try {
      await setRoutineItem({
        date,
        section: r.section,
        note,
        source: r.source,
        refId: r.ref_id,
        text: r.text,
      });
      patchLocal(k, { note });
    } catch (e) {
      toast.error(`執行內容儲存失敗：${e instanceof Error ? e.message : String(e)}`);
      await reload();
    } finally {
      setSavingNote((s) => {
        const n = new Set(s);
        n.delete(k);
        return n;
      });
    }
  };

  /**
   * 相關檔案連結（訪談定案第 5 條：NAS 或其他檔案可掛連結）。
   * 與勾選、執行內容共用同一支 eip_set_routine_item，不另開寫入路徑。
   */
  const saveLink = async (r: RoutineRow, raw: string) => {
    const k = keyOf(r);
    const link = raw.trim();
    if ((r.link ?? "") === link) return;
    if (link && !ROUTINE_LINK_SHAPE.test(link)) {
      toast.error("連結格式不對：請用 http(s)://、file:// 或 \\伺服器\分享資料夾");
      return;
    }
    setSavingNote((s2) => new Set(s2).add(k));
    try {
      await setRoutineItem({
        date,
        section: r.section,
        link,
        source: r.source,
        refId: r.ref_id,
        text: r.text,
      });
      patchLocal(k, { link: link || null });
    } catch (e) {
      toast.error(`連結儲存失敗：${e instanceof Error ? e.message : String(e)}`);
      await reload();
    } finally {
      setSavingNote((s2) => {
        const n = new Set(s2);
        n.delete(k);
        return n;
      });
    }
  };

  if (q.isLoading && !rows) {
    return (
      <Card className="mb-3">
        <CardContent className="p-3 text-xs text-muted-foreground">今日例行載入中…</CardContent>
      </Card>
    );
  }

  if (q.isError && !rows) {
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
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <ListChecks className="w-4 h-4 text-primary shrink-0" />
          <span className="text-sm font-semibold">今天的例行</span>
          {total > 0 && (
            <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">
              {done}/{total}
            </span>
          )}
          {missing > 0 && (
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-destructive/10 text-destructive">
              {missing} 項還沒填執行內容
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
            <RoutineGroup
              label="上午 / 全天"
              Icon={ListChecks}
              rows={morning}
              busy={busy}
              savingNote={savingNote}
              onToggle={toggle}
              onSaveNote={saveNote}
              onSaveLink={saveLink}
              onRemove={remove}
            />
            <RoutineGroup
              label="下午"
              Icon={Clock}
              rows={afternoon}
              busy={busy}
              savingNote={savingNote}
              onToggle={toggle}
              onSaveNote={saveNote}
              onSaveLink={saveLink}
              onRemove={remove}
            />
            <p className="text-[11px] text-muted-foreground pt-0.5">
              勾選與執行內容都會直接存進今天的日誌，不需要再按儲存。
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
  savingNote,
  onToggle,
  onSaveNote,
  onSaveLink,
  onRemove,
}: {
  label: string;
  Icon: typeof ListChecks;
  rows: RoutineRow[];
  busy: string | null;
  savingNote: Set<string>;
  onToggle: (r: RoutineRow) => void;
  onSaveNote: (r: RoutineRow, note: string) => void;
  onSaveLink: (r: RoutineRow, link: string) => void;
  onRemove: (r: RoutineRow) => void;
}) {
  if (!rows.length) return null;
  return (
    <div>
      <div className="text-[11px] text-muted-foreground flex items-center gap-1 mb-1">
        <Icon className="w-3 h-3" />
        {label}
      </div>
      <div className="space-y-1">
        {rows.map((r) => (
          <RoutineRowItem
            key={keyOf(r)}
            row={r}
            busy={busy === keyOf(r)}
            saving={savingNote.has(keyOf(r))}
            onToggle={() => onToggle(r)}
            onSaveNote={(note) => onSaveNote(r, note)}
            onSaveLink={(link) => onSaveLink(r, link)}
            onRemove={() => onRemove(r)}
          />
        ))}
      </div>
    </div>
  );
}

function RoutineRowItem({
  row,
  busy,
  saving,
  onToggle,
  onSaveNote,
  onSaveLink,
  onRemove,
}: {
  row: RoutineRow;
  busy: boolean;
  saving: boolean;
  onToggle: () => void;
  onSaveNote: (note: string) => void;
  onSaveLink: (link: string) => void;
  onRemove: () => void;
}) {
  const [text, setText] = useState(row.note ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(text);

  // server 值變了（別處改過、或重新載入）就跟上，但不要打斷正在輸入的內容
  useEffect(() => {
    const v = row.note ?? "";
    if (v !== latest.current && !timer.current) {
      setText(v);
      latest.current = v;
    }
  }, [row.note]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const onChange = (v: string) => {
    setText(v);
    latest.current = v;
    if (timer.current) clearTimeout(timer.current);
    // 停止輸入 1 秒後自動存；不要每個字都打一次 API
    timer.current = setTimeout(() => {
      timer.current = null;
      onSaveNote(v);
    }, 1000);
  };

  const flush = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
      onSaveNote(latest.current);
    }
  };

  const needContent = row.require_content && row.done && !text.trim();
  const [linkOpen, setLinkOpen] = useState(!!row.link);
  const [linkText, setLinkText] = useState(row.link ?? "");
  const isUnc = (u: string) => u.startsWith("\\\\");

  return (
    <div
      className={`rounded-md border px-2 py-1.5 ${needContent ? "border-destructive/50 bg-destructive/5" : ""}`}
    >
      <div className="flex items-center gap-2">
        <Checkbox checked={row.done} disabled={busy} onCheckedChange={onToggle} />
        <span
          className={`text-sm flex-1 min-w-0 truncate ${row.done ? "line-through text-muted-foreground" : ""}`}
        >
          {row.text}
        </span>
        {row.source && ROUTINE_SOURCE_LABEL[row.source] && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
            {ROUTINE_SOURCE_LABEL[row.source]}
          </span>
        )}
        {row.require_content && (
          <span
            className={`text-[10px] shrink-0 ${needContent ? "text-destructive font-medium" : "text-amber-600"}`}
            title="需填執行內容（送出日誌前必填）"
          >
            需填
          </span>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={onRemove}
          title="從今天的日誌移除（不會刪掉範本）"
          className="p-0.5 rounded text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 shrink-0 disabled:opacity-40"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 執行內容直接在這裡填，不用跳工作日誌 */}
      <div className="mt-1 ml-6 flex items-start gap-2">
        <textarea
          rows={1}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          onBlur={flush}
          placeholder={row.require_content ? "執行內容（送出日誌前必填）…" : "說明（選填）…"}
          className={`flex-1 resize-y rounded-md bg-transparent px-1.5 py-1 text-xs outline-none border ${
            needContent ? "border-destructive/40" : "border-transparent hover:border-border/60"
          } focus:border-border`}
        />
        <span className="text-[10px] text-muted-foreground shrink-0 pt-1.5 w-8 text-right">
          {saving ? "存…" : ""}
        </span>
      </div>

      {/* 相關檔案連結：預設收起來，有連結或按了才展開，避免每一列都多一個輸入框 */}
      <div className="ml-6 mt-1">
        {!linkOpen ? (
          <button
            type="button"
            onClick={() => setLinkOpen(true)}
            className="text-[11px] text-muted-foreground hover:text-primary inline-flex items-center gap-1"
          >
            <Link2 className="w-3 h-3" />
            加連結
          </button>
        ) : (
          <div className="flex items-center gap-1.5">
            {row.link && isUnc(row.link) ? (
              <span title="NAS 路徑，複製後貼到檔案總管" className="shrink-0">
                <FolderOpen className="w-3 h-3 text-muted-foreground" />
              </span>
            ) : (
              <Link2 className="w-3 h-3 text-muted-foreground shrink-0" />
            )}
            <input
              value={linkText}
              onChange={(e) => setLinkText(e.target.value)}
              onBlur={() => onSaveLink(linkText)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onSaveLink(linkText);
                }
              }}
              placeholder="\\\\NAS\\品保\\2026\\ 或 https://…"
              className="flex-1 min-w-0 rounded-md bg-transparent px-1.5 py-0.5 text-[11px] font-mono outline-none border border-transparent hover:border-border/60 focus:border-border"
            />
            {row.link && !isUnc(row.link) && (
              <a
                href={row.link}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-primary hover:underline shrink-0"
              >
                開啟
              </a>
            )}
            {row.link && isUnc(row.link) && (
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(row.link!)
                    .then(() => toast.success("已複製路徑，貼到檔案總管即可開啟"))
                    .catch(() => toast.info(row.link!));
                }}
                className="text-[11px] text-primary hover:underline shrink-0"
              >
                複製
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
