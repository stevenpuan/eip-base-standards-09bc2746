import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { logActivity } from "@/lib/logging";

export const Route = createFileRoute("/login")({ component: LoginPage });

function LoginPage() {
  const navigate = useNavigate();
  const { session, loading } = useAuth();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && session) navigate({ to: "/dashboard" });
  }, [loading, session, navigate]);

  const onLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    const f = new FormData(e.currentTarget);
    const { error } = await supabase.auth.signInWithPassword({
      email: String(f.get("email")),
      password: String(f.get("password")),
    });
    setBusy(false);
    if (error) toast.error("登入失敗：" + error.message);
    else {
      await logActivity("login");
      navigate({ to: "/dashboard" });
    }
  };

  const onRegister = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    const f = new FormData(e.currentTarget);
    const invite = String(f.get("invite_code") || "").trim();
    const { data: signUpData, error } = await supabase.auth.signUp({
      email: String(f.get("email")),
      password: String(f.get("password")),
      options: {
        data: { full_name: String(f.get("full_name")), invite_code: invite },
      },
    });
    if (error) {
      setBusy(false);
      toast.error("註冊失敗：" + error.message);
      return;
    }
    if (invite && signUpData.session) {
      const { data: res } = await supabase.rpc("redeem_invitation", { p_code: invite });
      setBusy(false);
      if (res === "ok") {
        await logActivity("login");
        toast.success("註冊成功，已啟用！");
        navigate({ to: "/dashboard" });
        return;
      }
      toast.message("邀請碼無效或已過期，帳號待管理員審核");
      return;
    }
    setBusy(false);
    toast.success("註冊成功！首位註冊者自動成為管理員；其餘需管理員審核。");
  };

  return (
    <div className="min-h-screen grid place-items-center bg-muted/30 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">後台管理系統</CardTitle>
          <CardDescription>空系統 Base</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="login">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login">登入</TabsTrigger>
              <TabsTrigger value="register">註冊</TabsTrigger>
            </TabsList>
            <TabsContent value="login">
              <form onSubmit={onLogin} className="space-y-3 pt-3">
                <div className="space-y-1">
                  <Label>Email</Label>
                  <Input name="email" type="email" required />
                </div>
                <div className="space-y-1">
                  <Label>密碼</Label>
                  <Input name="password" type="password" required />
                </div>
                <Button className="w-full" disabled={busy}>
                  {busy ? "登入中…" : "登入"}
                </Button>
              </form>
            </TabsContent>
            <TabsContent value="register">
              <form onSubmit={onRegister} className="space-y-3 pt-3">
                <div className="space-y-1">
                  <Label>姓名</Label>
                  <Input name="full_name" required />
                </div>
                <div className="space-y-1">
                  <Label>Email</Label>
                  <Input name="email" type="email" required />
                </div>
                <div className="space-y-1">
                  <Label>密碼</Label>
                  <Input name="password" type="password" required minLength={6} />
                </div>
                <div className="space-y-1">
                  <Label>邀請碼（選填）</Label>
                  <Input name="invite_code" />
                </div>
                <Button className="w-full" disabled={busy}>
                  {busy ? "送出中…" : "註冊"}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
