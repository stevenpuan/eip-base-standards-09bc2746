import { createFileRoute, Outlet } from "@tanstack/react-router";
import { RequirePerm } from "@/components/RequirePerm";

export const Route = createFileRoute("/dashboard/eip/meetings")({
  component: () => (
    <RequirePerm module="eip_meetings">
      <Outlet />
    </RequirePerm>
  ),
});
