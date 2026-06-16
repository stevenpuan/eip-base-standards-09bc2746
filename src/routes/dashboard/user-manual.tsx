import { createFileRoute } from "@tanstack/react-router";
import { DocPage } from "@/components/DocPage";

export const Route = createFileRoute("/dashboard/user-manual")({
  component: () => <DocPage docKey="user_manual" title="使用手冊" description="系統操作教學" />,
});
