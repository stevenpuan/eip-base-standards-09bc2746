import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Pin, Megaphone, Download, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
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
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { Database } from "@/integrations/supabase/types";

export const Route = createFileRoute("/dashboard/eip/announcements")({ component: AnnouncementsPage });

type Announcement = Database["public"]["Tables"]["announcement"]["Row"];
type AppUser = Database["public"]["Tables"]["app_user"]["Row"];
type Department = Database["public"]["Tables"]["department"]["Row"];
type Audience = Database["public"]["Enums"]["announcement_audience"];

const AUDIENCE_LABEL: Record<Audience, string> = { all: "全公司", department: "指定部門", users: "指定人員" };

function canEditAnnouncement(a: Announcement, u: AppUser | null): boolean {
  if (!u) return false;
  if (u.role === "company_admin") return true;
  if (u.role === "dept_manager" && a.created_by === u.id) return true;
  return false;
}
function canDeleteAnnouncement(_a: Announcement, u: AppUser | null): boolean {
  return u?.role === "company_admin";
}

function AnnouncementsPage() {
  const qc = useQueryClient();
  const { appUser } = useEipUser();
  const canPublish = canManageEip(appUser?.role);
  const [openCreate, setOpenCreate] = useState(false);
  const [selected, setSelected] = useState<Announcement | null>(null);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [deleting, setDeleting] = useState<Announcement | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

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

  const refetchList = () => qc.invalidateQueries({ queryKey: ["eip", "announcements"] });

  const doDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    // 先清相關 target / read,避免 FK 阻擋
    await supabase.from("announcement_target").delete().eq("announcement_id", deleting.id);
    await supabase.from("announcement_read").delete().eq("announcement_id", deleting.id);
    const { error } = await supabase.from("announcement").delete().eq("id", deleting.id);
    setDeleteBusy(false);
    if (error) { toast.error(`刪除失敗：${error.message}`); return; }
    toast.success("公告已刪除");
    if (selected?.id === deleting.id) setSelected(null);
    setDeleting(null);
    refetchList();
  };

  if (listQ.isLoading) return <div className="text-muted-foreground py-8">載入中…</div>;

  return (
    <div>
      <PageHeader title="公告"
        description="發布公司或部門公告，並追蹤已讀狀態。"
        actions={
          <div className="flex items-center gap-2">
            <ExportAnnouncementsBtn rows={listQ.data ?? []} userMap={userMap} />
            {canPublish && appUser && (
              <Button onClick={() => setOpenCreate(true)}><Plus className="w-4 h-4" />發布公告</Button>
            )}
          </div>
        }
      />
      <div className="space-y-2">
        {(listQ.data ?? []).map((a) => {
          const canEdit = canEditAnnouncement(a, appUser);
          const canDel = canDeleteAnnouncement(a, appUser);
          return (
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
                {(canEdit || canDel) && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        onClick={(e) => e.stopPropagation()}
                        className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-accent text-muted-foreground"
                        aria-label="更多操作"
                      >
                        <MoreHorizontal className="w-4 h-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                      {canEdit && (
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setEditing(a); }}>
                          <Pencil className="w-3.5 h-3.5 mr-2" /> 編輯
                        </DropdownMenuItem>
                      )}
                      {canDel && (
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={(e) => { e.stopPropagation(); setDeleting(a); }}
                        >
                          <Trash2 className="w-3.5 h-3.5 mr-2" /> 刪除
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </CardContent>
            </Card>
          );
        })}
        {(listQ.data ?? []).length === 0 && (
          <Card>
            <CardContent className="py-12 text-center space-y-3">
              <div className="text-sm text-muted-foreground">
                {canPublish
                  ? "目前沒有公告,點右上「發布公告」建立第一則公告。"
                  : "目前沒有公告。"}
              </div>
              {canPublish && appUser && (
                <Button size="sm" onClick={() => setOpenCreate(true)}>
                  <Plus className="w-4 h-4" /> 發布公告
                </Button>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {openCreate && appUser && (
        <AnnouncementFormDialog
          mode="create"
          open={openCreate} onClose={() => setOpenCreate(false)} appUser={appUser}
          users={usersQ.data ?? []} departments={deptsQ.data ?? []}
          onSaved={refetchList}
        />
      )}
      {editing && appUser && (
        <AnnouncementFormDialog
          mode="edit"
          announcement={editing}
          open={!!editing} onClose={() => setEditing(null)} appUser={appUser}
          users={usersQ.data ?? []} departments={deptsQ.data ?? []}
          onSaved={refetchList}
        />
      )}
      {selected && appUser && (
        <AnnouncementDetailDialog
          announcement={selected} appUser={appUser} users={usersQ.data ?? []}
          onClose={() => setSelected(null)}
          onEdit={() => { setEditing(selected); setSelected(null); }}
          onDelete={() => { setDeleting(selected); }}
        />
      )}

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && !deleteBusy && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>確定刪除公告？</AlertDialogTitle>
            <AlertDialogDescription>
              即將刪除「{deleting?.title}」,相關已讀紀錄與發送對象也會一併移除。刪除後無法復原。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBusy}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteBusy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => { e.preventDefault(); void doDelete(); }}
            >
              {deleteBusy ? "刪除中…" : "確認刪除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function AnnouncementFormDialog({
  mode, announcement, open, onClose, appUser, users, departments, onSaved,
}: {
  mode: "create" | "edit";
  announcement?: Announcement;
  open: boolean; onClose: () => void; appUser: AppUser;
  users: AppUser[]; departments: Department[]; onSaved: () => void;
}) {
  const isDeptMgr = appUser.role === "dept_manager";
  const isEdit = mode === "edit" && !!announcement;

  // 載入既有對象（編輯模式）
  const targetsQ = useQuery({
    enabled: isEdit,
    queryKey: ["eip", "ann-targets", announcement?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("announcement_target").select("*").eq("announcement_id", announcement!.id);
      if (error) throw error;
      return data ?? [];
    },
  });

  const [title, setTitle] = useState(announcement?.title ?? "");
  const [body, setBody] = useState(announcement?.body ?? "");
  const [audience, setAudience] = useState<Audience>(
    announcement?.audience_type ?? (isDeptMgr ? "department" : "all"),
  );
  const [pinned, setPinned] = useState(announcement?.is_pinned ?? false);
  const [publish, setPublish] = useState(
    isEdit ? !!announcement?.published_at : true,
  );
  const [targetDepts, setTargetDepts] = useState<string[]>(
    isDeptMgr && appUser.department_id && !isEdit ? [appUser.department_id] : [],
  );
  const [targetUsers, setTargetUsers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isEdit && targetsQ.data) {
      setTargetDepts(targetsQ.data.map((t: any) => t.department_id).filter(Boolean));
      setTargetUsers(targetsQ.data.map((t: any) => t.user_id).filter(Boolean));
    }
  }, [isEdit, targetsQ.data]);

  const toggle = (list: string[], setList: (v: string[]) => void, id: string) =>
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const submit = async () => {
    if (!title.trim() || !body.trim()) return toast.error("請輸入標題與內文");
    if (isDeptMgr && audience === "all") return toast.error("部門主管不可發布全公司公告");
    setBusy(true);
    try {
      let aid: string;
      if (isEdit) {
        const payload: any = {
          title: title.trim(),
          body: body.trim(),
          audience_type: audience,
          is_pinned: pinned,
        };
        // 發布狀態切換：未發布→發布給予 published_at;發布→撤回則清空
        if (publish && !announcement!.published_at) payload.published_at = new Date().toISOString();
        if (!publish && announcement!.published_at) payload.published_at = null;
        const { error } = await supabase.from("announcement").update(payload).eq("id", announcement!.id);
        if (error) throw error;
        aid = announcement!.id;
        // 重設對象
        await supabase.from("announcement_target").delete().eq("announcement_id", aid);
      } else {
        const { data: created, error } = await supabase.from("announcement").insert({
          tenant_id: appUser.tenant_id ?? DEFAULT_TENANT_ID,
          title: title.trim(), body: body.trim(),
          audience_type: audience, is_pinned: pinned,
          published_at: publish ? new Date().toISOString() : null,
          created_by: appUser.id,
        }).select("*").single();
        if (error) throw error;
        aid = (created as Announcement).id;
      }

      if (audience === "department" && targetDepts.length) {
        const { error: tErr } = await supabase.from("announcement_target")
          .insert(targetDepts.map((d) => ({ announcement_id: aid, department_id: d })));
        if (tErr) throw tErr;
      } else if (audience === "users" && targetUsers.length) {
        const { error: tErr } = await supabase.from("announcement_target")
          .insert(targetUsers.map((u) => ({ announcement_id: aid, user_id: u })));
        if (tErr) throw tErr;
      }
      toast.success(isEdit ? "已儲存" : (publish ? "已發布" : "已存為草稿"));
      onSaved(); onClose();
    } catch (e) { toast.error(`失敗：${e instanceof Error ? e.message : String(e)}`); }
    finally { setBusy(false); }
  };

  const visibleDepts = isDeptMgr
    ? departments.filter((d) => d.id === appUser.department_id)
    : departments;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{isEdit ? "編輯公告" : "發布公告"}</DialogTitle></DialogHeader>
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
              <Checkbox checked={publish} onCheckedChange={(v) => setPublish(!!v)} />
              {isEdit ? "發布狀態（取消勾選則回到草稿）" : "立即發布（取消勾選則存為草稿）"}
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>取消</Button>
          <Button onClick={submit} disabled={busy}>
            {isEdit ? "儲存" : (publish ? "發布" : "存草稿")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AnnouncementDetailDialog({
  announcement, appUser, users, onClose, onEdit, onDelete,
}: {
  announcement: Announcement; appUser: AppUser; users: AppUser[];
  onClose: () => void; onEdit: () => void; onDelete: () => void;
}) {
  const qc = useQueryClient();
  const userMap = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const isOwnerOrAdmin = appUser.role === "company_admin" || appUser.id === announcement.created_by;
  const canEdit = canEditAnnouncement(announcement, appUser);
  const canDel = canDeleteAnnouncement(announcement, appUser);

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
        <DialogFooter className="gap-2 flex-wrap">
          {canDel && (
            <Button variant="destructive" onClick={onDelete}>
              <Trash2 className="w-4 h-4 mr-1" /> 刪除
            </Button>
          )}
          {canEdit && (
            <Button variant="outline" onClick={onEdit}>
              <Pencil className="w-4 h-4 mr-1" /> 編輯
            </Button>
          )}
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

const AUDIENCE_EXPORT: Record<string, string> = { all: "全公司", department: "指定部門", users: "指定人員" };
function ExportAnnouncementsBtn({ rows, userMap }: { rows: Announcement[]; userMap: Map<string, AppUser> }) {
  const { can } = useAuth();
  if (!can("eip_announcements", "export")) return null;
  return (
    <Button variant="outline" onClick={() => exportToExcel({
      filename: "EIP公告", sheetName: "公告", rows,
      columns: [
        { header: "標題", key: "title" },
        { header: "是否置頂", key: "is_pinned", map: (r) => r.is_pinned ? "是" : "否" },
        { header: "發布對象", key: "audience_type", map: (r) => AUDIENCE_EXPORT[r.audience_type] ?? r.audience_type },
        { header: "建立者", key: "created_by", map: (r) => userMap.get(r.created_by)?.name ?? "" },
        { header: "發布時間", key: "published_at", map: (r) => r.published_at ? new Date(r.published_at).toLocaleString("zh-TW") : "草稿" },
        { header: "內容", key: "body" },
        { header: "建立時間", key: "created_at", map: (r) => new Date(r.created_at).toLocaleString("zh-TW") },
      ],
    })}>
      <Download className="w-4 h-4" /> 匯出 Excel
    </Button>
  );
}
