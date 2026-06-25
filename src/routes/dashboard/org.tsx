import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Users, Building2, Network } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/org")({ component: Page });

interface Dept {
  id: string;
  name: string;
  parent_id: string | null;
  code: string | null;
  sort_order: number | null;
  manager_id: string | null;
}
interface Member {
  id: string;
  name: string | null;
  employee_no: string | null;
  job_title: string | null;
  role: string | null;
  status: string | null;
  department_id: string | null;
}

const ROLE_LABEL: Record<string, string> = {
  company_admin: "系統管理",
  dept_manager: "部門主管",
  member: "成員",
  viewer: "唯讀",
};

function Page() {
  const { data: depts = [] } = useQuery({
    queryKey: ["org_depts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("department")
        .select("id, name, parent_id, code, sort_order, manager_id")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Dept[];
    },
  });

  const managerIds = useMemo(
    () => Array.from(new Set(depts.map((d) => d.manager_id).filter(Boolean) as string[])),
    [depts],
  );

  const { data: managers = [] } = useQuery({
    queryKey: ["org_managers", managerIds],
    enabled: managerIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_user")
        .select("id, name, job_title")
        .in("id", managerIds);
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; name: string | null; job_title: string | null }>;
    },
  });
  const managerMap = useMemo(() => {
    const m = new Map<string, { name: string | null; job_title: string | null }>();
    managers.forEach((u) => m.set(u.id, { name: u.name, job_title: u.job_title }));
    return m;
  }, [managers]);

  const { data: activeCount = 0 } = useQuery({
    queryKey: ["org_active_count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("app_user")
        .select("id", { count: "exact", head: true })
        .eq("status", "active");
      if (error) throw error;
      return count ?? 0;
    },
  });

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
  const selected = useMemo(() => depts.find((d) => d.id === selectedId) ?? null, [depts, selectedId]);
  const parentName = selected?.parent_id
    ? depts.find((d) => d.id === selected.parent_id)?.name ?? "—"
    : "—";
  const manager = selected?.manager_id ? managerMap.get(selected.manager_id) : null;

  const { data: members = [], isLoading: membersLoading } = useQuery({
    queryKey: ["org_members", selectedId],
    enabled: !!selectedId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_user")
        .select("id, name, employee_no, job_title, role, status, department_id")
        .eq("department_id", selectedId!)
        .eq("status", "active")
        .order("employee_no", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Member[];
    },
  });

  // auto-select first dept once loaded
  if (!selectedId && topDepts.length > 0) {
    queueMicrotask(() => setSelectedId(topDepts[0].id));
  }

  return (
    <div className="space-y-6">
      <PageHeader title="組織架構" description="部門階層與成員清單" />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard icon={<Building2 className="w-4 h-4" />} label="部門總數" value={deptCount} />
        <StatCard icon={<Network className="w-4 h-4" />} label="課總數" value={courseCount} />
        <StatCard icon={<Users className="w-4 h-4" />} label="在職員工數" value={activeCount} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
        <Card>
          <CardContent className="py-3">
            <div className="text-sm font-medium mb-2 text-muted-foreground px-1">部門樹</div>
            <div className="space-y-0.5">
              {topDepts.map((d) => (
                <TreeNode
                  key={d.id}
                  dept={d}
                  tree={tree}
                  level={0}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                />
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
                <div>
                  <div className="text-lg font-semibold">{selected.name}</div>
                  <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-4 gap-y-1">
                    <span>代碼：{selected.code ?? "—"}</span>
                    <span>上層：{parentName}</span>
                  </div>
                </div>

                <div className="rounded-md border p-3 bg-muted/30">
                  <div className="text-xs text-muted-foreground mb-1">部門主管</div>
                  {manager ? (
                    <div className="text-sm">
                      <span className="font-medium">{manager.name ?? "—"}</span>
                      {manager.job_title && (
                        <span className="ml-2 text-muted-foreground">{manager.job_title}</span>
                      )}
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">未指派</div>
                  )}
                </div>

                <div>
                  <div className="text-sm font-medium mb-2">成員清單（{members.length}）</div>
                  <div className="rounded-md border overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>姓名</TableHead>
                          <TableHead>員工編號</TableHead>
                          <TableHead>職稱</TableHead>
                          <TableHead>角色</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {membersLoading && (
                          <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">載入中…</TableCell></TableRow>
                        )}
                        {!membersLoading && members.length === 0 && (
                          <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">此部門目前沒有在職成員</TableCell></TableRow>
                        )}
                        {members.map((m) => (
                          <TableRow key={m.id}>
                            <TableCell className="font-medium">{m.name ?? "—"}</TableCell>
                            <TableCell className="font-mono text-xs">{m.employee_no ?? "—"}</TableCell>
                            <TableCell>{m.job_title ?? "—"}</TableCell>
                            <TableCell>
                              <Badge variant="outline">{ROLE_LABEL[m.role ?? ""] ?? m.role ?? "—"}</Badge>
                            </TableCell>
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
}: {
  dept: Dept;
  tree: Map<string | null, Dept[]>;
  level: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const children = tree.get(dept.id) ?? [];
  const hasChildren = children.length > 0;
  const [open, setOpen] = useState(true);
  const isActive = selectedId === dept.id;
  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-1 rounded-md px-2 py-1.5 text-sm cursor-pointer hover:bg-accent/50",
          isActive && "bg-accent text-accent-foreground font-medium",
        )}
        style={{ paddingLeft: 8 + level * 14 }}
        onClick={() => onSelect(dept.id)}
      >
        {hasChildren ? (
          <button
            className="p-0.5 -ml-0.5 rounded hover:bg-accent"
            onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
            aria-label={open ? "收合" : "展開"}
          >
            {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
        ) : (
          <span className="w-4" />
        )}
        <span className="truncate">{dept.name}</span>
        {dept.code && <span className="ml-auto text-[10px] text-muted-foreground font-mono">{dept.code}</span>}
      </div>
      {hasChildren && open && (
        <div>
          {children.map((c) => (
            <TreeNode key={c.id} dept={c} tree={tree} level={level + 1} selectedId={selectedId} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  );
}
