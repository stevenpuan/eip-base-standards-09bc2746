import { Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEipUser } from "@/lib/eip-user";

/**
 * EIP 身分尚未就緒時的畫面。
 * - 載入中：轉圈
 * - 載入失敗／查無 EIP 帳號：顯示原因與「重新載入」，避免頁面永遠停在「載入中…」
 */
export function EipUserPending() {
  const { loading, error, reload } = useEipUser();

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-10 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        EIP 帳號載入中…
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-6">
      <div className="flex items-center gap-2 text-destructive">
        <AlertTriangle className="h-4 w-4" />
        <span className="font-medium">
          {error ? "無法載入 EIP 帳號" : "查無你的 EIP 帳號資料"}
        </span>
      </div>
      <p className="text-sm text-muted-foreground">
        {error ?? "請聯絡系統管理員於「組織架構」或「帳號管理」建立你的 EIP 成員資料。"}
      </p>
      <Button variant="outline" size="sm" onClick={() => void reload()}>
        重新載入
      </Button>
    </div>
  );
}
