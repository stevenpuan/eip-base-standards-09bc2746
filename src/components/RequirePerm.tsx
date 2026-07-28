import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import { useAuth, type Action } from "@/lib/auth";
import { Button } from "@/components/ui/button";

/**
 * 頁面層權限守門。
 *
 * 為什麼不是 <Navigate>：被擋的人可能連預設落點（我的工作）都沒權限，
 * 導頁會變成無限跳轉。這裡一律停在原地顯示說明，網址不變、可回上一頁。
 *
 * 一定要等 permsLoaded —— 只看 loading 會在權限還沒回來的那一刻把有權限的人擋掉，
 * 從側邊欄點進去不會重現，但重新整理／書籤／LINE 連結一定中。
 */
export function RequirePerm({
  module,
  action = "view",
  children,
}: {
  module: string;
  action?: Action;
  children: ReactNode;
}) {
  const { permsLoaded, can } = useAuth();

  if (!permsLoaded) {
    return <div className="text-muted-foreground py-8">載入中…</div>;
  }

  if (!can(module, action)) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <div className="rounded-full bg-muted p-3">
          <ShieldAlert className="h-6 w-6 text-muted-foreground" />
        </div>
        <div className="space-y-1">
          <p className="font-medium">沒有權限檢視此頁</p>
          <p className="text-sm text-muted-foreground">
            此頁面需要對應的模組權限，如需使用請聯絡系統管理者調整角色設定。
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/dashboard">回首頁</Link>
        </Button>
      </div>
    );
  }

  return <>{children}</>;
}
