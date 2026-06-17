import { createFileRoute, Outlet } from "@tanstack/react-router";
import { EipUserProvider, useEipUser } from "@/lib/eip-user";
import { ROLE_LABEL } from "@/lib/eip-constants";
import { QuickReportButton } from "@/components/eip/QuickReportButton";

export const Route = createFileRoute("/dashboard/eip")({ component: Layout });

function Layout() {
  return (
    <EipUserProvider>
      <Banner />
      <Outlet />
      <QuickReportButton />
    </EipUserProvider>
  );
}

function Banner() {
  const { loading, appUser, error } = useEipUser();
  if (loading) return <div className="text-sm text-muted-foreground py-2">EIP 帳號載入中…</div>;
  if (error)
    return (
      <div className="text-sm text-destructive py-2">
        無法載入 EIP 帳號：{error}
      </div>
    );
  if (!appUser) return null;
  return (
    <div className="text-xs text-muted-foreground py-1.5">
      EIP 身分：{appUser.name}（{ROLE_LABEL[appUser.role] ?? appUser.role}）
    </div>
  );
}
