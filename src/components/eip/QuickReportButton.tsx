import { useState } from "react";
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
import { LeaveRequestDialog } from "@/components/eip/LeaveRequestDialog";
import { humanizeError } from "@/lib/eip-error";

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
// acknowledged 不是完成：代辦全數完成才會由 DB trigger 推到 done，
// 任一項被取消完成就退回 acknowledged。與臨時回報頁採同一套口徑。
const STATUS_LABEL: Record<string, string> = { open: "待處理", acknowledged: "處理中", done: "已完成", closed: "已完成" };
const DONE_STATUSES = new Set(["done", "closed"]);

export function QuickReportButton() {
  const { appUser } = useEipUser();

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"late" | "leave" | "other">("late");
  const [busy, setBusy] = useState(false);

  // 遲到：時段（幾點幾分 ~ 幾點幾分）
  const [lateStart, setLateStart] = useState("");
  const [lateEnd, setLateEnd] = useState("");
  const [lateDetail, setLateDetail] = useState("");

  // 請假走 LeaveRequestDialog（區間＋代理人＋代辦清單），這裡不再自己收欄位
  const [leaveOpen, setLeaveOpen] = useState(false);

  // 事件
  const [otherDetail, setOtherDetail] = useState("");

  const reset = () => {
    setLateStart(""); setLateEnd(""); setLateDetail("");
    setOtherDetail("");
  };

  const tenantId = appUser?.tenant_id ?? DEFAULT_TENANT_ID;

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
    if (error) return toast.error(humanizeError(error, "送出"));
    toast.success("遲到回報已送出");
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
    if (error) return toast.error(humanizeError(error, "送出"));
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
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="late">遲到</TabsTrigger>
              <TabsTrigger value="leave">請假</TabsTrigger>
              <TabsTrigger value="other">事件</TabsTrigger>
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

            {/* 請假：定案第 13、15 條 —— 移除假別與事由（EZ9 已有正式假單），
                改用「請假申請＋代辦事項清單」單一表單，主入口在我的工作區 */}
            <TabsContent value="leave" className="space-y-3 pt-2">
              <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-2">
                <p className="font-medium">請假改成「區間 ＋ 代理人 ＋ 代辦清單」一次填完</p>
                <p className="text-xs text-muted-foreground">
                  假別與事由請走 EZ9 正式假單，EIP 只處理請假期間的工作交接。
                  送出後不需主管核准，系統會直接通知單位主管與代理人。
                </p>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
                <Button
                  onClick={() => {
                    setOpen(false);
                    setLeaveOpen(true);
                  }}
                >
                  填寫請假與代辦
                </Button>
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


          </Tabs>
        </DialogContent>
      </Dialog>

      {/* 請假的實際表單。放在這裡而不是 Dialog 內，避免兩個 Dialog 疊在一起 */}
      <LeaveRequestDialog open={leaveOpen} onClose={() => setLeaveOpen(false)} />
    </>
  );
}
