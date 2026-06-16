import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useEipUser } from "@/lib/eip-user";
import { ROLE_LABEL, STATUS_LABEL } from "@/lib/eip-constants";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Database } from "@/integrations/supabase/types";

export const Route = createFileRoute("/dashboard/eip/members")({ component: MembersPage });

type AppUser = Database["public"]["Tables"]["app_user"]["Row"];
type Department = Database["public"]["Tables"]["department"]["Row"];
type Role = Database["public"]["Enums"]["user_role"];
type Status = Database["public"]["Enums"]["user_status"];

const ROLES: Role[] = ["company_admin", "dept_manager", "member", "viewer"];
const STATUSES: Status[] = ["active", "inactive"];

function MembersPage() {
  const qc = useQueryClient();
  const { appUser } = useEipUser();
  const isAdmin = appUser?.role === "company_admin";

  const usersQ = useQuery({
    queryKey: ["eip", "members"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_user")
        .select("*")
        .order("created_at", { ascending: true });
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

  const update = async (id: string, patch: Partial<AppUser>) => {
    const { error } = await supabase.from("app_user").update(patch).eq("id", id);
    if (error) {
      toast.error(`更新失敗：${error.message}`);
    } else {
      toast.success("已更新");
      qc.invalidateQueries({ queryKey: ["eip", "members"] });
    }
  };

  const [promoteEmail, setPromoteEmail] = useState("");
  const promote = async () => {
    const email = promoteEmail.trim().toLowerCase();
    if (!email) return;
    const target = (usersQ.data ?? []).find((u) => (u.email ?? "").toLowerCase() === email);
    if (!target) {
      toast.error("找不到該 email 對應的 EIP 成員（請先讓對方登入系統一次）");
      return;
    }
    await update(target.id, { role: "company_admin", status: "active" });
    setPromoteEmail("");
  };

  if (usersQ.isLoading) return <div className="text-muted-foreground py-8">載入中…</div>;

  return (
    <div>
      <PageHeader title="EIP 成員管理" description="管理本系統成員的角色、部門與啟用狀態。" />

      {!isAdmin && (
        <Card className="mb-4">
          <CardContent className="py-3 text-sm text-muted-foreground">
            你目前的角色為「{appUser ? (ROLE_LABEL[appUser.role] ?? appUser.role) : "—"}」,
            僅公司管理員可調整成員。第一位管理員可由資料庫直接設定:
            <code className="ml-1 px-1.5 py-0.5 rounded bg-muted">
              update app_user set role='company_admin' where email='你的 email';
            </code>
          </CardContent>
        </Card>
      )}

      {isAdmin && (
        <Card className="mb-4">
          <CardContent className="py-3 flex flex-wrap items-center gap-2">
            <span className="text-sm">將指定 email 設為公司管理員：</span>
            <Input
              className="h-8 max-w-xs"
              placeholder="user@example.com"
              value={promoteEmail}
              onChange={(e) => setPromoteEmail(e.target.value)}
            />
            <Button size="sm" onClick={promote}>套用</Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>姓名</TableHead>
                <TableHead>Email</TableHead>
                <TableHead className="w-[140px]">角色</TableHead>
                <TableHead className="w-[160px]">部門</TableHead>
                <TableHead className="w-[100px]">狀態</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(usersQ.data ?? []).map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{u.email}</TableCell>
                  <TableCell>
                    {isAdmin ? (
                      <Select value={u.role} onValueChange={(v) => update(u.id, { role: v as Role })}>
                        <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge variant="outline">{ROLE_LABEL[u.role]}</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {isAdmin ? (
                      <Select
                        value={u.department_id ?? "none"}
                        onValueChange={(v) => update(u.id, { department_id: v === "none" ? null : v })}
                      >
                        <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">未設定</SelectItem>
                          {(deptsQ.data ?? []).map((d) => (
                            <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        {(deptsQ.data ?? []).find((d) => d.id === u.department_id)?.name ?? "—"}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {isAdmin ? (
                      <Select value={u.status} onValueChange={(v) => update(u.id, { status: v as Status })}>
                        <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge variant={u.status === "active" ? "default" : "secondary"}>
                        {STATUS_LABEL[u.status]}
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {(usersQ.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    尚無成員。每位使用者首次登入後會自動建立。
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
