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

export function QuickReportButton() {
  const { appUser } = useEipUser();

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"late" | "leave" | "other">("late");
  const [busy, setBusy] = useState(false);

  // 遲到
  const [eta, setEta] = useState("");
  const [lateDetail, setLateDetail] = useState("");

  // 請假
  const [leaveFrom, setLeaveFrom] = useState("");
  const [leaveTo, setLeaveTo] = useState("");
  const [leaveDetail, setLeaveDetail] = useState("");
  const [leaveType, setLeaveType] = useState("");
  const [leaveTypes, setLeaveTypes] = useState<{ code: string; name: string }[]>([]);

  // 事件
  const [otherDetail, setOtherDetail] = useState("");

  const reset = () => {
    setEta("");
    setLateDetail("");
    setLeaveFrom("");
    setLeaveTo("");
    setLeaveDetail("");
    setLeaveType("");
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
    if (!eta.trim() && !lateDetail.trim()) {
      toast.error("請填寫預計到達時間或事由");
      return;
    }
    setBusy(true);
    const { error } = await supabase.from("eip_quick_report").insert({
      tenant_id: tenantId,
      submitter_id: appUser.id,
      type: "late",
      eta: eta.trim() || null,
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
    if (!leaveFrom || !leaveTo) {
      toast.error("請選擇請假起訖日");
      return;
    }
    if (!leaveType) {
      toast.error("請選擇假別");
      return;
    }
    setBusy(true);
    const { error } = await supabase.from("eip_quick_report").insert({
      tenant_id: tenantId,
      submitter_id: appUser.id,
      type: "leave",
      leave_type: leaveType,
      leave_from: leaveFrom,
      leave_to: leaveTo,
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
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="late">遲到</TabsTrigger>
              <TabsTrigger value="leave">請假</TabsTrigger>
              <TabsTrigger value="other">事件</TabsTrigger>
            </TabsList>

            <TabsContent value="late" className="space-y-3 pt-2">
              <div>
                <Label>預計到達時間</Label>
                <Input
                  placeholder="例如 09:30 或 10:00 前到"
                  value={eta}
                  onChange={(e) => setEta(e.target.value)}
                />
              </div>
              <div>
                <Label>事由</Label>
                <Textarea
                  rows={3}
                  value={lateDetail}
                  onChange={(e) => setLateDetail(e.target.value)}
                  placeholder="(選填)"
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
                <Button disabled={busy} onClick={submitLate}>送出</Button>
              </DialogFooter>
            </TabsContent>

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
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>起</Label>
                  <Input type="date" value={leaveFrom} onChange={(e) => setLeaveFrom(e.target.value)} />
                </div>
                <div>
                  <Label>迄</Label>
                  <Input type="date" value={leaveTo} onChange={(e) => setLeaveTo(e.target.value)} />
                </div>
              </div>
              <div>
                <Label>事由</Label>
                <Textarea
                  rows={3}
                  value={leaveDetail}
                  onChange={(e) => setLeaveDetail(e.target.value)}
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
                <Button disabled={busy} onClick={submitLeave}>送出</Button>
              </DialogFooter>
            </TabsContent>

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
    </>
  );
}
