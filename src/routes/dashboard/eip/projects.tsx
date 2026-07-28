import { createFileRoute, Outlet } from "@tanstack/react-router";
import { RequirePerm } from "@/components/RequirePerm";

export const Route = createFileRoute("/dashboard/eip/projects")({
  component: () => (
    <RequirePerm module="eip_projects">
      <Outlet />
    </RequirePerm>
  ),
});
