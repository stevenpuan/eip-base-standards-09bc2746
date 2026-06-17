import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Pin, Megaphone, Download } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { exportToExcel } from "@/lib/eip-export";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import type { Database } from "@/integrations/supabase/types";

export const Route = createFileRoute("/dashboard/eip/announcements")({ component: AnnouncementsPage });

type Announcement = Database["public"]["Tables"]["announcement"]["Row"];
type AppUser = Database["public"]["Tables"]["app_user"]["Row"];
type Department = Database["public"]["Tables"]["department"]["Row"];
type Audience = Database["public"]["Enums"]["announcement_audience"];

const AUDIENCE_LABEL: Record<Audience, string> = { all: "全公司", department: "指定部門", users: "指定人員" };

function AnnouncementsPage() {
  const qc = useQueryClient();
  const { appUser } = useEipUser();
  const canPublish = canManageEip(appUser?.role);
  const [openCreate, setOpenCreate] = useState(false);
  const [selected, setSelected] = useState<Announcement | null>(null);

  const listQ = useQuery({
    queryKey: ["eip", "announcements"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("announcement").select("*")
        .order("is_pinned", { ascending: false })
        .order("published_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Announcement[];
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

  const deptsQ = useQuery({
    queryKey: ["eip", "departments"],
    queryFn: async () => {
      const { data, error } = await supabase.from("department").select("*").order("name");
      if (error) throw error;
      return (data ?? []) as Department[];
    },
  });

  const userMap = useMemo(() => new Map((usersQ.data ?? []).map((u) => [u.id, u])), [usersQ.data]);

  if (listQ.isLoading) return <div className="text-muted-foreground py-8">載入中…</div>;

  return (
    <div>
      <PageHeader title="公告"
        description="發布公司或部門公告，並追蹤已讀狀態。"
        actions={canPublish && appUser ? <Button onClick={() => setOpenCreate(true)}><Plus className="w-4 h-4" />發布公告</Button> : undefined}
      />
      <div className="space-y-2">
        {(listQ.data ?? []).map((a) => (
          <Card key={a.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setSelected(a)}>
            <CardContent className="p-3 flex items-start gap-3">
              <Megaphone className="w-4 h-4 mt-0.5 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  {a.is_pinned && <Pin className="w-3 h-3 text-amber-600" />}
                  <span className="font-medium text-sm truncate">{a.title}</span>
                  {!a.published_at && <Badge variant="outline" className="text-[10px]">草稿</Badge>}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{a.body}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {userMap.get(a.created_by)?.name ?? "—"}
                  {a.published_at && ` ・ ${new Date(a.published_at).toLocaleString("zh-TW")}`}
                </div>
              </div>
              <Badge variant="secondary" className="text-[10px]">{AUDIENCE_LABEL[a.audience_type]}</Badge>
            </CardContent>
          </Card>
        ))}
        {(listQ.data ?? []).length === 0 && (
          <Card><CardContent className="py-10 text-center text-muted-foreground">尚無公告</CardContent></Card>
        )}
      </div>

      {openCreate && appUser && (
        <CreateAnnouncementDialog
          open={openCreate} onClose={() => setOpenCreate(false)} appUser={appUser}
          users={usersQ.data ?? []} departments={deptsQ.data ?? []}
          onCreated={() => qc.invalidateQueries({ queryKey: ["eip", "announcements"] })}
        />
      )}
      {selected && appUser && (
        <AnnouncementDetailDialog
          announcement={selected} appUser={appUser} users={usersQ.data ?? []}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function CreateAnnouncementDialog({
  open, onClose, appUser, users, departments, onCreated,
}: {
  open: boolean; onClose: () => void; appUser: AppUser;
  users: AppUser[]; departments: Department[]; onCreated: () => void;
}) {
  const isDeptMgr = appUser.role === "dept_manager";
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<Audience>(isDeptMgr ? "department" : "all");
  const [pinned, setPinned] = useState(false);
  const [publish, setPublish] = useState(true);
  const [targetDepts, setTargetDepts] = useState<string[]>(isDeptMgr && appUser.department_id ? [appUser.department_id] : []);
  const [targetUsers, setTargetUsers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const toggle = (list: string[], setList: (v: string[]) => void, id: string) =>
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const submit = async () => {
    if (!title.trim() || !body.trim()) return toast.error("請輸入標題與內文");
    if (isDeptMgr && audience === "all") return toast.error("部門主管不可發布全公司公告");
    setBusy(true);
    try {
      const { data: created, error } = await supabase.from("announcement").insert({
        tenant_id: appUser.tenant_id ?? DEFAULT_TENANT_ID,
        title: title.trim(), body: body.trim(),
        audience_type: audience, is_pinned: pinned,
        published_at: publish ? new Date().toISOString() : null,
        created_by: appUser.id,
      }).select("*").single();
      if (error) throw error;
      const aid = (created as Announcement).id;

      if (audience === "department" && targetDepts.length) {
        const { error: tErr } = await supabase.from("announcement_target")
          .insert(targetDepts.map((d) => ({ announcement_id: aid, department_id: d })));
        if (tErr) throw tErr;
      } else if (audience === "users" && targetUsers.length) {
        const { error: tErr } = await supabase.from("announcement_target")
          .insert(targetUsers.map((u) => ({ announcement_id: aid, user_id: u })));
        if (tErr) throw tErr;
      }
      toast.success(publish ? "已發布" : "已存為草稿");
      onCreated(); onClose();
    } catch (e) { toast.error(`失敗：${e instanceof Error ? e.message : String(e)}`); }
    finally { setBusy(false); }
  };

  const visibleDepts = isDeptMgr
    ? departments.filter((d) => d.id === appUser.department_id)
    : departments;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>發布公告</DialogTitle></DialogHeader>
        <div className="grid gap-3 py-2 max-h-[60vh] overflow-y-auto pr-1">
          <Field label="標題"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <Field label="內文"><Textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
          <Field label="對象">
            <Select value={audience} onValueChange={(v) => setAudience(v as Audience)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {!isDeptMgr && <SelectItem value="all">{AUDIENCE_LABEL.all}</SelectItem>}
                <SelectItem value="department">{AUDIENCE_LABEL.department}</SelectItem>
                <SelectItem value="users">{AUDIENCE_LABEL.users}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {audience === "department" && (
            <Field label="部門">
              <div className="flex flex-wrap gap-2 p-2 border rounded-md">
                {visibleDepts.map((d) => (
                  <button key={d.id} type="button" onClick={() => toggle(targetDepts, setTargetDepts, d.id)}
                    className={`text-xs px-2 py-1 rounded-md border ${targetDepts.includes(d.id) ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent"}`}>
                    {d.name}
                  </button>
                ))}
              </div>
            </Field>
          )}
          {audience === "users" && (
            <Field label="人員">
              <div className="flex flex-wrap gap-2 p-2 border rounded-md max-h-32 overflow-y-auto">
                {users.map((u) => (
                  <button key={u.id} type="button" onClick={() => toggle(targetUsers, setTargetUsers, u.id)}
                    className={`text-xs px-2 py-1 rounded-md border ${targetUsers.includes(u.id) ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent"}`}>
                    {u.name}
                  </button>
                ))}
              </div>
            </Field>
          )}
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={pinned} onCheckedChange={(v) => setPinned(!!v)} /> 置頂
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={publish} onCheckedChange={(v) => setPublish(!!v)} /> 立即發布（取消勾選則存為草稿）
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>取消</Button>
          <Button onClick={submit} disabled={busy}>{publish ? "發布" : "存草稿"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AnnouncementDetailDialog({
  announcement, appUser, users, onClose,
}: { announcement: Announcement; appUser: AppUser; users: AppUser[]; onClose: () => void }) {
  const qc = useQueryClient();
  const userMap = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const isOwnerOrAdmin = appUser.role === "company_admin" || appUser.id === announcement.created_by;

  // 標為已讀
  useEffect(() => {
    if (!announcement.published_at) return;
    void supabase.from("announcement_read")
      .upsert({ announcement_id: announcement.id, user_id: appUser.id }, { onConflict: "announcement_id,user_id" });
  }, [announcement.id, announcement.published_at, appUser.id]);

  const readsQ = useQuery({
    enabled: isOwnerOrAdmin,
    queryKey: ["eip", "ann-reads", announcement.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("announcement_read").select("user_id,read_at").eq("announcement_id", announcement.id);
      if (error) throw error;
      return (data ?? []) as { user_id: string; read_at: string }[];
    },
  });

  const targetsQ = useQuery({
    enabled: isOwnerOrAdmin,
    queryKey: ["eip", "ann-targets", announcement.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("announcement_target").select("*").eq("announcement_id", announcement.id);
      if (error) throw error;
      return data ?? [];
    },
  });

  const audienceUserIds = useMemo(() => {
    if (!isOwnerOrAdmin) return [] as string[];
    if (announcement.audience_type === "all") return users.map((u) => u.id);
    const targets = targetsQ.data ?? [];
    if (announcement.audience_type === "users") {
      return targets.map((t: any) => t.user_id).filter(Boolean);
    }
    const deptIds = targets.map((t: any) => t.department_id).filter(Boolean);
    return users.filter((u) => u.department_id && deptIds.includes(u.department_id)).map((u) => u.id);
  }, [isOwnerOrAdmin, announcement.audience_type, targetsQ.data, users]);

  const readIds = new Set((readsQ.data ?? []).map((r) => r.user_id));
  const unread = audienceUserIds.filter((id) => !readIds.has(id));

  const togglePin = async () => {
    const { error } = await supabase.from("announcement")
      .update({ is_pinned: !announcement.is_pinned }).eq("id", announcement.id);
    if (error) toast.error(error.message);
    else { toast.success("已更新"); qc.invalidateQueries({ queryKey: ["eip", "announcements"] }); onClose(); }
  };
  const publish = async () => {
    const { error } = await supabase.from("announcement")
      .update({ published_at: new Date().toISOString() }).eq("id", announcement.id);
    if (error) toast.error(error.message);
    else { toast.success("已發布"); qc.invalidateQueries({ queryKey: ["eip", "announcements"] }); onClose(); }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {announcement.is_pinned && <Pin className="w-4 h-4 text-amber-600" />}
            {announcement.title}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2 max-h-[65vh] overflow-y-auto pr-1">
          <div className="text-xs text-muted-foreground">
            {userMap.get(announcement.created_by)?.name ?? "—"}
            {announcement.published_at
              ? ` ・ 發布於 ${new Date(announcement.published_at).toLocaleString("zh-TW")}`
              : " ・ 草稿"}
            ・ 對象：{AUDIENCE_LABEL[announcement.audience_type]}
          </div>
          <div className="text-sm whitespace-pre-wrap">{announcement.body}</div>

          {isOwnerOrAdmin && announcement.published_at && (
            <div className="rounded-md border p-3 bg-muted/30">
              <div className="text-xs font-semibold text-muted-foreground mb-1">
                已讀 {readIds.size}/{audienceUserIds.length}
              </div>
              {unread.length > 0 && (
                <div className="text-xs">
                  <span className="text-muted-foreground">未讀：</span>
                  {unread.map((id) => userMap.get(id)?.name ?? id.slice(0, 6)).join("、")}
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          {isOwnerOrAdmin && !announcement.published_at && (
            <Button onClick={publish}>立即發布</Button>
          )}
          {isOwnerOrAdmin && (
            <Button variant="outline" onClick={togglePin}>
              {announcement.is_pinned ? "取消置頂" : "置頂"}
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>關閉</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
