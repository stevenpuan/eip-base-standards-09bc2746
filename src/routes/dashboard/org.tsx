import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown, ChevronRight, Users, Building2, Network,
  Plus, Pencil, Trash2, MoreHorizontal, ArrowRightLeft,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/org")({ component: Page });

interface Dept {
  id: string;
  tenant_id: string;
  name: string;
  parent_id: string | null;
  code: string | null;
  sort_order: number | null;
  manager_id: string | null;
}
interface Member {
  id: string;
  name: string | null;
  email: string | null;
  employee_no: string | null;
  job_title: string | null;
  extension: string | null;
  role: string | null;
  status: string | null;
  department_id: string | null;
  tenant_id: string | null;
}

const ROLE_OPTIONS = [
  { value: "company_admin", label: "系統管理" },
  { value: "dept_manager", label: "部門主管" },
  { value: "member", label: "成員" },
  { value: "viewer", label: "唯讀" },
];
const ROLE_LABEL: Record<string, string> = Object.fromEntries(ROLE_OPTIONS.map((r) => [r.value, r.label]));

function Page() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: me } = useQuery({
    queryKey: ["org_me", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_user").select("id, tenant_id, role").eq("id", user!.id).maybeSingle();
      if (error) throw error;
      return data as { id: string; tenant_id: string; role: string } | null;
    },
  });
  const isAdmin = me?.role === "company_admin";
  const tenantId = me?.tenant_id ?? null;

  const { data: depts = [] } = useQuery({
    queryKey: ["org_depts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("department")
        .select("id, tenant_id, name, parent_id, code, sort_order, manager_id")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Dept[];
    },
  });

  const { data: allUsers = [] } = useQuery({
    queryKey: ["org_all_users", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_user")
        .select("id, name, email, employee_no, job_title, extension, role, status, department_id, tenant_id")
        .eq("tenant_id", tenantId!)
        .order("employee_no", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Member[];
    },
  });

  const managerMap = useMemo(() => {
    const m = new Map<string, { name: string | null; job_title: string | null }>();
    allUsers.forEach((u) => m.set(u.id, { name: u.name, job_title: u.job_title }));
    return m;
  }, [allUsers]);

  const activeCount = useMemo(() => allUsers.filter((u) => u.status === "active").length, [allUsers]);

  const tree = useMemo(() => {
    const byParent = new Map<string | null, Dept[]>();
    depts.forEach((d) => {
      const k = d.parent_id;
      const arr = byParent.get(k) ?? [];
      arr.push(d);
      byParent.set(k, arr);
    });
    for (const arr of byParent.values()) {
      arr.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name));
    }
    return byParent;
  }, [depts]);

  const topDepts = tree.get(null) ?? [];
  const courseCount = depts.filter((d) => d.parent_id).length;
  const deptCount = depts.length;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    if (!selectedId && topDepts.length > 0) setSelectedId(topDepts[0].id);
  }, [selectedId, topDepts]);

  const selected = useMemo(() => depts.find((d) => d.id === selectedId) ?? null, [depts, selectedId]);
  const parentName = selected?.parent_id
    ? depts.find((d) => d.id === selected.parent_id)?.name ?? "—"
    : "—";
  const manager = selected?.manager_id ? managerMap.get(selected.manager_id) : null;

  const members = useMemo(
    () => allUsers
      .filter((u) => u.department_id === selectedId && u.status === "active")
      .sort((a, b) => (a.employee_no ?? "").localeCompare(b.employee_no ?? "")),
    [allUsers, selectedId],
  );

  const refetchDepts = () => qc.invalidateQueries({ queryKey: ["org_depts"] });
  const refetchUsers = () => qc.invalidateQueries({ queryKey: ["org_all_users", tenantId] });

  // Dialog states
  const [deptDialog, setDeptDialog] = useState<{ mode: "create" | "edit"; parentId: string | null; dept: Dept | null } | null>(null);
  const [deleteDeptId, setDeleteDeptId] = useState<string | null>(null);
  const [managerDialogOpen, setManagerDialogOpen] = useState(false);
  const [memberDialog, setMemberDialog] = useState<Member | null>(null);
  const [addMemberOpen, setAddMemberOpen] = useState(false);


  return (
    <div className="space-y-6">
      <PageHeader title="組織架構" description="部門階層與成員清單" />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard icon={<Building2 className="w-4 h-4" />} label="部門總數" value={deptCount} />
        <StatCard icon={<Network className="w-4 h-4" />} label="課總數" value={courseCount} />
        <StatCard icon={<Users className="w-4 h-4" />} label="在職員工數" value={activeCount} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4">
        <Card>
          <CardContent className="py-3">
            <div className="flex items-center justify-between mb-2 px-1">
              <div className="text-sm font-medium text-muted-foreground">部門樹</div>
              {isAdmin && (
                <Button size="sm" variant="ghost" className="h-7"
                  onClick={() => setDeptDialog({ mode: "create", parentId: null, dept: null })}>
                  <Plus className="w-3.5 h-3.5" />新增頂層單位
                </Button>
              )}

            </div>
            <div className="space-y-0.5">
              {topDepts.map((d) => (
                <TreeNode key={d.id} dept={d} tree={tree} level={0}
                  selectedId={selectedId} onSelect={setSelectedId}
                  isAdmin={isAdmin}
                  onAddChild={(pid) => setDeptDialog({ mode: "create", parentId: pid, dept: null })}
                  onEdit={(d) => setDeptDialog({ mode: "edit", parentId: d.parent_id, dept: d })}
                  onDelete={(id) => setDeleteDeptId(id)} />
              ))}
              {topDepts.length === 0 && (
                <div className="text-sm text-muted-foreground px-2 py-4">尚無部門資料</div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="py-4 space-y-4">
            {!selected ? (
              <div className="text-sm text-muted-foreground">請從左側選擇部門</div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-lg font-semibold">{selected.name}</div>
                    <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-4 gap-y-1">
                      <span>代碼:{selected.code ?? "—"}</span>
                      <span>上層:{parentName}</span>
                      <span>排序:{selected.sort_order ?? 0}</span>
                    </div>
                  </div>
                  {isAdmin && (
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline"
                        onClick={() => setDeptDialog({ mode: "edit", parentId: selected.parent_id, dept: selected })}>
                        <Pencil className="w-3.5 h-3.5" />編輯
                      </Button>
                      <Button size="sm" variant="outline"
                        onClick={() => setDeptDialog({ mode: "create", parentId: selected.id, dept: null })}>
                        <Plus className="w-3.5 h-3.5" />子部門
                      </Button>
                    </div>
                  )}
                </div>

                <div className="rounded-md border p-3 bg-muted/30">
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-xs text-muted-foreground">部門主管</div>
                    {isAdmin && (
                      <Button size="sm" variant="ghost" className="h-7" onClick={() => setManagerDialogOpen(true)}>
                        <Pencil className="w-3.5 h-3.5" />指派
                      </Button>
                    )}
                  </div>
                  {manager ? (
                    <div className="text-sm">
                      <span className="font-medium">{manager.name ?? "—"}</span>
                      {manager.job_title && <span className="ml-2 text-muted-foreground">{manager.job_title}</span>}
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">未指派</div>
                  )}
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-sm font-medium">成員清單({members.length})</div>
                    {isAdmin && (
                      <Button size="sm" variant="outline" onClick={() => setAddMemberOpen(true)}>
                        <Plus className="w-3.5 h-3.5" />新增成員
                      </Button>
                    )}

                  </div>
                  <div className="rounded-md border overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>姓名</TableHead>
                          <TableHead>員工編號</TableHead>
                          <TableHead>職稱</TableHead>
                          <TableHead>分機</TableHead>
                          <TableHead>角色</TableHead>
                          {isAdmin && <TableHead className="w-[60px]"></TableHead>}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {members.length === 0 && (
                          <TableRow><TableCell colSpan={isAdmin ? 6 : 5} className="text-center text-muted-foreground py-6">此部門目前沒有在職成員</TableCell></TableRow>
                        )}
                        {members.map((m) => (
                          <TableRow key={m.id}>
                            <TableCell className="font-medium">{m.name ?? "—"}</TableCell>
                            <TableCell className="font-mono text-xs">{m.employee_no ?? "—"}</TableCell>
                            <TableCell>{m.job_title ?? "—"}</TableCell>
                            <TableCell>{m.extension ?? "—"}</TableCell>
                            <TableCell><Badge variant="outline">{ROLE_LABEL[m.role ?? ""] ?? m.role ?? "—"}</Badge></TableCell>
                            {isAdmin && (
                              <TableCell>
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button size="icon" variant="ghost" className="h-7 w-7">
                                      <MoreHorizontal className="w-4 h-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem onClick={() => setMemberDialog(m)}>
                                      <Pencil className="w-3.5 h-3.5 mr-2" />編輯
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onClick={() => setMemberDialog({ ...m })}>
                                      <ArrowRightLeft className="w-3.5 h-3.5 mr-2" />調整所屬部門
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </TableCell>
                            )}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {deptDialog && (
        <DeptFormDialog
          open
          mode={deptDialog.mode}
          parentId={deptDialog.parentId}
          dept={deptDialog.dept}
          tenantId={tenantId}
          allDepts={depts}
          onClose={() => setDeptDialog(null)}
          onSaved={(id) => { refetchDepts(); if (id) setSelectedId(id); setDeptDialog(null); }}
        />
      )}

      <AlertDialog open={!!deleteDeptId} onOpenChange={(v) => { if (!v) setDeleteDeptId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>刪除部門</AlertDialogTitle>
            <AlertDialogDescription>確定要刪除此部門?此動作無法復原。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (!deleteDeptId) return;
                const hasChild = depts.some((d) => d.parent_id === deleteDeptId);
                const hasMember = allUsers.some((u) => u.department_id === deleteDeptId);
                if (hasChild || hasMember) {
                  toast.error("請先搬移或刪除其下的子部門 / 成員");
                  setDeleteDeptId(null);
                  return;
                }
                const { error } = await supabase.from("department").delete().eq("id", deleteDeptId);
                if (error) toast.error("僅管理者可編輯組織");
                else { toast.success("已刪除"); refetchDepts(); if (selectedId === deleteDeptId) setSelectedId(null); }
                setDeleteDeptId(null);
              }}>
              刪除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {selected && (
        <ManagerDialog
          open={managerDialogOpen}
          onClose={() => setManagerDialogOpen(false)}
          dept={selected}
          users={allUsers.filter((u) => u.status === "active")}
          onSaved={() => { refetchDepts(); refetchUsers(); setManagerDialogOpen(false); }}
        />
      )}

      {memberDialog && (
        <MemberFormDialog
          open
          member={memberDialog}
          depts={depts}
          onClose={() => setMemberDialog(null)}
          onSaved={() => { refetchUsers(); setMemberDialog(null); }}
        />
      )}

      {addMemberOpen && (
        <AddMemberDialog
          open
          defaultDeptId={selectedId}
          depts={depts}
          onClose={() => setAddMemberOpen(false)}
          onSaved={() => { refetchUsers(); setAddMemberOpen(false); }}
        />
      )}
    </div>
  );
}


function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <Card>
      <CardContent className="py-4 flex items-center gap-3">
        <div className="w-9 h-9 rounded-md bg-primary/10 text-primary flex items-center justify-center">{icon}</div>
        <div>
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-xl font-semibold">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function TreeNode({
  dept, tree, level, selectedId, onSelect,
  isAdmin, onAddChild, onEdit, onDelete,
}: {
  dept: Dept;
  tree: Map<string | null, Dept[]>;
  level: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  isAdmin: boolean;
  onAddChild: (parentId: string) => void;
  onEdit: (d: Dept) => void;
  onDelete: (id: string) => void;
}) {
  const children = tree.get(dept.id) ?? [];
  const hasChildren = children.length > 0;
  const [open, setOpen] = useState(true);
  const isActive = selectedId === dept.id;
  return (
    <div>
      <div
        className={cn(
          "group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm cursor-pointer hover:bg-accent/50",
          isActive && "bg-accent text-accent-foreground font-medium",
        )}
        style={{ paddingLeft: 8 + level * 14 }}
        onClick={() => onSelect(dept.id)}
      >
        {hasChildren ? (
          <button className="p-0.5 -ml-0.5 rounded hover:bg-accent"
            onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
            aria-label={open ? "收合" : "展開"}>
            {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
        ) : (<span className="w-4" />)}
        <span className="truncate">{dept.name}</span>
        {dept.code && <span className="ml-auto text-[10px] text-muted-foreground font-mono">{dept.code}</span>}
        {isAdmin && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="opacity-0 group-hover:opacity-100 ml-1 p-0.5 rounded hover:bg-accent"
                onClick={(e) => e.stopPropagation()}>
                <MoreHorizontal className="w-3.5 h-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem onClick={() => onAddChild(dept.id)}>
                <Plus className="w-3.5 h-3.5 mr-2" />新增子部門
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onEdit(dept)}>
                <Pencil className="w-3.5 h-3.5 mr-2" />編輯
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive" onClick={() => onDelete(dept.id)}>
                <Trash2 className="w-3.5 h-3.5 mr-2" />刪除
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {hasChildren && open && (
        <div>
          {children.map((c) => (
            <TreeNode key={c.id} dept={c} tree={tree} level={level + 1}
              selectedId={selectedId} onSelect={onSelect}
              isAdmin={isAdmin} onAddChild={onAddChild} onEdit={onEdit} onDelete={onDelete} />
          ))}
        </div>
      )}
    </div>
  );
}

function DeptFormDialog({
  open, mode, parentId, dept, tenantId, allDepts, onClose, onSaved,
}: {
  open: boolean;
  mode: "create" | "edit";
  parentId: string | null;
  dept: Dept | null;
  tenantId: string | null;
  allDepts: Dept[];
  onClose: () => void;
  onSaved: (id?: string) => void;
}) {
  const [name, setName] = useState(dept?.name ?? "");
  const [code, setCode] = useState(dept?.code ?? "");
  const [sortOrder, setSortOrder] = useState<string>(String(dept?.sort_order ?? 0));
  const [parent, setParent] = useState<string>(dept?.parent_id ?? parentId ?? "__root__");
  const [saving, setSaving] = useState(false);

  // descendants for move guard
  const descendants = useMemo(() => {
    if (!dept) return new Set<string>();
    const result = new Set<string>([dept.id]);
    let added = true;
    while (added) {
      added = false;
      for (const d of allDepts) {
        if (d.parent_id && result.has(d.parent_id) && !result.has(d.id)) {
          result.add(d.id); added = true;
        }
      }
    }
    return result;
  }, [allDepts, dept]);

  const submit = async () => {
    if (!name.trim()) { toast.error("部門名稱必填"); return; }
    const so = parseInt(sortOrder, 10);
    if (Number.isNaN(so)) { toast.error("排序需為整數"); return; }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        code: code.trim() || null,
        sort_order: so,
        parent_id: parent === "__root__" ? null : parent,
      };
      if (mode === "create") {
        if (!tenantId) { toast.error("無法取得租戶"); return; }
        const { data, error } = await supabase.rpc("eip_create_department", {
          p_name: payload.name,
          p_parent_id: payload.parent_id,
          p_code: payload.code,
          p_sort_order: payload.sort_order,
        });
        if (error) throw error;
        const newId = (data as any)?.id ?? null;
        toast.success(`已新增單位「${payload.name}」`); onSaved(newId ?? undefined);

      } else if (dept) {
        const { error } = await supabase.from("department").update(payload).eq("id", dept.id);
        if (error) throw error;
        toast.success("已更新"); onSaved(dept.id);
      }
    } catch (e: any) {
      toast.error(e?.message?.includes("policy") ? "僅管理者可編輯組織" : (e?.message ?? "儲存失敗"));
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "新增部門" : "編輯部門"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>名稱 *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例:資訊部" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>代碼</Label>
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="例:IT" />
            </div>
            <div>
              <Label>排序</Label>
              <Input type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>上層部門</Label>
            <Select value={parent} onValueChange={setParent}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__root__">(頂層)</SelectItem>
                {allDepts.filter((d) => !descendants.has(d.id)).map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "儲存中…" : "儲存"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ManagerDialog({
  open, onClose, dept, users, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  dept: Dept;
  users: Member[];
  onSaved: () => void;
}) {
  const [uid, setUid] = useState<string>(dept.manager_id ?? "__none__");
  const [pendingPromote, setPendingPromote] = useState<string | null>(null);

  useEffect(() => { setUid(dept.manager_id ?? "__none__"); }, [dept.id, dept.manager_id]);

  const save = async () => {
    const newId = uid === "__none__" ? null : uid;
    const { error } = await supabase.from("department").update({ manager_id: newId }).eq("id", dept.id);
    if (error) { toast.error("僅管理者可編輯組織"); return; }
    toast.success("已更新部門主管");
    // Ask to promote
    if (newId) {
      const u = users.find((x) => x.id === newId);
      if (u && u.role !== "dept_manager" && u.role !== "company_admin") {
        setPendingPromote(newId);
        return;
      }
    }
    onSaved();
  };

  const promote = async (yes: boolean) => {
    if (yes && pendingPromote) {
      const { error } = await supabase.from("app_user").update({ role: "dept_manager" }).eq("id", pendingPromote);
      if (error) toast.error("無法更新角色"); else toast.success("已將該員角色設為部門主管");
    }
    setPendingPromote(null);
    onSaved();
  };

  return (
    <>
      <Dialog open={open && !pendingPromote} onOpenChange={(v) => { if (!v) onClose(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>指派部門主管</DialogTitle>
            <DialogDescription>選擇 {dept.name} 的主管</DialogDescription>
          </DialogHeader>
          <Select value={uid} onValueChange={setUid}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">(未指派)</SelectItem>
              {users.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.name ?? u.email ?? u.id}{u.job_title ? ` · ${u.job_title}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>取消</Button>
            <Button onClick={save}>儲存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!pendingPromote} onOpenChange={(v) => { if (!v) promote(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>同步調整角色?</AlertDialogTitle>
            <AlertDialogDescription>
              是否同時將該員 EIP 角色設為「部門主管 (dept_manager)」?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => promote(false)}>不要</AlertDialogCancel>
            <AlertDialogAction onClick={() => promote(true)}>好,更新角色</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function MemberFormDialog({
  open, member, depts, onClose, onSaved,
}: {
  open: boolean;
  member: Member;
  depts: Dept[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(member.name ?? "");
  const [empNo, setEmpNo] = useState(member.employee_no ?? "");
  const [jobTitle, setJobTitle] = useState(member.job_title ?? "");
  const [ext, setExt] = useState(member.extension ?? "");
  const [deptId, setDeptId] = useState(member.department_id ?? "__none__");
  const [role, setRole] = useState(member.role ?? "member");
  const [status, setStatus] = useState(member.status ?? "active");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!name.trim()) { toast.error("姓名必填"); return; }
    setSaving(true);
    try {
      // Front-end employee_no uniqueness check
      if (empNo.trim()) {
        const { data: dup } = await supabase.from("app_user")
          .select("id").eq("tenant_id", member.tenant_id!).eq("employee_no", empNo.trim()).neq("id", member.id);
        if (dup && dup.length > 0) { toast.error("員工編號已被使用"); setSaving(false); return; }
      }
      const { error } = await supabase.from("app_user").update({
        name: name.trim(),
        employee_no: empNo.trim() || null,
        job_title: jobTitle.trim() || null,
        extension: ext.trim() || null,
        department_id: deptId === "__none__" ? null : deptId,
        role,
        status,
      }).eq("id", member.id);
      if (error) throw error;
      toast.success("已更新成員資料");
      onSaved();
    } catch (e: any) {
      toast.error(e?.message?.includes("policy") ? "僅管理者可編輯組織" : (e?.message ?? "儲存失敗"));
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>編輯成員</DialogTitle>
          <DialogDescription>{member.email}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>姓名 *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label>員工編號</Label>
              <Input value={empNo} onChange={(e) => setEmpNo(e.target.value)} />
            </div>
            <div>
              <Label>職稱</Label>
              <Input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
            </div>
            <div>
              <Label>分機</Label>
              <Input value={ext} onChange={(e) => setExt(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>所屬部門</Label>
            <Select value={deptId} onValueChange={setDeptId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">(未指派)</SelectItem>
                {depts.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>EIP 角色</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>狀態</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">啟用</SelectItem>
                  <SelectItem value="inactive">停用</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "儲存中…" : "儲存"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
