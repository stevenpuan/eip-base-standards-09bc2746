import { Link, useLocation } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import * as Icons from "lucide-react";
import { LogOut } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { NotificationBell } from "@/components/eip/NotificationBell";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

interface MenuRow {
  id: string;
  menu_key: string;
  parent_id: string | null;
  title: string;
  icon: string | null;
  route: string | null;
  module_key: string | null;
  sort_order: number;
  is_active: boolean;
}

function Icon({ name, className }: { name: string | null; className?: string }) {
  const Cmp = ((Icons as any)[name ?? "Circle"] ?? Icons.Circle) as React.ComponentType<{
    className?: string;
  }>;
  return <Cmp className={className} />;
}

export function AppSidebar() {
  const { pathname } = useLocation();
  const { profile, roles, can, signOut } = useAuth();

  const { data: menus = [] } = useQuery({
    queryKey: ["menus"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("menus")
        .select("*")
        .eq("is_active", true)
        .order("sort_order");
      if (error) throw error;
      return data as MenuRow[];
    },
  });

  const groups = menus.filter((m) => !m.parent_id);
  const childrenOf = (id: string) => menus.filter((m) => m.parent_id === id);
  const visible = (m: MenuRow) => !m.module_key || can(m.module_key, "view");

  return (
    <aside className="fixed inset-y-0 left-0 w-64 border-r bg-card flex flex-col">
      <div className="px-5 py-4 border-b">
        <h1 className="text-base font-bold text-primary">後台管理</h1>
        <p className="text-xs text-muted-foreground mt-0.5">空系統 Base</p>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
        {groups.map((g) => {
          if (g.route) {
            if (!visible(g)) return null;
            return (
              <SideLink
                key={g.id}
                to={g.route}
                icon={g.icon}
                title={g.title}
                active={pathname === g.route}
              />
            );
          }
          const kids = childrenOf(g.id).filter(visible);
          if (!kids.length) return null;
          return (
            <div key={g.id} className="pt-2">
              <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {g.title}
              </div>
              {kids.map((k) => (
                <SideLink
                  key={k.id}
                  to={k.route!}
                  icon={k.icon}
                  title={k.title}
                  active={pathname === k.route}
                />
              ))}
            </div>
          );
        })}

      </nav>
      <div className="border-t p-3">
        <div className="flex items-center gap-2 px-2 py-1.5">
          <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-semibold">
            {(profile?.full_name ?? profile?.email ?? "U").slice(0, 1).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">
              {profile?.full_name ?? profile?.email}
            </div>
            <div className="text-xs text-muted-foreground">{roles[0] ?? "—"}</div>
          </div>
          <button
            onClick={signOut}
            className="p-2 rounded-md hover:bg-accent text-muted-foreground"
            title="登出"
            aria-label="登出"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}

function SideLink({
  to,
  icon,
  title,
  active,
}: {
  to: string;
  icon: string | null;
  title: string;
  active: boolean;
}) {
  return (
    <Link
      to={to as any}
      className={cn(
        "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
        active
          ? "bg-accent text-accent-foreground font-medium"
          : "text-foreground/80 hover:bg-accent/50"
      )}
    >
      <Icon name={icon} className="w-4 h-4" />
      <span>{title}</span>
    </Link>
  );
}
