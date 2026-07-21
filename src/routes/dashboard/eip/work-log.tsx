import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus, X, Check, Send, Stamp, ListChecks, Zap, Inbox, Search, RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useEipUser } from "@/lib/eip-user";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export const Route = createFileRoute("/dashboard/eip/work-log")({ component: WorkLogPage });

type Item = { text: string; done: boolean };
const today = () => new Date().toISOString().slice(0, 10);
const arr = (v: unknown): Item[] => (Array.isArray(v) ? (v as Item[]) : []);

interface Log { id?: string; log_date: string; routine: Item[]; special: Item[]; status: string; manager_comment?: string | null; }

// 建立某天的預設內容：當日常態(週期)任務→例行；今天完成的一次性任務→特殊
async function buildSeed(uid: string, date: string) {
  const nextDate = new Date(new Date(date).getTime() + 864e5).toISOString().slice(0, 10);
  const { data: rec } = await supabase.from("task").select("title,progress")
    .eq("owner_id", uid).not("recurring_rule_id", "is", null).eq("occurrence_date", date);
  const { data: done } = await supabase.from("task").select("title")
    .eq("owner_id", uid).is("recurring_rule_id", null).gte("completed_at", date).lt("completed_at", nextDate);
  return {
    routine: (rec ?? []).map((t: any) => ({ text: t.title as string, done: (t.progress ?? 0) >= 100 })),
    special: (done ?? []).map((t: any) => ({ text: t.title as string, done: true })),
  };
}

function WorkLogPage() {
  const { appUser } = useEipUser();
  const isSupervisor = appUser?.role === "dept_manager" || appUser?.role === "company_admin";
  const [date, setDate] = useState(today());
  const [log, setLog] = useState<Log | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = async () => {
    if (!appUser?.id) return;
    setLoading(true);
    const { data } = await supabase.from("work_log").select("*").eq("user_id", appUser.id).eq("log_date", date).maybeSingle();
    if (data) {
      const routine = [...arr(data.routine_morning), ...arr(data.routine_afternoon)];
      setLog({ id: data.id, log_date: date, routine, special: arr(data.special_items), status: data.status, manager_comment: data.manager_comment });
    } else {
      // 只有草稿(新建)才自動帶入當日任務
      const seed = await buildSeed(appUser.id, date);
      setLog({ log_date: date, routine: seed.routine, special: seed.special, status: "draft" });
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
  const editable = log.status !== "reviewed";

  return (
    <div className="space-y-6">
      <PageHeader title="工作日誌" description="當天即可填寫，送出後由單位主管批示；主管批示後鎖定。"
        actions={
          <div className="flex items-center gap-2">
            <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} className="h-9 rounded-md border bg-card px-2 text-sm" />
            {date !== today() && <Button variant="outline" size="sm" onClick={() => setDate(today())}>今天</Button>}
            <StatusBadge status={log.status} />
          </div>
        } />

      <div className="grid gap-4 md:grid-cols-2">
        <Section title="例行工作" Icon={ListChecks} tone="primary" items={log.routine} editable={editable} onChange={(v) => setLog((l) => (l ? { ...l, routine: v } : l))} />
        <Section title="特殊（突發）工作" Icon={Zap} tone="accent" items={log.special} editable={editable} onChange={(v) => setLog((l) => (l ? { ...l, special: v } : l))} />
      </div>

      {editable ? (
        <div className="flex justify-between gap-2 flex-wrap">
          <Button variant="outline" onClick={syncToday} disabled={saving}><RefreshCw className="w-4 h-4 mr-1.5" /> 同步今日任務</Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => persist({}, "已儲存草稿")} disabled={saving}>儲存草稿</Button>
            <Button onClick={() => persist({ status: "submitted", submitted_at: new Date().toISOString() }, "已送出")} disabled={saving}><Send className="w-4 h-4 mr-1.5" /> 送出</Button>
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground text-right">此日誌已由主管批示、已鎖定。</p>
      )}

      {log.manager_comment && (
        <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4">
          <div className="text-xs font-semibold text-primary mb-1 flex items-center gap-1.5"><Stamp className="w-3.5 h-3.5" /> 單位主管批示</div>
          <div className="text-sm whitespace-pre-wrap">{log.manager_comment}</div>
        </div>
      )}

      <MyHistory meId={appUser!.id} activeDate={date} onPick={(d) => setDate(d)} refreshKey={refreshKey} />

      {isSupervisor && <SupervisorReview meId={appUser!.id} />}
    </div>
  );
}

function Section({ title, Icon, tone, items, editable, onChange }: {
  title: string; Icon: typeof Zap; tone: "primary" | "accent"; items: Item[]; editable: boolean; onChange: (v: Item[]) => void;
}) {
  const [text, setText] = useState("");
  const add = () => { const t = text.trim(); if (!t) return; onChange([...items, { text: t, done: false }]); setText(""); };
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
          <li key={i} className="group flex items-center gap-2 text-sm rounded-lg hover:bg-muted/40 px-1.5 py-1">
            <button type="button" disabled={!editable}
              onClick={() => onChange(items.map((x, j) => (j === i ? { ...x, done: !x.done } : x)))}
              className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${it.done ? "bg-primary border-primary text-primary-foreground" : "bg-card"}`}>
              {it.done && <Check className="w-3 h-3" />}
            </button>
            {editable ? (
              <input value={it.text}
                onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
                className={`flex-1 bg-transparent outline-none border-b border-transparent focus:border-border ${it.done ? "line-through text-muted-foreground" : ""}`} />
            ) : (
              <span className={`flex-1 ${it.done ? "line-through text-muted-foreground" : ""}`}>{it.text}</span>
            )}
            {editable && (
              <button type="button" onClick={() => onChange(items.filter((_, j) => j !== i))} className="text-muted-foreground/50 hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity shrink-0"><X className="w-3.5 h-3.5" /></button>
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

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { t: string; c: string }> = {
    draft: { t: "草稿", c: "bg-muted text-muted-foreground" },
    submitted: { t: "已送出", c: "bg-accent/15 text-accent" },
    reviewed: { t: "已批示", c: "bg-primary/15 text-primary" },
  };
  const s = map[status] ?? map.draft;
  return <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${s.c}`}>{s.t}</span>;
}

const txtOf = (r: any) => [...arr(r.routine_morning), ...arr(r.routine_afternoon), ...arr(r.special_items)].map((x) => x.text).join(" ");
const cntOf = (r: any) => arr(r.routine_morning).length + arr(r.routine_afternoon).length + arr(r.special_items).length;

// 我的日誌記錄：預設本月，可切月份、篩狀態、搜尋（避免全部累積秀出來）
function MyHistory({ meId, activeDate, onPick, refreshKey }: { meId: string; activeDate: string; onPick: (d: string) => void; refreshKey: number }) {
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
        .select("id,log_date,status,routine_morning,routine_afternoon,special_items")
        .eq("user_id", meId).gte("log_date", start).lt("log_date", end).order("log_date", { ascending: false });
      setRows(data ?? []);
    })();
  }, [meId, month, refreshKey]);
  const filtered = rows.filter((r) => (st === "all" || r.status === st) && (!q || txtOf(r).toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="space-y-2 pt-2">
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-sm font-semibold text-muted-foreground">我的日誌記錄</h2>
        <input type="month" value={month} max={today().slice(0, 7)} onChange={(e) => setMonth(e.target.value)} className="h-8 rounded-md border bg-card px-2 text-xs" />
        <select value={st} onChange={(e) => setSt(e.target.value)} className="h-8 rounded-md border bg-card px-2 text-xs">
          <option value="all">全部狀態</option><option value="draft">草稿</option><option value="submitted">已送出</option><option value="reviewed">已批示</option>
        </select>
        <div className="relative flex-1 min-w-[140px]">
          <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋內容…" className="h-8 w-full rounded-md border bg-card pl-7 pr-2 text-xs" />
        </div>
      </div>
      {filtered.length === 0 ? (
        <p className="text-xs text-muted-foreground px-1">此月份沒有符合的日誌。</p>
      ) : (
        <div className="rounded-2xl border overflow-hidden bg-card">
          {filtered.map((r) => (
            <button key={r.id} onClick={() => onPick(r.log_date)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 border-b last:border-b-0 text-sm hover:bg-accent/40 transition-colors ${r.log_date === activeDate ? "bg-primary/5" : ""}`}>
              <span className="font-medium tabular-nums shrink-0">{r.log_date}</span>
              <span className="text-xs text-muted-foreground flex-1 text-left truncate">{cntOf(r)} 個項目</span>
              <StatusBadge status={r.status} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// 部門日誌批示：預設只顯示待批示，可切換顯示已批示、可搜尋（避免全部展開）
function SupervisorReview({ meId }: { meId: string }) {
  const [rows, setRows] = useState<any[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [draftComment, setDraftComment] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [showReviewed, setShowReviewed] = useState(false);
  const [q, setQ] = useState("");
  const load = async () => {
    const statuses = showReviewed ? ["submitted", "reviewed"] : ["submitted"];
    const { data } = await supabase.from("work_log").select("*").neq("user_id", meId).in("status", statuses).order("log_date", { ascending: false }).limit(100);
    setRows(data ?? []);
    const { data: us } = await supabase.from("app_user").select("id,name");
    const m: Record<string, string> = {}; (us ?? []).forEach((u: any) => (m[u.id] = u.name)); setNames(m);
  };
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [meId, showReviewed]);
  const review = async (id: string) => {
    setBusy(id);
    const { error } = await supabase.from("work_log").update({
      manager_comment: draftComment[id] ?? "", status: "reviewed", reviewed_by: meId,
      reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq("id", id);
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success("已批示"); void load();
  };
  const fmt = (v: any) => (Array.isArray(v) ? v.map((x: any) => (x.done ? "✓ " : "· ") + x.text).join("、") : "");
  const nameOf = (r: any) => names[r.user_id] ?? "同仁";
  const filtered = rows.filter((r) => !q || (nameOf(r) + txtOf(r)).toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="space-y-3 pt-2">
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-sm font-semibold flex items-center gap-2"><Stamp className="w-4 h-4 text-primary" /> 部門日誌批示</h2>
        <label className="text-xs text-muted-foreground flex items-center gap-1"><input type="checkbox" checked={showReviewed} onChange={(e) => setShowReviewed(e.target.checked)} /> 顯示已批示</label>
        <div className="relative flex-1 min-w-[140px]">
          <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋姓名/內容…" className="h-8 w-full rounded-md border bg-card pl-7 pr-2 text-xs" />
        </div>
      </div>
      {filtered.length === 0 ? (
        <div className="border border-dashed rounded-2xl py-10 text-center bg-card/40">
          <div className="w-11 h-11 mx-auto rounded-2xl bg-muted flex items-center justify-center"><Inbox className="w-5 h-5 text-muted-foreground/60" /></div>
          <p className="text-xs text-muted-foreground mt-2">{showReviewed ? "沒有符合的部門日誌。" : "目前沒有待批示的部門日誌。"}</p>
        </div>
      ) : filtered.map((r) => (
        <div key={r.id} className="rounded-2xl border bg-card p-4 space-y-2 shadow-sm">
          <div className="flex items-center justify-between"><div className="text-sm font-medium">{nameOf(r)} · {r.log_date}</div><StatusBadge status={r.status} /></div>
          <div className="text-xs text-muted-foreground space-y-0.5">
            <div><span className="text-foreground font-medium">例行：</span>{[fmt(r.routine_morning), fmt(r.routine_afternoon)].filter(Boolean).join("、") || "—"}</div>
            <div><span className="text-foreground font-medium">特殊：</span>{fmt(r.special_items) || "—"}</div>
          </div>
          {r.status === "reviewed" ? (
            <div className="text-sm rounded-lg bg-primary/5 border border-primary/20 p-2"><span className="text-primary font-medium">批示：</span>{r.manager_comment}</div>
          ) : (
            <div className="flex flex-col gap-2">
              <Textarea rows={2} placeholder="輸入批示…" value={draftComment[r.id] ?? ""} onChange={(e) => setDraftComment((d) => ({ ...d, [r.id]: e.target.value }))} />
              <div className="flex justify-end"><Button size="sm" onClick={() => review(r.id)} disabled={busy === r.id}><Stamp className="w-4 h-4 mr-1.5" /> {busy === r.id ? "批示中…" : "送出批示"}</Button></div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
