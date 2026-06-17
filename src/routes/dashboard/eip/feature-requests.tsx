import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Lightbulb } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useEipUser, canManageEip } from "@/lib/eip-user";
import { DEFAULT_TENANT_ID } from "@/lib/eip-constants";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Database } from "@/integrations/supabase/types";

export const Route = createFileRoute("/dashboard/eip/feature-requests")({
  component: FeatureRequestsPage,
});

type FeatureRequest =
  Database["public"]["Tables"]["eip_feature_request"]["Row"];
type AppUser = Database["public"]["Tables"]["app_user"]["Row"];

const STATUS_LABEL: Record<string, string> = {
  open: "待評估",
  planned: "規劃中",
  in_progress: "開發中",
  done: "已完成",
  rejected: "不採納",
};

const STATUS_COLOR: Record<string, string> = {
  open: "bg-slate-100 text-slate-700",
  planned: "bg-blue-100 text-blue-700",
  in_progress: "bg-amber-100 text-amber-700",
  done: "bg-emerald-100 text-emerald-700",
  rejected: "bg-rose-100 text-rose-700",
};

const MONTHLY_QUOTA = 30;

function FeatureRequestsPage() {
  const qc = useQueryClient();
  const { appUser } = useEipUser();
  const canManage = canManageEip(appUser?.role);
  const [openCreate, setOpenCreate] = useState(false);

  const listQ = useQuery({
    queryKey: ["eip", "feature-requests"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("eip_feature_request")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as FeatureRequest[];
    },
  });

  const usersQ = useQuery({
    queryKey: ["eip", "users-min"],
    queryFn: async () => {
      const { data, error } = await supabase.from("app_user").select("*");
      if (error) throw error;
      return (data ?? []) as AppUser[];
    },
  });

  const userMap = useMemo(
    () => new Map((usersQ.data ?? []).map((u) => [u.id, u])),
    [usersQ.data],
  );

  const monthlyUsed = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    return (listQ.data ?? [])
      .filter((r) => {
        const d = new Date(r.created_at);
        return d.getFullYear() === y && d.getMonth() === m;
      })
      .reduce((sum, r) => sum + (r.points_cost ?? 0), 0);
  }, [listQ.data]);
  const remaining = Math.max(0, MONTHLY_QUOTA - monthlyUsed);

  const updateStatus = async (id: string, status: string) => {
    const { error } = await supabase
      .from("eip_feature_request")
      .update({ status })
      .eq("id", id);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("狀態已更新");
      qc.invalidateQueries({ queryKey: ["eip", "feature-requests"] });
    }
  };

  if (listQ.isLoading)
    return <div className="text-muted-foreground py-8">載入中…</div>;

  return (
    <div>
      <PageHeader
        title="需求實驗室"
        description="提出產品/系統的優化想法,並追蹤評估與開發進度。"
        actions={
          appUser ? (
            <Button onClick={() => setOpenCreate(true)}>
              <Plus className="w-4 h-4" />
              新增需求
            </Button>
          ) : undefined
        }
      />

      <Card className="mb-4">
        <CardContent className="p-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-md bg-amber-100 text-amber-700 flex items-center justify-center">
            <Lightbulb className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <div className="text-xs text-muted-foreground">本月點數</div>
            <div className="text-sm">
              已用{" "}
              <span className="font-semibold text-foreground">
                {monthlyUsed}
              </span>{" "}
              / {MONTHLY_QUOTA},剩餘{" "}
              <span className="font-semibold text-foreground">
                {remaining}
              </span>
            </div>
          </div>
          <div className="w-48 h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-amber-500"
              style={{
                width: `${Math.min(100, (monthlyUsed / MONTHLY_QUOTA) * 100)}%`,
              }}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>標題</TableHead>
                <TableHead className="w-28">區塊</TableHead>
                <TableHead className="w-20 text-center">點數</TableHead>
                <TableHead className="w-36">狀態</TableHead>
                <TableHead className="w-32">提交者</TableHead>
                <TableHead className="w-40">建立時間</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(listQ.data ?? []).map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className="font-medium text-sm">{r.title}</div>
                    {r.description && (
                      <div className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                        {r.description}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{r.area ?? "—"}</TableCell>
                  <TableCell className="text-center text-sm">
                    {r.points_cost}
                  </TableCell>
                  <TableCell>
                    {canManage ? (
                      <Select
                        value={r.status}
                        onValueChange={(v) => updateStatus(r.id, v)}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(STATUS_LABEL).map(([k, v]) => (
                            <SelectItem key={k} value={k}>
                              {v}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge
                        variant="secondary"
                        className={`text-[11px] ${STATUS_COLOR[r.status] ?? ""}`}
                      >
                        {STATUS_LABEL[r.status] ?? r.status}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {r.submitter_id
                      ? userMap.get(r.submitter_id)?.name ?? "—"
                      : "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(r.created_at).toLocaleString("zh-TW")}
                  </TableCell>
                </TableRow>
              ))}
              {(listQ.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-10 text-center text-muted-foreground"
                  >
                    尚無需求
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {openCreate && appUser && (
        <CreateRequestDialog
          appUser={appUser}
          onClose={() => setOpenCreate(false)}
          onCreated={() =>
            qc.invalidateQueries({ queryKey: ["eip", "feature-requests"] })
          }
        />
      )}
    </div>
  );
}

function CreateRequestDialog({
  appUser,
  onClose,
  onCreated,
}: {
  appUser: AppUser;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [area, setArea] = useState("");
  const [points, setPoints] = useState(1);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!title.trim()) return toast.error("請輸入標題");
    setBusy(true);
    try {
      const { error } = await supabase.from("eip_feature_request").insert({
        tenant_id: appUser.tenant_id ?? DEFAULT_TENANT_ID,
        title: title.trim(),
        area: area.trim() || null,
        points_cost: Math.max(1, Math.floor(points || 1)),
        description: description.trim() || null,
        submitter_id: appUser.id,
        status: "open",
      });
      if (error) throw error;
      toast.success("已新增需求");
      onCreated();
      onClose();
    } catch (e) {
      toast.error(`失敗：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>新增需求</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <Field label="標題">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="區塊">
              <Input
                value={area}
                onChange={(e) => setArea(e.target.value)}
                placeholder="例：任務、會議、公告"
              />
            </Field>
            <Field label="消耗點數">
              <Input
                type="number"
                min={1}
                value={points}
                onChange={(e) => setPoints(Number(e.target.value))}
              />
            </Field>
          </div>
          <Field label="說明">
            <Textarea
              rows={5}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="請描述使用情境、預期效益…"
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button onClick={submit} disabled={busy}>
            送出
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
