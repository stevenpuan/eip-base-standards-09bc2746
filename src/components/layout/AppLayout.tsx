import { Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { AppSidebar } from "./AppSidebar";
import { Button } from "@/components/ui/button";

export function AppLayout() {
  const { loading, session, profile, signOut } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !session) navigate({ to: "/login" });
  }, [loading, session, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center text-muted-foreground">
        載入中…
      </div>
    );
  }
  if (!session) return null;

  if (profile && profile.status !== "active") {
    return (
      <div className="min-h-screen grid place-items-center px-4 text-center">
        <div className="max-w-sm space-y-3">
          <h1 className="text-xl font-semibold">帳號待審核</h1>
          <p className="text-sm text-muted-foreground">
            您的帳號狀態為「{profile.status}」，需管理員核准後才能進入系統。
          </p>
          <Button variant="outline" onClick={signOut}>
            登出
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppSidebar />
      <main className="pl-64">
        <div className="p-6 max-w-7xl mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
