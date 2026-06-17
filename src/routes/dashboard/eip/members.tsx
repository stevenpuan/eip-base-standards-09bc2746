import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/eip/members")({
  component: () => <Navigate to="/dashboard/users" replace />,
});
