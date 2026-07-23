import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { Plus, X, Check, Send, Stamp, ListChecks, Zap, Inbox, Search, RefreshCw, Trash2, Paperclip, Download, UploadCloud, Lock, Unlock, ChevronDown, History, Users } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { useEipUser } from "@/lib/eip-user";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export const Route = createFileRoute("/dashboard/eip/work-log")({ component: WorkLogPage });

type Item = { text: string; done: boolean; note?: string };
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const arr = (v: unknown): Item[] => (Array.isArray(v) ? (v as Item[]) : []);

interface Log { id?: string; log_date: string; routine: Item[]; special: Item[]; status: string; locked: boolean; locked_by?: string | null; locked_at?: string | null; }

// 建立某天的預設內容：當日常態(週期)任務→例行；今天完成的一次性任務→特殊（含任務說明）
async function buildSeed(uid: string, date: string) {
  const nextDate = new Date(new Date(date).getTime() + 864e5).toISOString().slice(0, 10);
  const { data: rec } = await supabase.from("task").select("title,description,progress")
    .eq("owner_id", uid).not("recurring_rule_id", "is", null).eq("occurrence_date", date);
  const { data: done } = await supabase.from("task").select("title,description")
    .eq("owner_id", uid).is("recurring_rule_id", null).gte("completed_at", `${date}T00:00:00+08:00`).lt("completed_at", `${nextDate}T00:00:00+08:00`);
  return {
    routine: (rec ?? []).map((t: any) => ({ text: t.title as string, done: (t.progress ?? 0) >= 100, note: (t.description ?? "") as string })),
    special: (done ?? []).map((t: any) => ({ text: t.title as string, done: true, note: (t.description ?? "") as string })),
  };
}

function WorkLogPage() {
  const { appUser } = useEipUser();
  const isSupervisor = appUser?.role === "dept_manager" || appUser?.role === "company_admin";
  const myReviewRole: "manager" | "unit" = appUser?.role === "dept_manager" ? "unit" : "manager";
  const [date, setDate] = useState(today());
  const [log, setLog] = useState<Log | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [names, setNames] = useState<Record<string, { name: string; job_title?: string | null }>>({});

  useEffect(() => {
    void supabase.from("app_user").select("id,name,job_title").then((r: any) => {
      const m: Record<string, { name: string; job_title?: string | null }> = {};
      (r.data ?? []).forEach((u: any) => (m[u.id] = { name: u.name, job_title: u.job_title }));
      setNames(m);
    });
  }, []);

  const load = async () => {
    if (!appUser?.id) return;
    setLoading(true);
    const { data } = await supabase.from("work_log").select("*").eq("user_id", appUser.id).eq("log_date", date).maybeSingle();
    if (data) {
      const routine = [...arr(data.routine_morning), ...arr(data.routine_afternoon)];
      setLog({ id: data.id, log_date: date, routine, special: arr(data.special_items), status: data.status, locked: !!data.locked, locked_by: data.locked_by, locked_at: data.locked_at });
    } else {
      const seed = await buildSeed(appUser.id, date);
      setLog({ log_date: date, routine: seed.routine, special: seed.special, status: "draft", locked: false });
    }
    setLoading(false);
  };
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [appUser?.id, date, refreshKey]);

  const persist = async (patch: { status?: string; submitted_at?: string }, msg?: string) => {
    if (!appUser?.id || !log) return;
    setSaving(true);
    const body: any = {
      user_id: appUser.id, department_id: appUser.department_id, log_date: date,
      routine_morning: log.routine, routine_afternoon: [], special_items: log.special,
      status: log.status, ...patch, updated_at: new Date().toISOString(),
    };
    let res;
    if (log.id) res = await supabase.from("work_log").update(body).eq("id", log.id).select("*").maybeSingle();
    else res = await supabase.from("work_log").insert(body).select("*").maybeSingle();
    setSaving(false);
    if (res.error) { toast.error(res.error.message); return; }
    if (res.data) setLog((l) => (l ? { ...l, id: res.data.id, status: res.data.status } : l));
    setRefreshKey((k) => k + 1);
    if (msg) toast.success(msg);
  };

  const deleteLog = async (id?: string, d?: string) => {
    const targetId = id ?? log?.id;
    if (!targetId) { toast.info("此日誌尚未儲存，無需刪除"); return; }
    if (!window.confirm("確定刪除這篇日誌？此動作無法復原。")) return;
    setSaving(true);
    const { error } = await supabase.from("work_log").delete().eq("id", targetId);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("已刪除日誌");
    setRefreshKey((k) => k + 1);
    if (d && d !== date) setRefreshKey((k) => k + 1);
  };

  const syncToday = async () => {
    if (!appUser?.id || !log) return;
    const seed = await buildSeed(appUser.id, date);
    const rSet = new Set(log.routine.map((x) => x.text));
    const sSet = new Set(log.special.map((x) => x.text));
    const addR = seed.routine.filter((x) => !rSet.has(x.text));
    const addS = seed.special.filter((x) => !sSet.has(x.text));
    if (!addR.length && !addS.length) { toast.info("沒有可帶入的新任務"); return; }
    setLog((l) => (l ? { ...l, routine: [...l.routine, ...addR], special: [...l.special, ...addS] } : l));
    toast.success(`已帶入 ${addR.length + addS.length} 筆，記得按儲存或送出`);
  };

  if (loading || !log) {
    return <div className="space-y-3"><div className="h-9 w-40 rounded-md bg-muted/50 animate-pulse" /><div className="h-56 rounded-2xl bg-muted/50 animate-pulse" /></div>;
  }
  const editable = !log.locked;         // 未鎖定即可由本人編輯
  const submitted = log.status === "submitted";

  return (
    <div className="space-y-6">
      <PageHeader title="工作日誌" description="當天即可填寫；主管可多人批示（經理、單位主管），最後由主管鎖定；鎖定後凍結、可解鎖再修改。"
        actions={
          <div className="flex items-center gap-2">
            <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} className="h-9 rounded-md border bg-card px-2 text-sm" />
            {date !== today() && <Button variant="outline" size="sm" onClick={() => setDate(today())}>今天</Button>}
            <StatusBadge status={log.status} locked={log.locked} />
          </div>
        } />

      <div className="grid gap-4 md:grid-cols-2">
        <Section title="例行工作" Icon={ListChecks} tone="primary" items={log.routine} editable={editable} onChange={(v) => setLog((l) => (l ? { ...l, routine: v } : l))} />
        <Section title="特殊（突發）工作" Icon={Zap} tone="accent" items={log.special} editable={editable} onChange={(v) => setLog((l) => (l ? { ...l, special: v } : l))} />
      </div>

      {editable ? (
        <div className="flex justify-between gap-2 flex-wrap">
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" onClick={syncToday} disabled={saving}><RefreshCw className="w-4 h-4 mr-1.5" /> 同步今日任務</Button>
            {log.id && <Button variant="outline" onClick={() => deleteLog()} disabled={saving} className="text-destructive hover:text-destructive"><Trash2 className="w-4 h-4 mr-1.5" /> 刪除</Button>}
          </div>
          <div className="flex gap-2">
            {submitted ? (
              <>
                <Button variant="outline" onClick={() => persist({ status: "draft" }, "已撤回為草稿")} disabled={saving}>撤回為草稿</Button>
                <Button onClick={() => persist({}, "已儲存修改")} disabled={saving}><Check className="w-4 h-4 mr-1.5" /> 儲存修改</Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => persist({}, "已儲存草稿")} disabled={saving}>儲存草稿</Button>
                <Button onClick={() => persist({ status: "submitted", submitted_at: new Date().toISOString() }, "已送出")} disabled={saving}><Send className="w-4 h-4 mr-1.5" /> 送出</Button>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-xs text-muted-foreground rounded-lg bg-muted/40 px-3 py-2">
          <Lock className="w-3.5 h-3.5" /> 此日誌已由 {log.locked_by ? (names[log.locked_by]?.name ?? "主管") : "主管"} 於 {log.locked_at ? new Date(log.locked_at).toLocaleString("zh-TW") : ""} 鎖定，已凍結編輯。
        </div>
      )}

      {/* 批示紀錄（本人檢視） */}
      {log.id && (
        <ReviewsCollapsible workLogId={log.id} meId={appUser!.id} names={names} locked={log.locked} defaultRole={myReviewRole} />
      )}

      {/* 附加檔案 */}
      {log.id ? (
        <Collapsible title="附加檔案" Icon={Paperclip} defaultOpen={false}>
          <Attachments workLogId={log.id} canEdit={editable} />
        </Collapsible>
      ) : (
        <p className="text-xs text-muted-foreground pl-1">附加檔案：請先按「儲存草稿」後即可上傳 PDF／Word／Excel／圖片。</p>
      )}

      <Collapsible title="我的日誌記錄" Icon={History} defaultOpen={false}>
        <MyHistory meId={appUser!.id} activeDate={date} onPick={(d) => setDate(d)} onDelete={(id, d) => deleteLog(id, d)} refreshKey={refreshKey} />
      </Collapsible>

      {isSupervisor && (
        <Collapsible title="部門日誌批示" Icon={Users} defaultOpen={false} tone="primary">
          <SupervisorReview meId={appUser!.id} names={names} myReviewRole={myReviewRole} />
        </Collapsible>
      )}
    </div>
  );
}

// 可收合區塊
function Collapsible({ title, Icon, children, defaultOpen = false, tone, badge }: {
  title: string; Icon?: typeof Zap; children: ReactNode; defaultOpen?: boolean; tone?: "primary" | "accent"; badge?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const iconCls = tone === "primary" ? "text-primary" : tone === "accent" ? "text-accent" : "text-muted-foreground";
  return (
    <div className="rounded-2xl border bg-card shadow-sm overflow-hidden">
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 hover:bg-muted/40 transition-colors text-left">
        {Icon && <Icon className={`w-4 h-4 shrink-0 ${iconCls}`} />}
        <span className="text-sm font-semibold flex-1">{title}</span>
        {badge}
        <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="px-4 pb-4 pt-1 border-t">{children}</div>}
    </div>
  );
}

// Reviews 包裝：計算是否有資料再決定是否顯示，並展示批示數量徽章
function ReviewsCollapsible({ workLogId, meId, names, locked, defaultRole }: {
  workLogId: string; meId: string; names: Record<string, { name: string; job_title?: string | null }>; locked: boolean; defaultRole: "manager" | "unit";
}) {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    (async () => {
      const { count: c } = await supabase.from("work_log_review").select("id", { count: "exact", head: true }).eq("work_log_id", workLogId);
      setCount(c ?? 0);
    })();
  }, [workLogId]);
  return (
    <Collapsible
      title="主管批示"
      Icon={Stamp}
      tone="primary"
      defaultOpen={(count ?? 0) > 0}
      badge={count != null && count > 0 ? (
        <span className="text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">{count}</span>
      ) : (
        <span className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">尚未批示</span>
      )}
    >
      <Reviews workLogId={workLogId} meId={meId} names={names} canReview={false} locked={locked} defaultRole={defaultRole} />
    </Collapsible>
  );
}

function Section({ title, Icon, tone, items, editable, onChange }: {
  title: string; Icon: typeof Zap; tone: "primary" | "accent"; items: Item[]; editable: boolean; onChange: (v: Item[]) => void;
}) {
  const [text, setText] = useState("");
  const add = () => { const t = text.trim(); if (!t) return; onChange([...items, { text: t, done: false, note: "" }]); setText(""); };
  const setItem = (i: number, patch: Partial<Item>) => onChange(items.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const toneCls = tone === "accent" ? "bg-accent/15 text-accent" : "bg-primary/10 text-primary";
  return (
    <div className="rounded-2xl border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${toneCls}`}><Icon className="w-4 h-4" /></span>
        <span className="text-sm font-semibold">{title}</span>
        <span className="ml-auto text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">{items.length}</span>
      </div>
      {items.length === 0 && <div className="text-xs text-muted-foreground mb-2 pl-1">尚無項目</div>}
      <ul className="space-y-1.5 mb-2">
        {items.map((it, i) => (
          <li key={i} className="group rounded-lg hover:bg-muted/40 px-1.5 py-1">
            <div className="flex items-center gap-2 text-sm">
              <button type="button" disabled={!editable}
                onClick={() => setItem(i, { done: !it.done })}
                className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${it.done ? "bg-primary border-primary text-primary-foreground" : "bg-card"}`}>
                {it.done && <Check className="w-3 h-3" />}
              </button>
              {editable ? (
                <input value={it.text}
                  onChange={(e) => setItem(i, { text: e.target.value })}
                  className={`flex-1 bg-transparent outline-none border-b border-transparent focus:border-border ${it.done ? "line-through text-muted-foreground" : ""}`} />
              ) : (
                <span className={`flex-1 ${it.done ? "line-through text-muted-foreground" : ""}`}>{it.text}</span>
              )}
              {editable && (
                <button type="button" onClick={() => onChange(items.filter((_, j) => j !== i))} className="text-muted-foreground/50 hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity shrink-0"><X className="w-3.5 h-3.5" /></button>
              )}
            </div>
            {editable ? (
              <textarea value={it.note ?? ""} rows={1} placeholder="說明（選填）…"
                onChange={(e) => setItem(i, { note: e.target.value })}
                className="mt-1 ml-6 block w-[calc(100%-1.75rem)] resize-y rounded-md bg-transparent px-1 py-0.5 text-xs text-muted-foreground outline-none border border-transparent hover:border-border/60 focus:border-border" />
            ) : (
              it.note ? <p className="mt-0.5 ml-6 text-xs text-muted-foreground whitespace-pre-wrap">{it.note}</p> : null
            )}
          </li>
        ))}
      </ul>
      {editable && (
        <div className="flex gap-2">
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="新增項目…"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} className="h-8 text-sm" />
          <Button variant="outline" size="sm" onClick={add} className="h-8"><Plus className="w-4 h-4" /></Button>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status, locked }: { status: string; locked?: boolean }) {
  const map: Record<string, { t: string; c: string }> = {
    draft: { t: "草稿", c: "bg-muted text-muted-foreground" },
    submitted: { t: "已送出", c: "bg-accent/15 text-accent" },
    reviewed: { t: "已批示", c: "bg-primary/15 text-primary" },
  };
  const s = map[status] ?? map.draft;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${s.c}`}>{s.t}</span>
      {locked && <span className="text-xs px-2 py-1 rounded-full font-medium bg-destructive/10 text-destructive inline-flex items-center gap-1"><Lock className="w-3 h-3" /> 已鎖定</span>}
    </span>
  );
}

const txtOf = (r: any) => [...arr(r.routine_morning), ...arr(r.routine_afternoon), ...arr(r.special_items)].map((x) => `${x.text} ${x.note ?? ""}`).join(" ");
const cntOf = (r: any) => arr(r.routine_morning).length + arr(r.routine_afternoon).length + arr(r.special_items).length;

// 我的日誌記錄：預設本月，可切月份、篩狀態、搜尋
function MyHistory({ meId, activeDate, onPick, onDelete, refreshKey }: { meId: string; activeDate: string; onPick: (d: string) => void; onDelete: (id: string, d: string) => void; refreshKey: number }) {
  const [month, setMonth] = useState(today().slice(0, 7));
  const [q, setQ] = useState("");
  const [st, setSt] = useState("all");
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    (async () => {
      const [y, m] = month.split("-").map(Number);
      const start = `${month}-01`;
      const end = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
      const { data } = await supabase.from("work_log")
        .select("id,log_date,status,locked,routine_morning,routine_afternoon,special_items")
        .eq("user_id", meId).gte("log_date", start).lt("log_date", end).order("log_date", { ascending: false });
      setRows(data ?? []);
    })();
  }, [meId, month, refreshKey]);
  const filtered = rows.filter((r) => (st === "all" || r.status === st) && (!q || txtOf(r).toLowerCase().includes(q.toLowerCase())));
  const hasFilter = st !== "all" || !!q;
  const stLabel = st === "draft" ? "草稿" : st === "submitted" ? "已送出" : "";
  return (
    <div className="space-y-2 pt-2">
      <div className="flex items-center gap-2 flex-wrap">
        <input type="month" value={month} max={today().slice(0, 7)} onChange={(e) => setMonth(e.target.value)} className="h-8 rounded-md border bg-card px-2 text-xs" />
        <select value={st} onChange={(e) => setSt(e.target.value)} className="h-8 rounded-md border bg-card px-2 text-xs">
          <option value="all">全部狀態</option><option value="draft">草稿</option><option value="submitted">已送出</option>
        </select>
        <div className="relative flex-1 min-w-[140px]">
          <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋內容…" className="h-8 w-full rounded-md border bg-card pl-7 pr-2 text-xs" />
        </div>
        {hasFilter && (
          <button onClick={() => { setSt("all"); setQ(""); }} className="text-xs text-primary hover:underline">清除篩選</button>
        )}
      </div>
      {filtered.length === 0 ? (
        <p className="text-xs text-muted-foreground px-1">
          {rows.length === 0
            ? "此月份沒有任何日誌。"
            : hasFilter
              ? <>此月份共 {rows.length} 筆日誌，但沒有符合目前篩選條件（{stLabel && `狀態：${stLabel}`}{stLabel && q ? "、" : ""}{q && `關鍵字：「${q}」`}）的資料。</>
              : "此月份沒有符合的日誌。"}
        </p>
      ) : (
        <div className="rounded-2xl border overflow-hidden bg-card">
          {filtered.map((r) => (
            <div key={r.id} className={`group flex items-center gap-3 px-4 py-2.5 border-b last:border-b-0 text-sm hover:bg-accent/40 transition-colors ${r.log_date === activeDate ? "bg-primary/5" : ""}`}>
              <button onClick={() => onPick(r.log_date)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
                <span className="font-medium tabular-nums shrink-0">{r.log_date}</span>
                <span className="text-xs text-muted-foreground flex-1 text-left truncate">{cntOf(r)} 個項目</span>
              </button>
              <StatusBadge status={r.status} locked={r.locked} />
              {!r.locked && (
                <button onClick={() => onDelete(r.id, r.log_date)} title="刪除此日誌"
                  className="text-muted-foreground/40 hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity shrink-0"><Trash2 className="w-4 h-4" /></button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// 批示紀錄（經理 / 單位主管 兩類；可多人批示，順序不限）
function Reviews({ workLogId, meId, names, canReview, locked, defaultRole, refreshSignal }: {
  workLogId: string; meId: string; names: Record<string, { name: string; job_title?: string | null }>; canReview: boolean; locked: boolean; defaultRole: "manager" | "unit"; refreshSignal?: number;
}) {
  const [reviews, setReviews] = useState<any[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const load = async () => {
    const { data } = await supabase.from("work_log_review").select("*").eq("work_log_id", workLogId).order("created_at");
    setReviews(data ?? []);
  };
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [workLogId, refreshSignal]);

  const add = async () => {
    setBusy(true);
    const { error } = await supabase.from("work_log_review").insert({ work_log_id: workLogId, reviewer_role: defaultRole, comment: text.trim() });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setText(""); toast.success("已批示"); void load();
  };
  const del = async (id: string) => {
    if (!window.confirm("刪除這則批示？")) return;
    const { error } = await supabase.from("work_log_review").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    void load();
  };

  // 位階由小到大：單位主管 → 經理
  const ROLE_RANK: Record<string, number> = { unit: 1, manager: 2 };
  const ROLE_LABEL: Record<string, string> = { unit: "單位主管", manager: "經理" };
  const sortedReviews = [...reviews].sort((a, b) => {
    const ra = ROLE_RANK[a.reviewer_role] ?? 99;
    const rb = ROLE_RANK[b.reviewer_role] ?? 99;
    if (ra !== rb) return ra - rb;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });

  const hasAny = reviews.length > 0;
  if (!canReview && !hasAny) return null;

  return (
    <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 space-y-3">
      <div className="text-xs font-semibold text-primary flex items-center gap-1.5"><Stamp className="w-3.5 h-3.5" /> 主管批示</div>
      {hasAny ? (
        <div className="space-y-2">
          {sortedReviews.map((rv) => {
            const u = names[rv.reviewer_id];
            return (
              <div key={rv.id} className="text-sm rounded-lg bg-muted/40 px-2.5 py-1.5">
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground mb-0.5 flex-wrap">
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">
                    {ROLE_LABEL[rv.reviewer_role] ?? "主管"}
                  </span>
                  <span className="font-medium text-foreground">{u?.name ?? "主管"}</span>
                  {u?.job_title && <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{u.job_title}</span>}
                  <span>{new Date(rv.created_at).toLocaleString("zh-TW")}</span>
                  {canReview && !locked && rv.reviewer_id === meId && (
                    <button onClick={() => del(rv.id)} className="ml-auto hover:text-destructive">刪除</button>
                  )}
                </div>
                {rv.comment ? <div className="whitespace-pre-wrap">{rv.comment}</div> : <div className="text-xs text-muted-foreground italic">（已確認，無附註）</div>}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground pl-1">尚未批示</p>
      )}

      {canReview && !locked && (
        <div className="border-t pt-3 space-y-2">
          <Textarea rows={2} placeholder="輸入批示內容（可留空）…" value={text} onChange={(e) => setText(e.target.value)} />
          <div className="flex justify-end">
            <Button size="sm" onClick={add} disabled={busy}><Stamp className="w-4 h-4 mr-1.5" /> {busy ? "送出中…" : "送出批示"}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

// 部門日誌批示：預設待批示，可切換顯示已鎖定、可搜尋
function SupervisorReview({ meId, names, myReviewRole }: { meId: string; names: Record<string, { name: string; job_title?: string | null }>; myReviewRole: "manager" | "unit" }) {
  const [rows, setRows] = useState<any[]>([]);
  const [showLocked, setShowLocked] = useState(false);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const load = async () => {
    const { data } = await supabase.from("work_log").select("*").neq("user_id", meId).eq("status", "submitted").order("log_date", { ascending: false }).limit(100);
    setRows(data ?? []);
  };
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [meId]);

  const toggleLock = async (r: any, lock: boolean) => {
    setBusy(r.id);
    const { error } = await supabase.from("work_log").update({
      locked: lock, locked_by: lock ? meId : null, locked_at: lock ? new Date().toISOString() : null, updated_at: new Date().toISOString(),
    }).eq("id", r.id);
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success(lock ? "已鎖定" : "已解鎖"); void load();
  };

  const fmtItems = (v: any) => (Array.isArray(v) ? v : []);
  const nameOf = (r: any) => names[r.user_id]?.name ?? "同仁";
  const filtered = rows
    .filter((r) => showLocked || !r.locked)
    .filter((r) => !q || (nameOf(r) + txtOf(r)).toLowerCase().includes(q.toLowerCase()));
  const ItemLine = ({ it }: { it: any }) => (
    <div className="pl-1">
      <div>{it.done ? "✓ " : "· "}{it.text}</div>
      {it.note ? <div className="pl-4 text-muted-foreground/80 whitespace-pre-wrap">{it.note}</div> : null}
    </div>
  );

  return (
    <div className="space-y-3 pt-2">
      <div className="flex items-center gap-2 flex-wrap">
        
        <label className="text-xs text-muted-foreground flex items-center gap-1"><input type="checkbox" checked={showLocked} onChange={(e) => setShowLocked(e.target.checked)} /> 顯示已鎖定</label>
        <div className="relative flex-1 min-w-[140px]">
          <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋姓名/內容…" className="h-8 w-full rounded-md border bg-card pl-7 pr-2 text-xs" />
        </div>
      </div>
      {filtered.length === 0 ? (
        <div className="border border-dashed rounded-2xl py-10 text-center bg-card/40">
          <div className="w-11 h-11 mx-auto rounded-2xl bg-muted flex items-center justify-center"><Inbox className="w-5 h-5 text-muted-foreground/60" /></div>
          <p className="text-xs text-muted-foreground mt-2">{showLocked ? "沒有符合的部門日誌。" : "目前沒有待批示的部門日誌。"}</p>
        </div>
      ) : filtered.map((r) => (
        <div key={r.id} className="rounded-2xl border bg-card p-4 space-y-3 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-medium">{nameOf(r)} · {r.log_date}</div>
            <div className="flex items-center gap-2">
              <StatusBadge status={r.status} locked={r.locked} />
              {r.locked ? (
                <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => toggleLock(r, false)}><Unlock className="w-4 h-4 mr-1" /> 解鎖</Button>
              ) : (
                <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => toggleLock(r, true)}><Lock className="w-4 h-4 mr-1" /> 鎖定</Button>
              )}
            </div>
          </div>
          <div className="text-xs space-y-1">
            <div><span className="text-foreground font-medium">例行</span>
              <div className="mt-0.5 space-y-0.5">{[...fmtItems(r.routine_morning), ...fmtItems(r.routine_afternoon)].map((it: any, i: number) => <ItemLine key={i} it={it} />)}{[...fmtItems(r.routine_morning), ...fmtItems(r.routine_afternoon)].length === 0 && <span className="text-muted-foreground pl-1">—</span>}</div>
            </div>
            <div><span className="text-foreground font-medium">特殊</span>
              <div className="mt-0.5 space-y-0.5">{fmtItems(r.special_items).map((it: any, i: number) => <ItemLine key={i} it={it} />)}{fmtItems(r.special_items).length === 0 && <span className="text-muted-foreground pl-1">—</span>}</div>
            </div>
          </div>
          <Attachments workLogId={r.id} canEdit={false} />
          <Reviews workLogId={r.id} meId={meId} names={names} canReview={true} locked={r.locked} defaultRole={myReviewRole} />
        </div>
      ))}
    </div>
  );
}

// 工作日誌附加檔案（PDF／Word／Excel／圖片；本人可上傳/刪除、部門主管可檢視下載）
function Attachments({ workLogId, canEdit }: { workLogId: string; canEdit: boolean }) {
  const [files, setFiles] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    const { data } = await supabase.from("work_log_attachment").select("*").eq("work_log_id", workLogId).order("created_at");
    setFiles(data ?? []);
  };
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [workLogId]);

  const onPick = async (e: any) => {
    const list: FileList | null = e.target.files;
    if (!list || !list.length) return;
    setBusy(true);
    let ok = 0;
    for (const f of Array.from(list)) {
      if (f.size > 10 * 1024 * 1024) { toast.error(`${f.name} 超過 10MB`); continue; }
      const path = `${workLogId}/${crypto.randomUUID()}`;
      const up = await supabase.storage.from("worklog").upload(path, f, { contentType: f.type || undefined, upsert: false });
      if (up.error) { toast.error(`${f.name} 上傳失敗：${up.error.message}`); continue; }
      const ins = await supabase.from("work_log_attachment").insert({
        work_log_id: workLogId, file_name: f.name, storage_path: path, mime_type: f.type || null, file_size: f.size,
      });
      if (ins.error) { toast.error(ins.error.message); await supabase.storage.from("worklog").remove([path]); continue; }
      ok += 1;
    }
    setBusy(false); e.target.value = "";
    if (ok) toast.success(`已上傳 ${ok} 個檔案`);
    void load();
  };

  const download = async (a: any) => {
    const { data, error } = await supabase.storage.from("worklog").createSignedUrl(a.storage_path, 60);
    if (error) { toast.error(error.message); return; }
    window.open(data.signedUrl, "_blank");
  };
  const remove = async (a: any) => {
    if (!window.confirm(`刪除附件「${a.file_name}」？`)) return;
    await supabase.storage.from("worklog").remove([a.storage_path]);
    const { error } = await supabase.from("work_log_attachment").delete().eq("id", a.id);
    if (error) { toast.error(error.message); return; }
    void load();
  };
  const fmtSize = (n?: number) => !n ? "" : n < 1024 ? `${n}B` : n < 1048576 ? `${(n / 1024).toFixed(0)}KB` : `${(n / 1048576).toFixed(1)}MB`;

  return (
    <div className="rounded-2xl border bg-card p-4 shadow-sm space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <Paperclip className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-semibold">附加檔案</span>
        <span className="text-xs text-muted-foreground">（PDF／Word／Excel／圖片，單檔 ≤10MB）</span>
        {canEdit && (
          <label className="ml-auto">
            <input type="file" multiple className="hidden" disabled={busy}
              accept=".pdf,.doc,.docx,.xls,.xlsx,image/*" onChange={onPick} />
            <span className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border cursor-pointer hover:bg-accent/50 ${busy ? "opacity-50 pointer-events-none" : ""}`}>
              <UploadCloud className="w-4 h-4" /> {busy ? "上傳中…" : "上傳檔案"}
            </span>
          </label>
        )}
      </div>
      {files.length === 0 ? (
        <p className="text-xs text-muted-foreground pl-1">尚無附件</p>
      ) : (
        <ul className="space-y-1">
          {files.map((a) => (
            <li key={a.id} className="group flex items-center gap-2 text-sm rounded-lg hover:bg-muted/40 px-2 py-1">
              <button type="button" onClick={() => download(a)} className="flex items-center gap-2 flex-1 min-w-0 text-left text-primary hover:underline">
                <Download className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{a.file_name}</span>
              </button>
              <span className="text-[11px] text-muted-foreground shrink-0">{fmtSize(a.file_size)}</span>
              {canEdit && (
                <button type="button" onClick={() => remove(a)} className="text-muted-foreground/50 hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
