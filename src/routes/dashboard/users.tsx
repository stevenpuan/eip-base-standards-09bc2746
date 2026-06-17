import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table, TableHeader, TableRow, TableHead, TableBody, TableCell,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";

export const Route = createFileRoute("/dashboard/users")({ component: UsersPage });

interface RoleRow { id: string; code: string; name: string }
interface DepartmentRow { id: string; name: string }
interface ProfileRow {
  id: string;
  full_name: string | null;
  email: string | null;
  status: string;
  created_at: string;
  user_roles?: { role_id: string; roles: { code: string; name: string } | null }[];
}
interface AppUserRow {
  id: string;
  department_id: string | null;
  line_user_id: string | null;
  status: string | null;
}
interface Invitation {
  id: string;
  code: string;
  email: string | null;
  status: string;
  expires_at: string | null;
  roles?: { name: string } | null;
}

const statusLabel: Record<string, string> = {
  pending: "待審核", active: "已啟用", disabled: "已停用", rejected: "已拒絕",
};
const invStatusLabel: Record<string, string> = { unused: "未使用", used: "已使用", expired: "已過期" };

function genCode() {
  return (
    Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 6)
  ).toUpperCase();
}

function UsersPage() {
  const { can, user } = useAuth();
  const qc = useQueryClient();
  const editable = can("users", "edit");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["users"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*, user_roles(role_id, roles(code,name))")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as ProfileRow[];
    },
  });
  const { data: appUsers = [] } = useQuery({
    queryKey: ["app_users"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_user")
        .select("id, department_id, line_user_id, status");
      if (error) throw error;
      return (data ?? []) as AppUserRow[];
    },
  });
  const { data: roles = [] } = useQuery({
    queryKey: ["roles"],
    queryFn: async () => {
      const { data } = await supabase.from("roles").select("id,name,code").order("created_at");
      return (data ?? []) as RoleRow[];
    },
  });
  const { data: depts = [] } = useQuery({
    queryKey: ["departments"],
    queryFn: async () => {
      const { data } = await supabase.from("department").select("id,name").order("name");
      return (data ?? []) as DepartmentRow[];
    },
  });
  const { data: invitations = [] } = useQuery({
    queryKey: ["invitations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invitations")
        .select("*, roles(name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Invitation[];
    },
  });

  const appUserMap = useMemo(() => {
    const m: Record<string, AppUserRow> = {};
    appUsers.forEach((a) => { m[a.id] = a; });
    return m;
  }, [appUsers]);
  const deptMap = useMemo(() => {
    const m: Record<string, string> = {};
    depts.forEach((d) => { m[d.id] = d.name; });
    return m;
  }, [depts]);

  const setStatus = async (id: string, status: string) => {
    const { error } = await supabase.from("profiles").update({ status }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    // 同步 app_user.status：active → active；其他 → inactive
    const appStatus = status === "active" ? "active" : "inactive";
    await supabase.from("app_user").update({ status: appStatus }).eq("id", id);
    if (status === "active") {
      const { data: existing } = await supabase.from("user_roles").select("role_id").eq("user_id", id);
      if (!existing || existing.length === 0) {
        const { data: role } = await supabase.from("roles").select("id").eq("code", "member").maybeSingle();
        if (role) await supabase.from("user_roles").insert({ user_id: id, role_id: role.id });
      }
    }
    toast.success("已更新");
    qc.invalidateQueries({ queryKey: ["users"] });
    qc.invalidateQueries({ queryKey: ["app_users"] });
  };

  // ---- 編輯抽屜 ----
  const [editing, setEditing] = useState<ProfileRow | null>(null);
  const [editRoleIds, setEditRoleIds] = useState<string[]>([]);
  const [editDept, setEditDept] = useState<string>("none");
  const [editLine, setEditLine] = useState<string>("");

  const openEdit = (row: ProfileRow) => {
    setEditing(row);
    setEditRoleIds((row.user_roles ?? []).map((x) => x.role_id).filter(Boolean) as string[]);
    const a = appUserMap[row.id];
    setEditDept(a?.department_id ?? "none");
    setEditLine(a?.line_user_id ?? "");
  };
  const toggleRole = (id: string) => {
    setEditRoleIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };
  const saveEdit = async () => {
    if (!editing) return;
    const deptManagerRole = roles.find((r) => r.code === "dept_manager");
    if (deptManagerRole && editRoleIds.includes(deptManagerRole.id) && editDept === "none") {
      toast.error("指派「部門主管」時必須同時設定部門");
      return;
    }
    // 重置 user_roles：先刪後插（簡單可靠）
    const del = await supabase.from("user_roles").delete().eq("user_id", editing.id);
    if (del.error) { toast.error(del.error.message); return; }
    if (editRoleIds.length > 0) {
      const ins = await supabase.from("user_roles")
        .insert(editRoleIds.map((rid) => ({ user_id: editing.id, role_id: rid })));
      if (ins.error) { toast.error(ins.error.message); return; }
    }
    // upsert app_user（部門/LINE）
    const existing = appUserMap[editing.id];
    if (existing) {
      const { error } = await supabase.from("app_user").update({
        department_id: editDept === "none" ? null : editDept,
        line_user_id: editLine.trim() || null,
      }).eq("id", editing.id);
      if (error) { toast.error(error.message); return; }
    }
    toast.success("已儲存");
    setEditing(null);
    qc.invalidateQueries({ queryKey: ["users"] });
    qc.invalidateQueries({ queryKey: ["app_users"] });
  };

  const [invRole, setInvRole] = useState("member");
  const [invEmail, setInvEmail] = useState("");
  const [invDays, setInvDays] = useState("7");
  const generate = async () => {
    const roleObj = roles.find((r) => r.code === invRole) ?? roles.find((r) => r.code === "member");
    const days = parseInt(invDays || "7", 10);
    const { error } = await supabase.from("invitations").insert({
      code: genCode(),
      email: invEmail || null,
      role_id: roleObj?.id ?? null,
      invited_by: user?.id ?? null,
      expires_at: new Date(Date.now() + days * 86400000).toISOString(),
    });
    if (error) { toast.error(error.message); return; }
    toast.success("已產生邀請碼");
    setInvEmail("");
    qc.invalidateQueries({ queryKey: ["invitations"] });
  };
  const copy = (code: string) => {
    navigator.clipboard?.writeText(code);
    toast.success("已複製：" + code);
  };

  const pending = rows.filter((r) => r.status === "pending");
  const active = rows.filter((r) => r.status === "active");

  const renderTable = (list: ProfileRow[]) => (
    <Card>
      <CardContent className="p-0 overflow-x-auto">
        <Table className="min-w-[900px] [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
          <TableHeader>
            <TableRow>
              <TableHead>姓名</TableHead>
              <TableHead>信箱</TableHead>
              <TableHead>角色</TableHead>
              <TableHead>部門</TableHead>
              <TableHead>LINE</TableHead>
              <TableHead>狀態</TableHead>
              <TableHead>建立時間</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.length === 0 && (
              <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">沒有資料</TableCell></TableRow>
            )}
            {list.map((r) => {
              const a = appUserMap[r.id];
              const userRoleNames = (r.user_roles ?? []).map((x) => x.roles?.name).filter(Boolean) as string[];
              return (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.full_name ?? "—"}</TableCell>
                  <TableCell>{r.email}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {userRoleNames.length === 0
                        ? <span className="text-muted-foreground text-sm">—</span>
                        : userRoleNames.map((n) => <Badge key={n} variant="secondary">{n}</Badge>)}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {a?.department_id ? deptMap[a.department_id] ?? "—" : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>
                    {a?.line_user_id
                      ? <Badge variant="default">已綁</Badge>
                      : <Badge variant="outline">未綁</Badge>}
                  </TableCell>
                  <TableCell>
                    <Badge variant={r.status === "active" ? "default" : r.status === "pending" ? "secondary" : "outline"}>
                      {statusLabel[r.status] ?? r.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</TableCell>
                  <TableCell className="text-right space-x-2 whitespace-nowrap">
                    {editable && r.status === "pending" && (
                      <>
                        <Button size="sm" onClick={() => setStatus(r.id, "active")}>核准</Button>
                        <Button size="sm" variant="outline" onClick={() => setStatus(r.id, "rejected")}>拒絕</Button>
                      </>
                    )}
                    {editable && r.status === "active" && (
                      <Button size="sm" variant="outline" onClick={() => setStatus(r.id, "disabled")}>停用</Button>
                    )}
                    {editable && (r.status === "disabled" || r.status === "rejected") && (
                      <Button size="sm" variant="outline" onClick={() => setStatus(r.id, "active")}>啟用</Button>
                    )}
                    {editable && (
                      <Button size="sm" variant="secondary" onClick={() => openEdit(r)}>編輯</Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      <PageHeader title="帳號管理" description="統一管理帳號、角色、部門、LINE 綁定與啟用狀態（單一資料來源）" />
      {isLoading ? (
        <p className="text-muted-foreground">載入中…</p>
      ) : (
        <Tabs defaultValue="active">
          <div className="overflow-x-auto">
            <TabsList>
              <TabsTrigger value="pending">待審核 ({pending.length})</TabsTrigger>
              <TabsTrigger value="active">已啟用 ({active.length})</TabsTrigger>
              <TabsTrigger value="all">全部 ({rows.length})</TabsTrigger>
              <TabsTrigger value="invite">邀請碼</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="pending" className="mt-4">{renderTable(pending)}</TabsContent>
          <TabsContent value="active" className="mt-4">{renderTable(active)}</TabsContent>
          <TabsContent value="all" className="mt-4">{renderTable(rows)}</TabsContent>
          <TabsContent value="invite" className="mt-4 space-y-4">
            {editable && (
              <Card>
                <CardContent className="py-4 flex flex-wrap items-end gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">角色</Label>
                    <Select value={invRole} onValueChange={setInvRole}>
                      <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {roles.map((r) => <SelectItem key={r.id} value={r.code}>{r.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">指定信箱（選填）</Label>
                    <Input className="w-56" value={invEmail} onChange={(e) => setInvEmail(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">有效天數</Label>
                    <Input className="w-24" type="number" value={invDays} onChange={(e) => setInvDays(e.target.value)} />
                  </div>
                  <Button onClick={generate}>產生邀請碼</Button>
                </CardContent>
              </Card>
            )}
            <Card>
              <CardContent className="p-0 overflow-x-auto">
                <Table className="min-w-[720px] [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
                  <TableHeader>
                    <TableRow>
                      <TableHead>邀請碼</TableHead>
                      <TableHead>角色</TableHead>
                      <TableHead>信箱</TableHead>
                      <TableHead>狀態</TableHead>
                      <TableHead>到期</TableHead>
                      <TableHead className="text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invitations.length === 0 && (
                      <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">尚無邀請碼</TableCell></TableRow>
                    )}
                    {invitations.map((iv) => (
                      <TableRow key={iv.id}>
                        <TableCell className="font-mono">{iv.code}</TableCell>
                        <TableCell>{iv.roles?.name ?? "—"}</TableCell>
                        <TableCell>{iv.email ?? "—"}</TableCell>
                        <TableCell><Badge variant={iv.status === "unused" ? "secondary" : "outline"}>{invStatusLabel[iv.status] ?? iv.status}</Badge></TableCell>
                        <TableCell className="text-muted-foreground">{iv.expires_at ? new Date(iv.expires_at).toLocaleDateString() : "—"}</TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="outline" onClick={() => copy(iv.code)}>複製</Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            <p className="text-xs text-muted-foreground">
              使用方式：把邀請碼給對方，對方在登入頁「註冊」時填入邀請碼，即自動啟用並取得指定角色。
            </p>
          </TabsContent>
        </Tabs>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>編輯帳號 — {editing?.full_name ?? editing?.email}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-xs">角色（可多選，框架角色 = 唯一權限來源）</Label>
              <div className="grid grid-cols-2 gap-2">
                {roles.map((r) => (
                  <label key={r.id} className="flex items-center gap-2 text-sm border rounded-md px-3 py-2 cursor-pointer hover:bg-muted">
                    <Checkbox checked={editRoleIds.includes(r.id)} onCheckedChange={() => toggleRole(r.id)} />
                    <span>{r.name}</span>
                    <span className="text-muted-foreground text-xs ml-auto">{r.code}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">部門（指派「部門主管」時必填，決定 EIP 部門資料範圍）</Label>
              <Select value={editDept} onValueChange={setEditDept}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">未設定</SelectItem>
                  {depts.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">LINE User ID（之後做綁定流程；目前可顯示／清除）</Label>
              <div className="flex gap-2">
                <Input value={editLine} onChange={(e) => setEditLine(e.target.value)} placeholder="未綁定" />
                {editLine && (
                  <Button type="button" variant="outline" onClick={() => setEditLine("")}>清除</Button>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>取消</Button>
            <Button onClick={saveEdit}>儲存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
