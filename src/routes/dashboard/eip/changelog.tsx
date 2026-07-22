import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useEipUser } from "@/lib/eip-user";
import { useAuth } from "@/lib/auth";
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
export const Route = createFileRoute("/dashboard/eip/changelog")({
  component: ChangelogPage,
});

type Changelog = {
  id: string;
  tenant_id: string;
  version: string | null;
  title: string;
  type: string;
  content: string | null;
  released_at: string;
  created_by: string | null;
  created_at: string;
};
type AppUser = { id: string; name: string | null; email: string | null; tenant_id?: string | null };

const TYPE_LABEL: Record<string, string> = {
  feature: "功能",
  fix: "修正",
  improvement: "優化",
  other: "其他",
};

const TYPE_COLOR: Record<string, string> = {
  feature: "bg-blue-100 text-blue-700",
  fix: "bg-rose-100 text-rose-700",
  improvement: "bg-emerald-100 text-emerald-700",
  other: "bg-slate-100 text-slate-700",
};

function ChangelogPage() {
  const qc = useQueryClient();
  const { appUser } = useEipUser();
  const canPublish = canManageEip(appUser?.role);
  const [openCreate, setOpenCreate] = useState(false);
  const [selected, setSelected] = useState<Changelog | null>(null);

  const listQ = useQuery({
    queryKey: ["eip", "changelog"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("changelogs")
        .select("*")
        .order("released_at", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Changelog[];
    },
  });

  if (listQ.isLoading)
    return <div className="text-muted-foreground py-8">載入中…</div>;

  return (
    <div>
      <PageHeader
        title="開發紀錄"
        description="系統版本與更新內容紀錄。"
        actions={
          canPublish && appUser ? (
            <Button onClick={() => setOpenCreate(true)}>
              <Plus className="w-4 h-4" />
              新增版本
            </Button>
          ) : undefined
        }
      />

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-32">版本</TableHead>
                <TableHead className="w-24">類型</TableHead>
                <TableHead>標題</TableHead>
                <TableHead className="w-32">發布日</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(listQ.data ?? []).map((r) => (
                <TableRow
                  key={r.id}
                  className="cursor-pointer"
                  onClick={() => setSelected(r)}
                >
                  <TableCell className="font-mono text-sm">{r.version}</TableCell>
                  <TableCell>
                    <Badge
                      variant="secondary"
                      className={`text-[11px] ${TYPE_COLOR[r.type] ?? ""}`}
                    >
                      {TYPE_LABEL[r.type] ?? r.type}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{r.title}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(r.released_at).toLocaleDateString("zh-TW")}
                  </TableCell>
                </TableRow>
              ))}
              {(listQ.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="py-10 text-center text-muted-foreground"
                  >
                    尚無發布紀錄
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {openCreate && appUser && (
        <CreateChangelogDialog
          appUser={appUser}
          onClose={() => setOpenCreate(false)}
          onCreated={() =>
            qc.invalidateQueries({ queryKey: ["eip", "changelog"] })
          }
        />
      )}

      {selected && (
        <Dialog open onOpenChange={(o) => !o && setSelected(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <span className="font-mono">{selected.version}</span>
                <Badge
                  variant="secondary"
                  className={`text-[11px] ${TYPE_COLOR[selected.type] ?? ""}`}
                >
                  {TYPE_LABEL[selected.type] ?? selected.type}
                </Badge>
                <span>{selected.title}</span>
              </DialogTitle>
            </DialogHeader>
            <div className="text-xs text-muted-foreground">
              發布日：
              {new Date(selected.released_at).toLocaleDateString("zh-TW")}
            </div>
            <div className="text-sm whitespace-pre-wrap py-2 max-h-[60vh] overflow-y-auto">
              {selected.content || "（無內容）"}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setSelected(null)}>
                關閉
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function CreateChangelogDialog({
  appUser,
  onClose,
  onCreated,
}: {
  appUser: AppUser;
  onClose: () => void;
  onCreated: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [version, setVersion] = useState("");
  const [type, setType] = useState("feature");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [releasedAt, setReleasedAt] = useState(today);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!version.trim() || !title.trim())
      return toast.error("請輸入版本與標題");
    setBusy(true);
    try {
      const { error } = await supabase.from("changelogs").insert({
        version: version.trim(),
        type,
        title: title.trim(),
        content: content.trim() || null,
        released_at: releasedAt,
      });
      if (error) throw error;
      toast.success("已新增版本");
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
          <DialogTitle>新增版本</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <Field label="版本">
              <Input
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                placeholder="例：v1.2.0"
              />
            </Field>
            <Field label="類型">
              <Select value={type} onValueChange={setType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TYPE_LABEL).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="標題">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="內容">
            <Textarea
              rows={6}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="本次更新內容…"
            />
          </Field>
          <Field label="發布日">
            <Input
              type="date"
              value={releasedAt}
              onChange={(e) => setReleasedAt(e.target.value)}
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
