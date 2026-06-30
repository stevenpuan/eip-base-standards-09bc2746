import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/feature-requests")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard/eip/feature-requests" });
  },
  component: () => null,
});
