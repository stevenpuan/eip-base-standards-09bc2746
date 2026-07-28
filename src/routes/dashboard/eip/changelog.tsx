import { createFileRoute, Navigate } from "@tanstack/react-router";

// 舊的「更新紀錄」頁已退役，統一由「開發歷程」維護
export const Route = createFileRoute("/dashboard/eip/changelog")({
  component: () => <Navigate to="/dashboard/dev-history" replace />,
});
