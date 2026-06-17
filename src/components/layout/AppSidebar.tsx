import { Link, useLocation } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import * as Icons from "lucide-react";
import { LogOut, Menu, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { NotificationBell } from "@/components/eip/NotificationBell";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";

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

function SidebarInner({ onNavigate }: { onNavigate?: () => void }) {
  const { pathname } = useLocation();
  const { profile, roleNames, signOut, can } = useAuth();

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
    <div className="flex flex-col h-full bg-card">
      <div className="px-5 py-4 border-b flex items-center gap-3">
        <img src="/logo.png" alt="陞煇食品" className="w-10 h-10 object-contain shrink-0" />
        <div className="min-w-0">
          <h1 className="text-sm font-bold text-primary truncate">陞煇食品</h1>
          <p className="text-[11px] text-muted-foreground mt-0.5 truncate">內部管理平台</p>
        </div>
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
                onNavigate={onNavigate}
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
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          );
        })}
      </nav>
      <div className="border-t p-3">
        <div className="flex items-center gap-2 px-2 py-1.5">
          <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-semibold shrink-0">
            {(profile?.full_name ?? profile?.email ?? "U").slice(0, 1).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">
              {profile?.full_name ?? profile?.email}
            </div>
            <div className="text-xs text-muted-foreground truncate">{roleNames[0] ?? "—"}</div>
          </div>
          <button
            onClick={signOut}
            className="p-2 rounded-md hover:bg-accent text-muted-foreground"
            title="登出"
            aria-label="登出"
          >
            <LogOut className="w-4 h-4" />
          </button>
          <NotificationBell />
        </div>
      </div>
    </div>
  );
}

export function AppSidebar() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();

  // Close drawer when route changes
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <>
      {/* Mobile top bar */}
      <header className="lg:hidden sticky top-0 z-40 flex items-center justify-between h-12 px-3 border-b bg-card">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <button
              className="p-2 -ml-2 rounded-md hover:bg-accent"
              aria-label="開啟選單"
            >
              <Menu className="w-5 h-5" />
            </button>
          </SheetTrigger>
          <SheetContent side="left" className="p-0 w-72 max-w-[85vw]">
            <SheetTitle className="sr-only">主選單</SheetTitle>
            <SidebarInner onNavigate={() => setOpen(false)} />
          </SheetContent>
        </Sheet>
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="陞煇食品" className="w-6 h-6 object-contain" />
          <h1 className="text-sm font-bold text-primary">陞煇食品 內部管理平台</h1>
        </div>
        <span className="w-9" />
      </header>

      {/* Desktop sidebar */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-64 border-r bg-card flex-col">
        <SidebarInner />
      </aside>
    </>
  );
}

function SideLink({
  to,
  icon,
  title,
  active,
  onNavigate,
}: {
  to: string;
  icon: string | null;
  title: string;
  active: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      to={to as any}
      onClick={onNavigate}
      className={cn(
        "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
        active
          ? "bg-accent text-accent-foreground font-medium"
          : "text-foreground/80 hover:bg-accent/50"
      )}
    >
      <Icon name={icon} className="w-4 h-4 shrink-0" />
      <span className="truncate">{title}</span>
    </Link>
  );
}
