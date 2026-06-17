import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type AppUserLite = { id: string; name: string | null };

export function QuickReportButton() {
  const { appUser } = useEipUser();
  const { roles } = useAuth();
  const isManager =
    roles.includes("admin") ||
    roles.includes("manager") ||
    roles.includes("company_admin") ||
    roles.includes("dept_manager");

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"late" | "leave" | "assign">("late");
  const [busy, setBusy] = useState(false);

  // 遲到
  const [eta, setEta] = useState("");
  const [lateDetail, setLateDetail] = useState("");

  // 請假
  const [leaveFrom, setLeaveFrom] = useState("");
  const [leaveTo, setLeaveTo] = useState("");
  const [leaveDetail, setLeaveDetail] = useState("");

  // 交辦
  const [assignOwner, setAssignOwner] = useState("");
  const [assignTitle, setAssignTitle] = useState("");
  const [assignDesc, setAssignDesc] = useState("");
  const [assignDue, setAssignDue] = useState("");
  const [users, setUsers] = useState<AppUserLite[]>([]);

  useEffect(() => {
    if (!open || !isManager) return;
    void (async () => {
      const { data } = await supabase
        .from("app_user")
        .select("id,name")
        .eq("status", "active")
        .order("name");
      setUsers((data ?? []) as AppUserLite[]);
    })();
  }, [open, isManager]);

  const reset = () => {
    setEta("");
    setLateDetail("");
    setLeaveFrom("");
    setLeaveTo("");
    setLeaveDetail("");
    setAssignOwner("");
    setAssignTitle("");
    setAssignDesc("");
    setAssignDue("");
  };

  const tenantId = appUser?.tenant_id ?? DEFAULT_TENANT_ID;

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
    setBusy(true);
    const { error } = await supabase.from("eip_quick_report").insert({
      tenant_id: tenantId,
      submitter_id: appUser.id,
      type: "leave",
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

  const submitAssign = async () => {
    if (!appUser) return;
    if (!assignOwner) return toast.error("請選擇負責人");
    if (!assignTitle.trim()) return toast.error("請輸入事項標題");
    setBusy(true);
    try {
      const { data: st } = await supabase
        .from("task_status")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("is_default", true)
        .eq("is_done_state", false)
        .order("sort_order")
        .limit(1)
        .maybeSingle();
      const sid = (st as { id: string } | null)?.id ?? null;
      const { error } = await supabase.from("task").insert({
        tenant_id: tenantId,
        title: assignTitle.trim(),
        description: assignDesc.trim() || null,
        owner_id: assignOwner,
        priority: "normal",
        status_id: sid,
        progress: 0,
        due_date: assignDue || null,
        created_by: appUser.id,
      });
      if (error) throw error;
      toast.success("交辦任務已建立");
      reset();
      setOpen(false);
    } catch (e) {
      toast.error(`建立失敗：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
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
            <TabsList className={isManager ? "grid w-full grid-cols-3" : "grid w-full grid-cols-2"}>
              <TabsTrigger value="late">遲到</TabsTrigger>
              <TabsTrigger value="leave">請假</TabsTrigger>
              {isManager && <TabsTrigger value="assign">交辦</TabsTrigger>}
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

            {isManager && (
              <TabsContent value="assign" className="space-y-3 pt-2">
                <div>
                  <Label>指派給</Label>
                  <Select value={assignOwner} onValueChange={setAssignOwner}>
                    <SelectTrigger><SelectValue placeholder="選擇負責人" /></SelectTrigger>
                    <SelectContent>
                      {users.map((u) => (
                        <SelectItem key={u.id} value={u.id}>{u.name ?? u.id}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>事項標題</Label>
                  <Input value={assignTitle} onChange={(e) => setAssignTitle(e.target.value)} />
                </div>
                <div>
                  <Label>說明</Label>
                  <Textarea rows={3} value={assignDesc} onChange={(e) => setAssignDesc(e.target.value)} />
                </div>
                <div>
                  <Label>期限</Label>
                  <Input type="date" value={assignDue} onChange={(e) => setAssignDue(e.target.value)} />
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
                  <Button disabled={busy} onClick={submitAssign}>建立任務</Button>
                </DialogFooter>
              </TabsContent>
            )}
          </Tabs>
        </DialogContent>
      </Dialog>
    </>
  );
}
