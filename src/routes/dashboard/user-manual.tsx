import { createFileRoute } from "@tanstack/react-router";
import { DocPage } from "@/components/DocPage";
import { RequirePerm } from "@/components/RequirePerm";

export const Route = createFileRoute("/dashboard/user-manual")({
  component: () => (
    <RequirePerm module="user_manual">
      <DocPage docKey="user_manual" title="使用手冊" description="系統操作教學" />
    </RequirePerm>
  ),
});
