import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Save, Trash2, Plus, ChevronUp, ChevronDown, X, ExternalLink, MapPin } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useEipUser } from "@/lib/eip-user";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { Database } from "@/integrations/supabase/types";
import { STATUS_LABEL, TYPE_LABEL, statusBadgeClass } from "./meetings.index";
import { VisibilityScopeFields, VisibilityBadge, validateVisibility, type VisibilityScope } from "@/components/eip/VisibilityScope";

type Department = { id: string; name: string; parent_id: string | null; sort_order: number | null };

export const Route = createFileRoute("/dashboard/eip/meetings/$id")({
  component: MeetingDetailPage,
});

type Meeting = Database["public"]["Tables"]["meeting"]["Row"];
type AppUser = Database["public"]["Tables"]["app_user"]["Row"];
type Project = Database["public"]["Tables"]["project"]["Row"];
type Attendee = Database["public"]["Tables"]["meeting_attendee"]["Row"];
type AgendaItem = Database["public"]["Tables"]["meeting_agenda_item"]["Row"];
type ActionItem = Database["public"]["Tables"]["meeting_action_item"]["Row"];
type MeetingStatus = Database["public"]["Enums"]["meeting_status"];
type MeetingType = Database["public"]["Enums"]["meeting_type"];
type AttendStatus = Database["public"]["Enums"]["attendee_status"];
type ActionStatus = Database["public"]["Enums"]["action_item_status"];

const ATTEND_LABEL: Record<AttendStatus, string> = {
  invited: "邀請中", present: "出席", absent: "未到", leave: "請假",
};
const ATTEND_COLOR: Record<AttendStatus, string> = {
  invited: "bg-slate-100 text-slate-700",
  present: "bg-emerald-100 text-emerald-700",
  absent: "bg-red-100 text-red-700",
  leave: "bg-amber-100 text-amber-700",
};
const ACTION_LABEL: Record<ActionStatus, string> = {
  open: "待處理", converted: "已轉任務", done: "已完成",
};

function canManage(m: Meeting | null, u: AppUser | null): boolean {
  if (!m || !u) return false;
  if (u.role === "company_admin" || u.role === "dept_manager") return true;
  return m.created_by === u.id;
}

function toLocalDt(iso: string) {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function MeetingDetailPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { appUser } = useEipUser();

  const meetingQ = useQuery({
    queryKey: ["eip", "meeting", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("meeting").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return data as Meeting | null;
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

  const projectsQ = useQuery({
    queryKey: ["eip", "projects"],
    queryFn: async () => {
      const { data, error } = await supabase.from("project").select("*").order("name");
      if (error) throw error;
      return (data ?? []) as Project[];
    },
  });

  const deptsQ = useQuery({
    queryKey: ["eip", "departments-tree"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("department").select("id,name,parent_id,sort_order")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Department[];
    },
  });

  const userMap = useMemo(
    () => new Map((usersQ.data ?? []).map((u) => [u.id, u])),
    [usersQ.data],
  );
  const deptMap = useMemo(
    () => new Map((deptsQ.data ?? []).map((d) => [d.id, { name: d.name }])),
    [deptsQ.data],
  );

  if (meetingQ.isLoading) return <div className="text-muted-foreground py-8">載入中…</div>;
  if (!meetingQ.data) {
    return (
      <div className="py-8">
        <div className="text-muted-foreground mb-3">找不到此會議</div>
        <Button variant="outline" onClick={() => navigate({ to: "/dashboard/eip/meetings" })}>
          <ArrowLeft className="w-4 h-4 mr-1" /> 返回會議列表
        </Button>
      </div>
    );
  }

  const meeting = meetingQ.data;
  const canEdit = canManage(meeting, appUser);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/dashboard/eip/meetings" })}>
          <ArrowLeft className="w-4 h-4 mr-1" /> 返回列表
        </Button>
      </div>
      <PageHeader title={meeting.title} description="會議詳情" />

      <HeaderSection
        meeting={meeting}
        canEdit={canEdit}
        projects={projectsQ.data ?? []}
        departments={deptsQ.data ?? []}
        deptMap={deptMap}
        onUpdated={() => {
          qc.invalidateQueries({ queryKey: ["eip", "meeting", id] });
          qc.invalidateQueries({ queryKey: ["eip", "meetings"] });
        }}
      />

      <AttendeesSection
        meetingId={meeting.id}
        users={usersQ.data ?? []}
        userMap={userMap}
        canEdit={canEdit}
      />

      <AgendaSection
        meetingId={meeting.id}
        tenantId={meeting.tenant_id}
        users={usersQ.data ?? []}
        userMap={userMap}
        canEdit={canEdit}
      />

      <ActionItemsSection
        meeting={meeting}
        appUser={appUser}
        users={usersQ.data ?? []}
        userMap={userMap}
        canEdit={canEdit}
      />

      <NotesSection meeting={meeting} canEdit={canEdit} onSaved={() => qc.invalidateQueries({ queryKey: ["eip", "meeting", id] })} />
    </div>
  );
}

function HeaderSection({
  meeting, canEdit, projects, onUpdated,
}: {
  meeting: Meeting; canEdit: boolean; projects: Project[]; onUpdated: () => void;
}) {
  const [title, setTitle] = useState(meeting.title);
  const [dateStr, setDateStr] = useState(toLocalDt(meeting.meeting_date));
  const [location, setLocation] = useState(meeting.location ?? "");
  const [type, setType] = useState<MeetingType>(meeting.meeting_type);
  const [status, setStatus] = useState<MeetingStatus>(meeting.status);
  const [projectId, setProjectId] = useState<string>(meeting.project_id ?? "none");
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    setTitle(meeting.title);
    setDateStr(toLocalDt(meeting.meeting_date));
    setLocation(meeting.location ?? "");
    setType(meeting.meeting_type);
    setStatus(meeting.status);
    setProjectId(meeting.project_id ?? "none");
  }, [meeting]);

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.from("meeting").update({
      title: title.trim(),
      meeting_date: new Date(dateStr).toISOString(),
      location: location.trim() || null,
      meeting_type: type,
      status,
      project_id: projectId === "none" ? null : projectId,
    }).eq("id", meeting.id);
    setSaving(false);
    if (error) toast.error(`儲存失敗：${error.message}`);
    else { toast.success("已儲存"); onUpdated(); }
  };

  const quickStatus = async (s: MeetingStatus) => {
    setStatus(s);
    const { error } = await supabase.from("meeting").update({ status: s }).eq("id", meeting.id);
    if (error) toast.error(error.message); else { toast.success("狀態已更新"); onUpdated(); }
  };

  const project = projects.find((p) => p.id === meeting.project_id);

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className={statusBadgeClass(meeting.status)}>
            {STATUS_LABEL[meeting.status]}
          </Badge>
          <Badge variant="secondary">{TYPE_LABEL[meeting.meeting_type]}</Badge>
          {project && (
            <Link
              to="/dashboard/eip/projects/$id"
              params={{ id: project.id }}
              className="text-xs text-primary hover:underline inline-flex items-center gap-1"
            >
              <ExternalLink className="w-3 h-3" /> {project.name}
            </Link>
          )}
          {canEdit && (
            <Select value={status} onValueChange={(v) => quickStatus(v as MeetingStatus)}>
              <SelectTrigger className="h-7 w-[120px] text-xs ml-auto"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(STATUS_LABEL).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {canEdit ? (
          <div className="grid gap-3">
            <Field label="標題"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="時間">
                <Input type="datetime-local" value={dateStr} onChange={(e) => setDateStr(e.target.value)} />
              </Field>
              <Field label="地點">
                <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="會議室 / 線上連結" />
              </Field>
              <Field label="會議類型">
                <Select value={type} onValueChange={(v) => setType(v as MeetingType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(TYPE_LABEL).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="所屬專案">
                <Select value={projectId} onValueChange={setProjectId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">無</SelectItem>
                    {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <div className="flex gap-2 pt-1">
              <Button onClick={save} disabled={saving}>
                <Save className="w-4 h-4 mr-1" /> {saving ? "儲存中…" : "儲存"}
              </Button>
              <Button variant="destructive" onClick={() => setDeleteOpen(true)} disabled={saving}>
                <Trash2 className="w-4 h-4 mr-1" /> 刪除會議
              </Button>
            </div>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground space-y-1">
            <div>{new Date(meeting.meeting_date).toLocaleString("zh-TW")}</div>
            {meeting.location && (
              <div className="inline-flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5" />{meeting.location}
              </div>
            )}
          </div>
        )}

        <AlertDialog open={deleteOpen} onOpenChange={(o) => !o && !deleting && setDeleteOpen(false)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>確定刪除會議？</AlertDialogTitle>
              <AlertDialogDescription>刪除「{meeting.title}」後無法復原。</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
              <AlertDialogAction
                disabled={deleting}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={async (e) => {
                  e.preventDefault();
                  setDeleting(true);
                  const { error } = await supabase.from("meeting").delete().eq("id", meeting.id);
                  setDeleting(false);
                  if (error) toast.error(error.message);
                  else {
                    toast.success("會議已刪除");
                    navigate({ to: "/dashboard/eip/meetings" });
                  }
                }}
              >
                {deleting ? "刪除中…" : "確認刪除"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}

function AttendeesSection({
  meetingId, users, userMap, canEdit,
}: {
  meetingId: string; users: AppUser[]; userMap: Map<string, AppUser>; canEdit: boolean;
}) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["eip", "meeting-attendees-full", meetingId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meeting_attendee").select("*").eq("meeting_id", meetingId);
      if (error) throw error;
      return (data ?? []) as Attendee[];
    },
  });

  const list = q.data ?? [];
  const stats = useMemo(() => {
    const s = { present: 0, leave: 0, absent: 0, invited: 0 };
    list.forEach((a) => { s[a.attend_status] += 1; });
    return s;
  }, [list]);

  const addUser = async (uid: string) => {
    const { error } = await supabase.from("meeting_attendee").insert({
      meeting_id: meetingId, user_id: uid,
    });
    if (error) toast.error(error.message);
    else qc.invalidateQueries({ queryKey: ["eip", "meeting-attendees-full", meetingId] });
  };
  const removeUser = async (uid: string) => {
    const { error } = await supabase.from("meeting_attendee").delete()
      .eq("meeting_id", meetingId).eq("user_id", uid);
    if (error) toast.error(error.message);
    else qc.invalidateQueries({ queryKey: ["eip", "meeting-attendees-full", meetingId] });
  };
  const updateAttendee = async (uid: string, patch: Partial<Attendee>) => {
    const { error } = await supabase.from("meeting_attendee").update(patch)
      .eq("meeting_id", meetingId).eq("user_id", uid);
    if (error) toast.error(error.message);
    else qc.invalidateQueries({ queryKey: ["eip", "meeting-attendees-full", meetingId] });
  };

  const presentIds = new Set(list.map((a) => a.user_id));
  const availableUsers = users.filter((u) => !presentIds.has(u.id));

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="text-sm font-semibold">出席者</div>
          <div className="text-xs text-muted-foreground flex items-center gap-3">
            <span>共 {list.length}</span>
            <span className="text-emerald-700">{stats.present} 出席</span>
            <span className="text-amber-700">{stats.leave} 請假</span>
            <span className="text-red-700">{stats.absent} 未到</span>
            <span className="text-slate-600">{stats.invited} 邀請中</span>
          </div>
        </div>
        {list.length === 0 && <div className="text-xs text-muted-foreground">尚未新增出席者</div>}
        <div className="space-y-1.5">
          {list.map((a) => (
            <div key={a.user_id} className="flex items-center gap-2 p-2 border rounded-md text-sm">
              <div className="flex-1 min-w-0 truncate">
                {userMap.get(a.user_id)?.name ?? a.user_id.slice(0, 6)}
              </div>
              {canEdit ? (
                <label className="text-xs flex items-center gap-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={a.is_required}
                    onChange={(e) => updateAttendee(a.user_id, { is_required: e.target.checked })}
                  />
                  必到
                </label>
              ) : (
                a.is_required && <Badge variant="outline" className="text-[10px]">必到</Badge>
              )}
              {canEdit ? (
                <Select
                  value={a.attend_status}
                  onValueChange={(v) => updateAttendee(a.user_id, { attend_status: v as AttendStatus })}
                >
                  <SelectTrigger className="h-7 w-[110px] text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(ATTEND_LABEL).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Badge className={`text-[10px] ${ATTEND_COLOR[a.attend_status]}`} variant="outline">
                  {ATTEND_LABEL[a.attend_status]}
                </Badge>
              )}
              {canEdit && (
                <Button size="sm" variant="ghost" onClick={() => removeUser(a.user_id)}>
                  <X className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
          ))}
        </div>
        {canEdit && availableUsers.length > 0 && (
          <div className="flex items-center gap-2">
            <Select onValueChange={addUser} value="">
              <SelectTrigger className="w-[200px] h-8 text-xs">
                <SelectValue placeholder="＋ 新增出席者…" />
              </SelectTrigger>
              <SelectContent>
                {availableUsers.map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AgendaSection({
  meetingId, tenantId, users, userMap, canEdit,
}: {
  meetingId: string; tenantId: string; users: AppUser[];
  userMap: Map<string, AppUser>; canEdit: boolean;
}) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["eip", "agenda-items", meetingId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meeting_agenda_item").select("*").eq("meeting_id", meetingId).order("sort_order");
      if (error) throw error;
      return (data ?? []) as AgendaItem[];
    },
  });
  const items = q.data ?? [];
  const totalMin = items.reduce((s, it) => s + (it.duration_min ?? 0), 0);

  const [editing, setEditing] = useState<AgendaItem | null>(null);
  const [title, setTitle] = useState("");
  const [mins, setMins] = useState("10");
  const [owner, setOwner] = useState("none");
  const [notes, setNotes] = useState("");

  const startEdit = (it: AgendaItem) => {
    setEditing(it);
    setTitle(it.title);
    setMins(String(it.duration_min ?? ""));
    setOwner(it.owner_id ?? "none");
    setNotes(it.notes ?? "");
  };
  const reset = () => { setEditing(null); setTitle(""); setMins("10"); setOwner("none"); setNotes(""); };
  const refresh = () => qc.invalidateQueries({ queryKey: ["eip", "agenda-items", meetingId] });

  const save = async () => {
    if (!title.trim()) return toast.error("請輸入議題標題");
    if (editing) {
      const { error } = await supabase.from("meeting_agenda_item").update({
        title: title.trim(),
        duration_min: Number(mins) || null,
        owner_id: owner === "none" ? null : owner,
        notes: notes.trim() || null,
      }).eq("id", editing.id);
      if (error) return toast.error(error.message);
    } else {
      const nextOrder = items.length ? Math.max(...items.map((i) => i.sort_order ?? 0)) + 1 : 1;
      const { error } = await supabase.from("meeting_agenda_item").insert({
        tenant_id: tenantId, meeting_id: meetingId,
        title: title.trim(),
        duration_min: Number(mins) || null,
        owner_id: owner === "none" ? null : owner,
        notes: notes.trim() || null,
        sort_order: nextOrder,
      });
      if (error) return toast.error(error.message);
    }
    reset(); refresh();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("meeting_agenda_item").delete().eq("id", id);
    if (error) toast.error(error.message); else refresh();
  };

  const move = async (it: AgendaItem, dir: -1 | 1) => {
    const sorted = [...items].sort((a, b) => a.sort_order - b.sort_order);
    const idx = sorted.findIndex((x) => x.id === it.id);
    const swap = sorted[idx + dir];
    if (!swap) return;
    await supabase.from("meeting_agenda_item").update({ sort_order: swap.sort_order }).eq("id", it.id);
    await supabase.from("meeting_agenda_item").update({ sort_order: it.sort_order }).eq("id", swap.id);
    refresh();
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">議程</div>
          <div className="text-xs text-muted-foreground">總時長 {totalMin} 分鐘 ・ 共 {items.length} 項</div>
        </div>
        <div className="space-y-1.5">
          {items.map((it, i) => (
            <div key={it.id} className="flex items-start gap-2 p-2 border rounded-md text-sm">
              <span className="text-xs text-muted-foreground w-5 pt-0.5">{i + 1}.</span>
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{it.title}</div>
                <div className="text-xs text-muted-foreground">
                  {it.duration_min ? `${it.duration_min} 分` : "—"}
                  {it.owner_id && ` ・ ${userMap.get(it.owner_id)?.name ?? ""}`}
                </div>
                {it.notes && (
                  <div className="text-xs mt-1 whitespace-pre-wrap text-foreground/80 bg-muted/40 rounded p-1.5">
                    {it.notes}
                  </div>
                )}
              </div>
              {canEdit && (
                <>
                  <Button size="sm" variant="ghost" onClick={() => move(it, -1)} disabled={i === 0}>
                    <ChevronUp className="w-3.5 h-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => move(it, 1)} disabled={i === items.length - 1}>
                    <ChevronDown className="w-3.5 h-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => startEdit(it)}>編輯</Button>
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => remove(it.id)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </>
              )}
            </div>
          ))}
          {items.length === 0 && <div className="text-xs text-muted-foreground py-1">尚無議程項目</div>}
        </div>
        {canEdit && (
          <div className="space-y-2 border-t pt-3">
            <div className="text-xs font-semibold text-muted-foreground">
              {editing ? "編輯議題" : "新增議題"}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
              <Input
                className="sm:col-span-6" placeholder="議題標題…"
                value={title} onChange={(e) => setTitle(e.target.value)}
              />
              <Input
                className="sm:col-span-2" type="number" placeholder="分鐘"
                value={mins} onChange={(e) => setMins(e.target.value)}
              />
              <Select value={owner} onValueChange={setOwner}>
                <SelectTrigger className="sm:col-span-4"><SelectValue placeholder="報告人" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">未指派</SelectItem>
                  {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Textarea
              rows={2} placeholder="討論紀錄 / 備註…"
              value={notes} onChange={(e) => setNotes(e.target.value)}
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={save}>
                {editing ? <><Save className="w-3.5 h-3.5 mr-1" />更新</> : <><Plus className="w-3.5 h-3.5 mr-1" />新增</>}
              </Button>
              {editing && <Button size="sm" variant="ghost" onClick={reset}>取消編輯</Button>}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ActionItemsSection({
  meeting, appUser, users, userMap, canEdit,
}: {
  meeting: Meeting; appUser: AppUser | null; users: AppUser[];
  userMap: Map<string, AppUser>; canEdit: boolean;
}) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["eip", "meeting-items", meeting.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meeting_action_item").select("*").eq("meeting_id", meeting.id).order("created_at");
      if (error) throw error;
      return (data ?? []) as ActionItem[];
    },
  });
  const items = q.data ?? [];

  const [editing, setEditing] = useState<ActionItem | null>(null);
  const [content, setContent] = useState("");
  const [owner, setOwner] = useState<string>(appUser?.id ?? "none");
  const [due, setDue] = useState("");

  const refresh = () => qc.invalidateQueries({ queryKey: ["eip", "meeting-items", meeting.id] });
  const reset = () => { setEditing(null); setContent(""); setOwner(appUser?.id ?? "none"); setDue(""); };

  const startEdit = (it: ActionItem) => {
    setEditing(it);
    setContent(it.content);
    setOwner(it.owner_id ?? "none");
    setDue(it.due_date ?? "");
  };

  const save = async () => {
    if (!content.trim() || !appUser) return;
    if (editing) {
      const { error } = await supabase.from("meeting_action_item").update({
        content: content.trim(),
        owner_id: owner === "none" ? null : owner,
        due_date: due || null,
      }).eq("id", editing.id);
      if (error) return toast.error(error.message);
    } else {
      const { error } = await supabase.from("meeting_action_item").insert({
        tenant_id: meeting.tenant_id,
        meeting_id: meeting.id,
        content: content.trim(),
        owner_id: owner === "none" ? null : owner,
        due_date: due || null,
        status: "open",
      });
      if (error) return toast.error(error.message);
    }
    reset(); refresh();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("meeting_action_item").delete().eq("id", id);
    if (error) toast.error(error.message); else refresh();
  };

  const setStatus = async (id: string, status: ActionStatus) => {
    const { error } = await supabase.from("meeting_action_item").update({ status }).eq("id", id);
    if (error) toast.error(error.message); else refresh();
  };

  const convertToTask = async (item: ActionItem) => {
    if (!appUser) return;
    const { data: defStatus } = await supabase
      .from("task_status").select("id").eq("is_default", true).maybeSingle();
    const statusId = defStatus?.id;
    if (!statusId) return toast.error("找不到預設任務狀態");
    const { data: task, error } = await supabase.from("task").insert({
      tenant_id: appUser.tenant_id,
      title: item.content,
      owner_id: item.owner_id ?? appUser.id,
      status_id: statusId,
      priority: "normal",
      progress: 0,
      due_date: item.due_date,
      created_by: appUser.id,
    }).select("id").single();
    if (error || !task) return toast.error(`轉任務失敗：${error?.message ?? ""}`);
    await supabase.from("meeting_action_item")
      .update({ status: "converted", linked_task_id: task.id }).eq("id", item.id);
    toast.success("已轉為任務");
    refresh();
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">行動項目 / 決議</div>
          <span className="text-xs text-muted-foreground">共 {items.length} 項</span>
        </div>
        <div className="space-y-2">
          {items.map((it) => (
            <div key={it.id} className="flex items-center gap-2 p-2 border rounded-md text-sm flex-wrap sm:flex-nowrap">
              <div className="flex-1 min-w-0">
                <div className={it.status === "done" ? "line-through text-muted-foreground" : ""}>
                  {it.content}
                </div>
                <div className="text-xs text-muted-foreground">
                  {it.owner_id ? userMap.get(it.owner_id)?.name ?? "—" : "未指派"}
                  {it.due_date && ` ・ 期限 ${it.due_date}`}
                </div>
              </div>
              <Badge variant="outline" className="text-[10px]">{ACTION_LABEL[it.status]}</Badge>
              {it.linked_task_id ? (
                <Link to="/dashboard/eip/tasks" className="text-xs text-primary hover:underline">
                  已連結任務
                </Link>
              ) : canEdit ? (
                <Button size="sm" variant="ghost" onClick={() => convertToTask(it)}>轉任務</Button>
              ) : null}
              {canEdit && (
                <>
                  <Select value={it.status} onValueChange={(v) => setStatus(it.id, v as ActionStatus)}>
                    <SelectTrigger className="h-7 w-[110px] text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="open">待處理</SelectItem>
                      <SelectItem value="converted">已轉任務</SelectItem>
                      <SelectItem value="done">已完成</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button size="sm" variant="ghost" onClick={() => startEdit(it)}>編輯</Button>
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => remove(it.id)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </>
              )}
            </div>
          ))}
          {items.length === 0 && <div className="text-xs text-muted-foreground py-1">尚無行動項目</div>}
        </div>
        {canEdit && (
          <div className="space-y-2 border-t pt-3">
            <div className="text-xs font-semibold text-muted-foreground">
              {editing ? "編輯項目" : "新增項目"}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
              <Input
                className="sm:col-span-6" placeholder="內容…"
                value={content} onChange={(e) => setContent(e.target.value)}
              />
              <Select value={owner} onValueChange={setOwner}>
                <SelectTrigger className="sm:col-span-3"><SelectValue placeholder="負責人" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">未指派</SelectItem>
                  {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input
                className="sm:col-span-3" type="date"
                value={due} onChange={(e) => setDue(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={save}>
                {editing ? <><Save className="w-3.5 h-3.5 mr-1" />更新</> : <><Plus className="w-3.5 h-3.5 mr-1" />新增</>}
              </Button>
              {editing && <Button size="sm" variant="ghost" onClick={reset}>取消編輯</Button>}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function NotesSection({
  meeting, canEdit, onSaved,
}: { meeting: Meeting; canEdit: boolean; onSaved: () => void }) {
  const [notes, setNotes] = useState(meeting.notes ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => { setNotes(meeting.notes ?? ""); }, [meeting.notes]);

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.from("meeting").update({ notes }).eq("id", meeting.id);
    setSaving(false);
    if (error) toast.error(error.message);
    else { toast.success("會議紀錄已儲存"); onSaved(); }
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <div className="text-sm font-semibold">會議紀錄</div>
        {canEdit ? (
          <>
            <Textarea rows={6} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="請輸入會議紀錄…" />
            <div>
              <Button size="sm" onClick={save} disabled={saving}>
                <Save className="w-3.5 h-3.5 mr-1" /> {saving ? "儲存中…" : "儲存紀錄"}
              </Button>
            </div>
          </>
        ) : (
          <div className="text-sm whitespace-pre-wrap rounded-md bg-muted/40 p-2 min-h-[60px]">
            {meeting.notes || <span className="text-muted-foreground">(尚無紀錄)</span>}
          </div>
        )}
      </CardContent>
    </Card>
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
