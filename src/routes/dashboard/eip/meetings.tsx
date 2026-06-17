import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, CalendarDays, Download } from "lucide-react";
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
import type { Database } from "@/integrations/supabase/types";

export const Route = createFileRoute("/dashboard/eip/meetings")({ component: MeetingsPage });

type Meeting = Database["public"]["Tables"]["meeting"]["Row"];
type AppUser = Database["public"]["Tables"]["app_user"]["Row"];
type Project = Database["public"]["Tables"]["project"]["Row"];
type ActionItem = Database["public"]["Tables"]["meeting_action_item"]["Row"];
type ActionStatus = Database["public"]["Enums"]["action_item_status"];

const ACTION_LABEL: Record<ActionStatus, string> = { open: "待處理", converted: "已轉任務", done: "已完成" };

function MeetingsPage() {
  const qc = useQueryClient();
  const { appUser } = useEipUser();
  const canCreate = canManageEip(appUser?.role) || appUser?.role === "member";

  const [openCreate, setOpenCreate] = useState(false);
  const [selected, setSelected] = useState<Meeting | null>(null);

  const meetingsQ = useQuery({
    queryKey: ["eip", "meetings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meeting")
        .select("*")
        .order("meeting_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Meeting[];
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

  const userMap = useMemo(() => {
    const m = new Map<string, AppUser>();
    (usersQ.data ?? []).forEach((u) => m.set(u.id, u));
    return m;
  }, [usersQ.data]);

  if (meetingsQ.isLoading) return <div className="text-muted-foreground py-8">載入中…</div>;

  return (
    <div>
      <PageHeader
        title="會議"
        description="建立會議、紀錄議程與會議紀錄，並追蹤行動項目。"
        actions={
          <div className="flex items-center gap-2">
            <ExportMeetingsBtn meetings={meetingsQ.data ?? []} userMap={userMap} />
            {canCreate && appUser && (
              <Button onClick={() => setOpenCreate(true)}>
                <Plus className="w-4 h-4" /> 新增會議
              </Button>
            )}
          </div>
        }
      />

      <div className="space-y-2">
        {(meetingsQ.data ?? []).map((m) => (
          <Card key={m.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setSelected(m)}>
            <CardContent className="p-3 flex items-center gap-3">
              <CalendarDays className="w-4 h-4 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm truncate">{m.title}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {new Date(m.meeting_date).toLocaleString("zh-TW")}
                  {m.location && ` ・ ${m.location}`}
                </div>
              </div>
              <Badge variant="outline" className="text-xs">
                {userMap.get(m.created_by)?.name ?? "—"}
              </Badge>
            </CardContent>
          </Card>
        ))}
        {(meetingsQ.data ?? []).length === 0 && (
          <Card><CardContent className="py-10 text-center text-muted-foreground">尚無會議</CardContent></Card>
        )}
      </div>

      {openCreate && appUser && (
        <CreateMeetingDialog
          open={openCreate}
          onClose={() => setOpenCreate(false)}
          appUser={appUser}
          users={usersQ.data ?? []}
          projects={projectsQ.data ?? []}
          onCreated={() => qc.invalidateQueries({ queryKey: ["eip", "meetings"] })}
        />
      )}
      {selected && (
        <MeetingDetailDialog
          meeting={selected}
          users={usersQ.data ?? []}
          appUser={appUser}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function CreateMeetingDialog({
  open, onClose, appUser, users, projects, onCreated,
}: {
  open: boolean; onClose: () => void; appUser: AppUser;
  users: AppUser[]; projects: Project[]; onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState<string>(() => {
    const d = new Date(); d.setMinutes(0, 0, 0);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });
  const [location, setLocation] = useState("");
  const [agenda, setAgenda] = useState("");
  const [projectId, setProjectId] = useState<string>("none");
  const [attendees, setAttendees] = useState<string[]>([appUser.id]);
  const [busy, setBusy] = useState(false);

  const toggle = (id: string) =>
    setAttendees((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const submit = async () => {
    if (!title.trim()) return toast.error("請輸入會議標題");
    setBusy(true);
    try {
      const { data: created, error } = await supabase
        .from("meeting")
        .insert({
          tenant_id: appUser.tenant_id ?? DEFAULT_TENANT_ID,
          title: title.trim(),
          meeting_date: new Date(date).toISOString(),
          location: location.trim() || null,
          agenda: agenda.trim() || null,
          project_id: projectId === "none" ? null : projectId,
          created_by: appUser.id,
        })
        .select("*").single();
      if (error) throw error;
      const mid = (created as Meeting).id;
      if (attendees.length) {
        const { error: aErr } = await supabase
          .from("meeting_attendee")
          .insert(attendees.map((uid) => ({ meeting_id: mid, user_id: uid })));
        if (aErr) throw aErr;
      }
      toast.success("會議已建立");
      onCreated(); onClose();
    } catch (e) {
      toast.error(`建立失敗：${e instanceof Error ? e.message : String(e)}`);
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>新增會議</DialogTitle></DialogHeader>
        <div className="grid gap-3 py-2 max-h-[60vh] overflow-y-auto pr-1">
          <Field label="標題"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="時間"><Input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="地點"><Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="會議室 / 線上連結" /></Field>
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
          <Field label="議程"><Textarea rows={4} value={agenda} onChange={(e) => setAgenda(e.target.value)} /></Field>
          <Field label="與會者">
            <div className="flex flex-wrap gap-2 p-2 border rounded-md max-h-32 overflow-y-auto">
              {users.map((u) => (
                <button key={u.id} type="button" onClick={() => toggle(u.id)}
                  className={`text-xs px-2 py-1 rounded-md border ${attendees.includes(u.id) ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent"}`}>
                  {u.name}
                </button>
              ))}
            </div>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>取消</Button>
          <Button onClick={submit} disabled={busy}>建立</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MeetingDetailDialog({
  meeting, users, appUser, onClose,
}: { meeting: Meeting; users: AppUser[]; appUser: AppUser | null; onClose: () => void }) {
  const qc = useQueryClient();
  const userMap = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

  const attendeesQ = useQuery({
    queryKey: ["eip", "meeting-attendees", meeting.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meeting_attendee").select("user_id").eq("meeting_id", meeting.id);
      if (error) throw error;
      return (data ?? []).map((x) => x.user_id);
    },
  });

  const itemsQ = useQuery({
    queryKey: ["eip", "meeting-items", meeting.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meeting_action_item").select("*").eq("meeting_id", meeting.id)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as ActionItem[];
    },
  });

  const [notes, setNotes] = useState(meeting.notes ?? "");
  const [newItem, setNewItem] = useState("");
  const [newOwner, setNewOwner] = useState<string>(appUser?.id ?? "none");
  const [newDue, setNewDue] = useState("");

  const saveNotes = async () => {
    const { error } = await supabase.from("meeting").update({ notes }).eq("id", meeting.id);
    if (error) toast.error(`儲存失敗：${error.message}`);
    else { toast.success("會議紀錄已儲存"); qc.invalidateQueries({ queryKey: ["eip", "meetings"] }); }
  };

  const addItem = async () => {
    if (!newItem.trim() || !appUser) return;
    const { error } = await supabase.from("meeting_action_item").insert({
      tenant_id: appUser.tenant_id,
      meeting_id: meeting.id,
      content: newItem.trim(),
      owner_id: newOwner === "none" ? null : newOwner,
      due_date: newDue || null,
      status: "open",
    });
    if (error) toast.error(`新增失敗：${error.message}`);
    else { setNewItem(""); setNewDue(""); qc.invalidateQueries({ queryKey: ["eip", "meeting-items", meeting.id] }); }
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
    qc.invalidateQueries({ queryKey: ["eip", "meeting-items", meeting.id] });
  };

  const toggleDone = async (item: ActionItem) => {
    const next: ActionStatus = item.status === "done" ? "open" : "done";
    const { error } = await supabase.from("meeting_action_item")
      .update({ status: next }).eq("id", item.id);
    if (error) toast.error(error.message);
    else qc.invalidateQueries({ queryKey: ["eip", "meeting-items", meeting.id] });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{meeting.title}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2 max-h-[70vh] overflow-y-auto pr-1">
          <div className="text-sm text-muted-foreground">
            {new Date(meeting.meeting_date).toLocaleString("zh-TW")}
            {meeting.location && ` ・ ${meeting.location}`}
          </div>
          {meeting.agenda && (
            <div>
              <div className="text-xs font-semibold text-muted-foreground mb-1">議程</div>
              <div className="text-sm whitespace-pre-wrap rounded-md bg-muted/40 p-2">{meeting.agenda}</div>
            </div>
          )}
          <div>
            <div className="text-xs font-semibold text-muted-foreground mb-1">與會者</div>
            <div className="flex flex-wrap gap-1.5">
              {(attendeesQ.data ?? []).map((uid) => (
                <Badge key={uid} variant="secondary">{userMap.get(uid)?.name ?? uid.slice(0, 6)}</Badge>
              ))}
              {(attendeesQ.data ?? []).length === 0 && (
                <span className="text-xs text-muted-foreground">無</span>
              )}
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <Label className="text-xs font-semibold text-muted-foreground">會議紀錄</Label>
              <Button size="sm" variant="outline" onClick={saveNotes}>儲存紀錄</Button>
            </div>
            <Textarea rows={5} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div>
            <div className="text-xs font-semibold text-muted-foreground mb-2">行動項目</div>
            <div className="space-y-2">
              {(itemsQ.data ?? []).map((it) => (
                <Card key={it.id}>
                  <CardContent className="p-2.5 flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={it.status === "done"}
                      onChange={() => toggleDone(it)}
                      className="w-4 h-4"
                    />
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm ${it.status === "done" ? "line-through text-muted-foreground" : ""}`}>
                        {it.content}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {it.owner_id ? userMap.get(it.owner_id)?.name ?? "—" : "未指派"}
                        {it.due_date && ` ・ 期限 ${it.due_date}`}
                      </div>
                    </div>
                    <Badge variant="outline" className="text-[10px]">{ACTION_LABEL[it.status]}</Badge>
                    {it.status !== "converted" && (
                      <Button size="sm" variant="ghost" onClick={() => convertToTask(it)}>轉任務</Button>
                    )}
                  </CardContent>
                </Card>
              ))}
              {(itemsQ.data ?? []).length === 0 && (
                <div className="text-xs text-muted-foreground py-2 text-center">尚無行動項目</div>
              )}
            </div>
            <div className="mt-2 flex gap-2">
              <Input placeholder="新增行動項目…" value={newItem} onChange={(e) => setNewItem(e.target.value)} />
              <Select value={newOwner} onValueChange={setNewOwner}>
                <SelectTrigger className="w-[140px]"><SelectValue placeholder="負責人" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">未指派</SelectItem>
                  {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input type="date" className="w-[150px]" value={newDue} onChange={(e) => setNewDue(e.target.value)} />
              <Button onClick={addItem}>新增</Button>
            </div>
          </div>
        </div>
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

function ExportMeetingsBtn({ meetings, userMap }: { meetings: Meeting[]; userMap: Map<string, AppUser> }) {
  const { can } = useAuth();
  if (!can("eip_meetings", "export")) return null;
  return (
    <Button variant="outline" onClick={() => exportToExcel({
      filename: "EIP會議", sheetName: "會議", rows: meetings,
      columns: [
        { header: "標題", key: "title" },
        { header: "會議時間", key: "meeting_date", map: (r) => new Date(r.meeting_date).toLocaleString("zh-TW") },
        { header: "地點", key: "location", map: (r) => r.location ?? "" },
        { header: "建立者", key: "created_by", map: (r) => userMap.get(r.created_by)?.name ?? "" },
        { header: "議程", key: "agenda", map: (r: any) => r.agenda ?? "" },
        { header: "紀錄", key: "minutes", map: (r: any) => r.minutes ?? "" },
        { header: "建立時間", key: "created_at", map: (r: any) => new Date(r.created_at).toLocaleString("zh-TW") },
      ],
    })}>
      <Download className="w-4 h-4" /> 匯出 Excel
    </Button>
  );
}
