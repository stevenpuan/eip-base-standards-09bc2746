import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { toast } from "sonner";

export const Route = createFileRoute("/dashboard/feature-requests")({ component: Page });

function Page() {
  const { can, user } = useAuth();
  const qc = useQueryClient();
  const canEdit = can("feature_requests", "edit");
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [area, setArea] = useState("");
  const [desc, setDesc] = useState("");
  const [cost, setCost] = useState("1");

  const { data: statuses = [] } = useQuery({
    queryKey: ["lk", "feature_request_status"],
    queryFn: async () => {
      const { data } = await supabase.from("lookups").select("code,label").eq("category", "feature_request_status").eq("is_active", true).order("sort_order");
      return (data ?? []) as { code: string; label: string }[];
    },
  });
  const { data: configs = [] } = useQuery({
    queryKey: ["wish_config"],
    queryFn: async () => {
      const { data } = await supabase.from("system_configs").select("key,value").in("key", ["wish_points_monthly", "wish_allow_overdraft"]);
      return (data ?? []) as { key: string; value: string }[];
    },
  });
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["feature_requests"],
    queryFn: async () => {
      const { data, error } = await supabase.from("feature_requests").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const label = (c: string) => statuses.find((s) => s.code === c)?.label ?? c;
  const monthly = parseInt(configs.find((c) => c.key === "wish_points_monthly")?.value ?? "30", 10);
  const overdraft = (configs.find((c) => c.key === "wish_allow_overdraft")?.value ?? "false") === "true";
  const now = new Date();
  const consumed = rows
    .filter((r) => { const d = new Date(r.created_at); return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth(); })
    .reduce((s, r) => s + (r.points_cost ?? 0), 0);
  const remaining = monthly - consumed;
  const period = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}`;

  const create = async () => {
    if (!title) { toast.error("請輸入標題"); return; }
    const c = Math.max(1, parseInt(cost || "1", 10));
    if (remaining < c && !overdraft) { toast.error(`本月點數不足（剩 ${remaining}）`); return; }
    const { error } = await supabase.from("feature_requests").insert({ title, area: area || null, description: desc || null, points_cost: c, submitter_id: user?.id ?? null });
    if (error) { toast.error(error.message); return; }
    toast.success("已送出許願");
    setOpen(false); setTitle(""); setArea(""); setDesc(""); setCost("1");
    qc.invalidateQueries({ queryKey: ["feature_requests"] });
  };

  const changeStatus = async (id: string, status: string) => {
    const { error } = await supabase.from("feature_requests").update({ status }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    qc.invalidateQueries({ queryKey: ["feature_requests"] });
  };

  return (
    <div className="space-y-6">
      <PageHeader title="許願清單" description="提出功能需求（每月點數配額）" actions={can("feature_requests", "create") ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button>新增許願</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>新增許願</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1"><Label>標題</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
              <div className="space-y-1"><Label>區塊</Label><Input value={area} onChange={(e) => setArea(e.target.value)} /></div>
              <div className="space-y-1"><Label>消耗點數</Label><Input type="number" value={cost} onChange={(e) => setCost(e.target.value)} /></div>
              <div className="space-y-1"><Label>說明</Label><Textarea value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
            </div>
            <DialogFooter><Button onClick={create}>送出</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      ) : undefined} />

      <Card><CardContent className="py-4 flex items-center gap-6">
        <div>
          <div className="text-xs text-muted-foreground">本月許願點數（{period}）</div>
          <div className="text-2xl font-bold">
            <span className={remaining < 0 ? "text-destructive" : ""}>{remaining}</span>
            <span className="text-base text-muted-foreground font-normal"> / {monthly}</span>
          </div>
        </div>
        {overdraft && <Badge variant="outline">允許超支</Badge>}
      </CardContent></Card>

      {isLoading ? <p className="text-muted-foreground">載入中…</p> : (
        <Card><CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>標題</TableHead><TableHead>區塊</TableHead><TableHead>點數</TableHead><TableHead>狀態</TableHead><TableHead>建立時間</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">尚無資料</TableCell></TableRow>}
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.title}</TableCell>
                  <TableCell>{r.area ?? "—"}</TableCell>
                  <TableCell>{r.points_cost ?? 1}</TableCell>
                  <TableCell>
                    {canEdit ? (
                      <Select value={r.status} onValueChange={(v) => changeStatus(r.id, v)}>
                        <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
                        <SelectContent>{statuses.map((s) => <SelectItem key={s.code} value={s.code}>{s.label}</SelectItem>)}</SelectContent>
                      </Select>
                    ) : <Badge variant="secondary">{label(r.status)}</Badge>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent></Card>
      )}
    </div>
  );
}
