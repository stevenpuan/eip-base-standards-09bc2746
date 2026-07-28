import { createFileRoute, Outlet } from "@tanstack/react-router";

import { RequirePerm } from "@/components/RequirePerm";
export const Route = createFileRoute("/dashboard/eip/feature-requests")({
  component: () => (
    <RequirePerm module="eip_feature_pool">
      <Layout />
    </RequirePerm>
  ),
});

function Layout() {
  return <Outlet />;
}
