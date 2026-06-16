import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export const Route = createFileRoute("/dashboard/profile")({ component: Page });

function Page() {
  const { profile, user, roles, refresh } = useAuth();
  const [fullName, setFullName] = useState("");
  const [pw, setPw] = useState("");

  useEffect(() => {
    setFullName(profile?.full_name ?? "");
  }, [profile]);

  const saveProfile = async () => {
    if (!user) return;
    const { error } = await supabase.from("profiles").update({ full_name: fullName }).eq("id", user.id);
    if (error) { toast.error(error.message); return; }
    toast.success("已更新個人資料");
    await refresh();
  };

  const changePassword = async () => {
    if (pw.length < 6) { toast.error("密碼至少 6 碼"); return; }
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) { toast.error(error.message); return; }
    toast.success("密碼已更新");
    setPw("");
  };

  return (
    <div className="space-y-6">
      <PageHeader title="個人設定" description="管理你的個人資料與密碼" />
      <Card>
        <CardHeader><CardTitle className="text-base">個人資料</CardTitle></CardHeader>
        <CardContent className="space-y-4 max-w-md">
          <div className="space-y-1"><Label>Email</Label><Input value={profile?.email ?? ""} disabled /></div>
          <div className="space-y-1"><Label>角色</Label><Input value={roles.join("、") || "—"} disabled /></div>
          <div className="space-y-1"><Label>姓名</Label><Input value={fullName} onChange={(e) => setFullName(e.target.value)} /></div>
          <Button onClick={saveProfile}>儲存</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">修改密碼</CardTitle></CardHeader>
        <CardContent className="space-y-4 max-w-md">
          <div className="space-y-1"><Label>新密碼</Label><Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="至少 6 碼" /></div>
          <Button onClick={changePassword}>更新密碼</Button>
        </CardContent>
      </Card>
    </div>
  );
}
