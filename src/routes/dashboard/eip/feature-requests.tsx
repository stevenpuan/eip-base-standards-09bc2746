import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/eip/feature-requests")({
  component: Layout,
});

function Layout() {
  return <Outlet />;
}
