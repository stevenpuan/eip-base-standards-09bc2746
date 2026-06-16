import { createFileRoute } from "@tanstack/react-router";
import { DocPage } from "@/components/DocPage";

export const Route = createFileRoute("/dashboard/system-docs")({
  component: () => <DocPage docKey="system_docs" title="系統文件" description="模組架構、技術棧與規則（可作為 Agent Skill 訓練資料）" />,
});
