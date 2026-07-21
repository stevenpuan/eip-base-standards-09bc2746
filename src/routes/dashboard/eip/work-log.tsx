import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus, X, Check, Send, Stamp, Sun, Sunset, Zap, Inbox } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useEipUser } from "@/lib/eip-user";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export const Route = createFileRoute("/dashboard/eip/work-log")({ component: WorkLogPage });

type Item = { text: string; done: boolean };
interface Log {
  id?: string; user_id?: string; department_id?: string | null; log_date: string;
  routine_morning: Item[]; routine_afternoon: Item[]; special_items: Item[];
  status: string; manager_comment?: string | null; reviewed_at?: string | null;
}
const today = () => new Date().toISOString().slice(0, 10);
const arr = (v: unknown): Item[] => (Array.isArray(v) ? (v as Item[]) : []);

function WorkLogPage() {
  const { appUser } = useEipUser();
  const isSupervisor = appUser?.role === "dept_manager" || appUser?.role === "company_admin";
  const [date, setDate] = useState(today());
  const [log, setLog] = useState<Log | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [myLogs, setMyLogs] = useState<any[]>([]);

  const load = async () => {
    if (!appUser?.id) return;
    setLoading(true);
    const { data } = await supabase.from("work_log").select("*")
      .eq("user_id", appUser.id).eq("log_date", date).maybeSingle();
    if (data) {
      setLog({ ...data, routine_morning: arr(data.routine_morning), routine_afternoon: arr(data.routine_afternoon), special_items: arr(data.special_items) } as Log);
    } else {
      const { data: rec } = await supabase.from("task").select("title,progress")
        .eq("owner_id", appUser.id).not("recurring_rule_id", "is", null).eq("occurrence_date", date);
      const seeded: Item[] = (rec ?? []).map((t: any) => ({ text: t.title as string, done: (t.progress ?? 0) >= 100 }));
      // 今天完成的一次性(非週期)任務 → 自動帶入「特殊(突發)工作」並打勾
      const nextDate = new Date(new Date(date).getTime() + 864e5).toISOString().slice(0, 10);
      const { data: doneToday } = await supabase.from("task").select("title")
        .eq("owner_id", appUser.id).is("recurring_rule_id", null)
        .gte("completed_at", date).lt("completed_at", nextDate);
      const special: Item[] = (doneToday ?? []).map((t: any) => ({ text: t.title as string, done: true }));
      setLog({ log_date: date, department_id: appUser.department_id, routine_morning: seeded, routine_afternoon: [], special_items: special, status: "draft" });
    }
    setLoading(false);
  };
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [appUser?.id, date]);

  const loadMyLogs = async () => {
    if (!appUser?.id) return;
    const { data } = await supabase.from("work_log")
      .select("id,log_date,status,routine_morning,routine_afternoon,special_items")
      .eq("user_id", appUser.id).order("log_date", { ascending: false }).limit(60);
    setMyLogs(data ?? []);
  };
  useEffect(() => { void loadMyLogs(); /* eslint-disable-next-line */ }, [appUser?.id]);

  const persist = async (patch: Partial<Log>, successMsg?: string) => {
    if (!appUser?.id || !log) return;
    setSaving(true);
    const body = {
      user_id: appUser.id, department_id: appUser.department_id, log_date: date,
      routine_morning: log.routine_morning, routine_afternoon: log.routine_afternoon,
      special_items: log.special_items, status: log.status, ...patch, updated_at: new Date().toISOString(),
    };
    let res;
    if (log.id) res = await supabase.from("work_log").update(body).eq("id", log.id).select("*").maybeSingle();
    else res = await supabase.from("work_log").insert(body).select("*").maybeSingle();
    setSaving(false);
    if (res.error) { toast.error(res.error.message); return; }
    if (res.data) setLog((p) => (p ? { ...p, ...res.data } : p));
    void loadMyLogs();
    if (successMsg) toast.success(successMsg);
  };

  if (loading || !log) {
    return <div className="space-y-3"><div className="h-9 w-40 rounded-md bg-muted/50 animate-pulse" /><div className="h-56 rounded-2xl bg-muted/50 animate-pulse" /></div>;
  }

  const editable = log.status !== "reviewed";
  const setSection = (key: "routine_morning" | "routine_afternoon" | "special_items", items: Item[]) =>
    setLog((p) => (p ? { ...p, [key]: items } : p));

  return (
    <div className="space-y-6">
      <PageHeader title="工作日誌" description="每日填寫例行與特殊工作，送出後由單位主管批示。"
        actions={
          <div className="flex items-center gap-2">
            <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)}
              className="h-9 rounded-md border bg-card px-2 text-sm" />
            <StatusBadge status={log.status} />
          </div>
        } />

      <div className="grid gap-4 md:grid-cols-2">
        <SectionCard title="例行工作 · 上午" Icon={Sun} tone="primary" items={log.routine_morning} editable={editable} onChange={(v) => setSection("routine_morning", v)} />
        <SectionCard title="例行工作 · 下午" Icon={Sunset} tone="primary" items={log.routine_afternoon} editable={editable} onChange={(v) => setSection("routine_afternoon", v)} />
        <div className="md:col-span-2">
          <SectionCard title="特殊（突發）工作" Icon={Zap} tone="accent" items={log.special_items} editable={editable} onChange={(v) => setSection("special_items", v)} />
        </div>
      </div>

      {editable && (
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => persist({}, "已儲存草稿")} disabled={saving}>儲存草稿</Button>
          <Button onClick={() => persist({ status: "submitted", submitted_at: new Date().toISOString() }, "已送出")} disabled={saving}>
            <Send className="w-4 h-4 mr-1.5" /> 送出
          </Button>
        </div>
      )}

      {log.manager_comment && (
        <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4">
          <div className="text-xs font-semibold text-primary mb-1 flex items-center gap-1.5"><Stamp className="w-3.5 h-3.5" /> 單位主管批示</div>
          <div className="text-sm whitespace-pre-wrap">{log.manager_comment}</div>
        </div>
      )}

      <MyLogsList rows={myLogs} activeDate={date} onPick={(d) => setDate(d)} />

      {isSupervisor && <SupervisorReview meId={appUser!.id} />}
    </div>
  );
}

function SectionCard({ title, Icon, tone, items, editable, onChange }: {
  title: string; Icon: typeof Sun; tone: "primary" | "accent"; items: Item[]; editable: boolean; onChange: (v: Item[]) => void;
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
          <li key={i} className="flex items-center gap-2 text-sm rounded-lg hover:bg-muted/40 px-1.5 py-1">
            <button type="button" disabled={!editable}
              onClick={() => onChange(items.map((x, j) => (j === i ? { ...x, done: !x.done } : x)))}
              className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${it.done ? "bg-primary border-primary text-primary-foreground" : "bg-card"}`}>
              {it.done && <Check className="w-3 h-3" />}
            </button>
            <span className={`flex-1 ${it.done ? "line-through text-muted-foreground" : ""}`}>{it.text}</span>
            {editable && (
              <button type="button" onClick={() => onChange(items.filter((_, j) => j !== i))} className="text-muted-foreground/50 hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"><X className="w-3.5 h-3.5" /></button>
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

function MyLogsList({ rows, activeDate, onPick }: { rows: any[]; activeDate: string; onPick: (d: string) => void }) {
  const cnt = (r: any) => arr(r.routine_morning).length + arr(r.routine_afternoon).length + arr(r.special_items).length;
  return (
    <div className="space-y-2 pt-2">
      <h2 className="text-sm font-semibold text-muted-foreground px-1">我的日誌記錄</h2>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground px-1">尚無日誌記錄。填寫後按「儲存草稿」或「送出」即會出現在這裡,點選任一天即可載回修改。</p>
      ) : (
        <div className="rounded-2xl border overflow-hidden bg-card">
          {rows.map((r) => (
            <button key={r.id} onClick={() => onPick(r.log_date)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 border-b last:border-b-0 text-sm hover:bg-accent/40 transition-colors ${r.log_date === activeDate ? "bg-primary/5" : ""}`}>
              <span className="font-medium tabular-nums shrink-0">{r.log_date}</span>
              <span className="text-xs text-muted-foreground flex-1 text-left truncate">{cnt(r)} 個項目</span>
              <StatusBadge status={r.status} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SupervisorReview({ meId }: { meId: string }) {
  const [rows, setRows] = useState<any[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [draftComment, setDraftComment] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    const { data } = await supabase.from("work_log").select("*")
      .neq("user_id", meId).in("status", ["submitted", "reviewed"]).order("log_date", { ascending: false }).limit(100);
    setRows(data ?? []);
    const { data: us } = await supabase.from("app_user").select("id,name");
    const m: Record<string, string> = {};
    (us ?? []).forEach((u: any) => (m[u.id] = u.name));
    setNames(m);
  };
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [meId]);

  const review = async (id: string) => {
    setBusy(id);
    const { error } = await supabase.from("work_log").update({
      manager_comment: draftComment[id] ?? "", status: "reviewed",
      reviewed_by: meId, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq("id", id);
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success("已批示"); void load();
  };
  const fmtItems = (v: any) => (Array.isArray(v) ? v.map((x: any) => (x.done ? "✓ " : "· ") + x.text).join("、") : "");

  return (
    <div className="space-y-3 pt-2">
      <h2 className="text-sm font-semibold flex items-center gap-2"><Stamp className="w-4 h-4 text-primary" /> 部門日誌批示</h2>
      {rows.length === 0 ? (
        <div className="border border-dashed rounded-2xl py-10 text-center bg-card/40">
          <div className="w-11 h-11 mx-auto rounded-2xl bg-muted flex items-center justify-center"><Inbox className="w-5 h-5 text-muted-foreground/60" /></div>
          <p className="text-xs text-muted-foreground mt-2">目前沒有待批示或已批示的部門日誌。</p>
        </div>
      ) : rows.map((r) => (
        <div key={r.id} className="rounded-2xl border bg-card p-4 space-y-2 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">{names[r.user_id] ?? "同仁"} · {r.log_date}</div>
            <StatusBadge status={r.status} />
          </div>
          <div className="text-xs text-muted-foreground space-y-0.5">
            <div><span className="text-foreground font-medium">上午：</span>{fmtItems(r.routine_morning) || "—"}</div>
            <div><span className="text-foreground font-medium">下午：</span>{fmtItems(r.routine_afternoon) || "—"}</div>
            <div><span className="text-foreground font-medium">特殊：</span>{fmtItems(r.special_items) || "—"}</div>
          </div>
          {r.status === "reviewed" ? (
            <div className="text-sm rounded-lg bg-primary/5 border border-primary/20 p-2"><span className="text-primary font-medium">批示：</span>{r.manager_comment}</div>
          ) : (
            <div className="flex flex-col gap-2">
              <Textarea rows={2} placeholder="輸入批示…" value={draftComment[r.id] ?? ""}
                onChange={(e) => setDraftComment((d) => ({ ...d, [r.id]: e.target.value }))} />
              <div className="flex justify-end">
                <Button size="sm" onClick={() => review(r.id)} disabled={busy === r.id}>
                  <Stamp className="w-4 h-4 mr-1.5" /> {busy === r.id ? "批示中…" : "送出批示"}
                </Button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
