import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useEipUser } from "@/lib/eip-user";
import { DEFAULT_TENANT_ID } from "@/lib/eip-constants";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

// 本地日期 YYYY-MM-DD（台北）
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
// 組成帶時區的時間戳（台北 +08:00）
const ts = (date: string, time: string) => `${date}T${(time || "00:00")}:00+08:00`;

const TYPE_LABEL: Record<string, string> = { late: "遲到", leave: "請假", other: "事件" };
const TYPE_COLOR: Record<string, string> = {
  late: "bg-amber-100 text-amber-700 border-amber-300",
  leave: "bg-blue-100 text-blue-700 border-blue-300",
  other: "bg-slate-100 text-slate-700 border-slate-300",
};
const STATUS_LABEL: Record<string, string> = { open: "待處理", acknowledged: "已處理", done: "已處理", closed: "已處理" };
const DONE_STATUSES = new Set(["acknowledged", "done", "closed"]);

export function QuickReportButton() {
  const { appUser } = useEipUser();

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"late" | "leave" | "other">("late");
  const [busy, setBusy] = useState(false);

  // 遲到：時段（幾點幾分 ~ 幾點幾分）
  const [lateStart, setLateStart] = useState("");
  const [lateEnd, setLateEnd] = useState("");
  const [lateDetail, setLateDetail] = useState("");

  // 請假：假別 / 日期區間 / 時間區間
  const [leaveType, setLeaveType] = useState("");
  const [leaveFromDate, setLeaveFromDate] = useState("");
  const [leaveToDate, setLeaveToDate] = useState("");
  const [leaveFromTime, setLeaveFromTime] = useState("");
  const [leaveToTime, setLeaveToTime] = useState("");
  const [leaveDetail, setLeaveDetail] = useState("");
  const [leaveTypes, setLeaveTypes] = useState<{ code: string; name: string }[]>([]);

  // 事件
  const [otherDetail, setOtherDetail] = useState("");

  const reset = () => {
    setLateStart(""); setLateEnd(""); setLateDetail("");
    setLeaveType(""); setLeaveFromDate(""); setLeaveToDate("");
    setLeaveFromTime(""); setLeaveToTime(""); setLeaveDetail("");
    setOtherDetail("");
  };

  const tenantId = appUser?.tenant_id ?? DEFAULT_TENANT_ID;

  useEffect(() => {
    if (!open) return;
    void supabase
      .from("leave_type")
      .select("code,name")
      .eq("is_active", true)
      .order("sort_order")
      .then((res: any) => setLeaveTypes(res.data ?? []));
  }, [open]);


  const submitLate = async () => {
    if (!appUser) return;
    if (!lateStart && !lateEnd && !lateDetail.trim()) {
      toast.error("請填寫遲到時段或事由");
      return;
    }
    const today = todayStr();
    const etaText = lateStart || lateEnd ? `${lateStart || "—"} ~ ${lateEnd || "—"}` : null;
    setBusy(true);
    const { error } = await supabase.from("eip_quick_report").insert({
      tenant_id: tenantId,
      submitter_id: appUser.id,
      type: "late",
      report_date: today,
      eta: etaText,
      leave_from: lateStart ? ts(today, lateStart) : null,
      leave_to: lateEnd ? ts(today, lateEnd) : null,
      detail: lateDetail.trim() || null,
    });
    setBusy(false);
    if (error) return toast.error(`送出失敗：${error.message}`);
    toast.success("遲到回報已送出");
    reset();
    setOpen(false);
  };

  const submitLeave = async () => {
    if (!appUser) return;
    if (!leaveType) { toast.error("請選擇假別"); return; }
    if (!leaveFromDate || !leaveToDate) { toast.error("請選擇請假日期（起訖）"); return; }
    if (leaveToDate < leaveFromDate) { toast.error("迄日不可早於起日"); return; }
    setBusy(true);
    const { error } = await supabase.from("eip_quick_report").insert({
      tenant_id: tenantId,
      submitter_id: appUser.id,
      type: "leave",
      leave_type: leaveType,
      report_date: leaveFromDate,
      leave_from: ts(leaveFromDate, leaveFromTime || "00:00"),
      leave_to: ts(leaveToDate, leaveToTime || "23:59"),
      detail: leaveDetail.trim() || null,
    });
    setBusy(false);
    if (error) return toast.error(`送出失敗：${error.message}`);
    toast.success("請假回報已送出");
    reset();
    setOpen(false);
  };

  const submitOther = async () => {
    if (!appUser) return;
    if (!otherDetail.trim()) return toast.error("請填寫事件內容");
    setBusy(true);
    const { error } = await supabase.from("eip_quick_report").insert({
      tenant_id: tenantId,
      submitter_id: appUser.id,
      type: "other",
      report_date: todayStr(),
      detail: otherDetail.trim(),
    });
    setBusy(false);
    if (error) return toast.error(`送出失敗：${error.message}`);
    toast.success("事件回報已送出");
    reset();
    setOpen(false);
  };

  if (!appUser) return null;

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 h-12 rounded-full shadow-lg px-5"
      >
        <Plus className="h-4 w-4" /> 快速回報
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>快速回報</DialogTitle>
          </DialogHeader>
          <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="late">遲到</TabsTrigger>
              <TabsTrigger value="leave">請假</TabsTrigger>
              <TabsTrigger value="other">事件</TabsTrigger>
              <TabsTrigger value="mine">我的紀錄</TabsTrigger>
            </TabsList>


            {/* 遲到 */}
            <TabsContent value="late" className="space-y-3 pt-2">
              <div>
                <Label>遲到時段（今日）</Label>
                <div className="grid grid-cols-2 gap-3 mt-1">
                  <div>
                    <span className="text-xs text-muted-foreground">起</span>
                    <Input type="time" value={lateStart} onChange={(e) => setLateStart(e.target.value)} />
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">迄（預計到達）</span>
                    <Input type="time" value={lateEnd} onChange={(e) => setLateEnd(e.target.value)} />
                  </div>
                </div>
              </div>
              <div>
                <Label>事由</Label>
                <Textarea rows={3} value={lateDetail} onChange={(e) => setLateDetail(e.target.value)} placeholder="(選填)" />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
                <Button disabled={busy} onClick={submitLate}>送出</Button>
              </DialogFooter>
            </TabsContent>

            {/* 請假 */}
            <TabsContent value="leave" className="space-y-3 pt-2">
              <div>
                <Label>假別</Label>
                <select
                  value={leaveType}
                  onChange={(e) => setLeaveType(e.target.value)}
                  className="h-9 w-full rounded-md border bg-card px-2 text-sm"
                >
                  <option value="">選擇假別…</option>
                  {leaveTypes.map((t) => (
                    <option key={t.code} value={t.code}>{t.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label>請假日期</Label>
                <div className="grid grid-cols-2 gap-3 mt-1">
                  <div>
                    <span className="text-xs text-muted-foreground">起</span>
                    <Input type="date" value={leaveFromDate} onChange={(e) => setLeaveFromDate(e.target.value)} />
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">迄</span>
                    <Input type="date" value={leaveToDate} onChange={(e) => setLeaveToDate(e.target.value)} />
                  </div>
                </div>
              </div>
              <div>
                <Label>請假時間 <span className="text-xs text-muted-foreground">（選填，半天／時段假可填）</span></Label>
                <div className="grid grid-cols-2 gap-3 mt-1">
                  <div>
                    <span className="text-xs text-muted-foreground">起</span>
                    <Input type="time" value={leaveFromTime} onChange={(e) => setLeaveFromTime(e.target.value)} />
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">迄</span>
                    <Input type="time" value={leaveToTime} onChange={(e) => setLeaveToTime(e.target.value)} />
                  </div>
                </div>
              </div>
              <div>
                <Label>事由</Label>
                <Textarea rows={3} value={leaveDetail} onChange={(e) => setLeaveDetail(e.target.value)} placeholder="(選填)" />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
                <Button disabled={busy} onClick={submitLeave}>送出</Button>
              </DialogFooter>
            </TabsContent>

            {/* 事件 */}
            <TabsContent value="other" className="space-y-3 pt-2">
              <div>
                <Label>事件內容</Label>
                <Textarea
                  rows={4}
                  value={otherDetail}
                  onChange={(e) => setOtherDetail(e.target.value)}
                  placeholder="描述需要主管知悉或處理的事件"
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
                <Button disabled={busy} onClick={submitOther}>送出</Button>
              </DialogFooter>
            </TabsContent>
            {/* 我的紀錄 */}
            <TabsContent value="mine" className="pt-2">
              <div className="max-h-[60vh] overflow-y-auto -mx-1 px-1">
                {loadingMine ? (
                  <div className="text-sm text-muted-foreground py-8 text-center">載入中…</div>
                ) : myRows.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-10 text-center">
                    尚無回報紀錄。切到「遲到／請假／事件」分頁提交第一筆吧。
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {myRows.map((r) => {
                      const done = DONE_STATUSES.has(r.status);
                      return (
                        <li key={r.id} className="rounded-md border bg-card p-2.5 text-sm">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs ${TYPE_COLOR[r.type] ?? ""}`}>
                              {TYPE_LABEL[r.type] ?? r.type}
                            </span>
                            <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs ${done ? "bg-emerald-100 text-emerald-700 border-emerald-300" : "bg-amber-100 text-amber-700 border-amber-300"}`}>
                              {STATUS_LABEL[r.status] ?? r.status}
                            </span>
                            <span className="text-xs text-muted-foreground ml-auto">
                              {r.report_date} · {new Date(r.created_at).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </div>
                          {r.type === "late" && r.eta && (
                            <div className="text-xs text-muted-foreground">時段：{r.eta}</div>
                          )}
                          {r.type === "leave" && (
                            <div className="text-xs text-muted-foreground">
                              {r.leave_type ? `${r.leave_type}｜` : ""}
                              {r.leave_from && r.leave_to
                                ? `${new Date(r.leave_from).toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} ~ ${new Date(r.leave_to).toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}`
                                : ""}
                            </div>
                          )}
                          {r.detail && <div className="mt-1 whitespace-pre-wrap">{r.detail}</div>}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
              <DialogFooter className="mt-3">
                <Button variant="outline" onClick={() => void loadMine()} disabled={loadingMine}>重新整理</Button>
                <Button onClick={() => setOpen(false)}>關閉</Button>
              </DialogFooter>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </>
  );
}
