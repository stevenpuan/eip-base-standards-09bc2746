import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./auth";
import { DEFAULT_TENANT_ID } from "./eip-constants";
import type { Database } from "@/integrations/supabase/types";

export type AppUser = Database["public"]["Tables"]["app_user"]["Row"];

interface Ctx {
  loading: boolean;
  appUser: AppUser | null;
  error: string | null;
  reload: () => Promise<void>;
}

const EipUserContext = createContext<Ctx | null>(null);

export function EipUserProvider({ children }: { children: ReactNode }) {
  const { session, user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ensure = async () => {
    if (!user) {
      setAppUser(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data: existing, error: selErr } = await supabase
        .from("app_user")
        .select("*")
        .eq("id", user.id)
        .maybeSingle();
      if (selErr) throw selErr;
      if (existing) {
        setAppUser(existing as AppUser);
        setLoading(false);
        return;
      }
      // 建立 app_user，預設為 member / active / 預設租戶
      const email = user.email ?? null;
      const name = email ? email.split("@")[0] : "User";
      const { data: inserted, error: insErr } = await supabase
        .from("app_user")
        .insert({
          id: user.id,
          tenant_id: DEFAULT_TENANT_ID,
          email,
          name,
          role: "member",
          status: "active",
        })
        .select("*")
        .single();
      if (insErr) throw insErr;
      setAppUser(inserted as AppUser);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void ensure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, session?.access_token]);

  return (
    <EipUserContext.Provider value={{ loading, appUser, error, reload: ensure }}>
      {children}
    </EipUserContext.Provider>
  );
}

export function useEipUser() {
  const ctx = useContext(EipUserContext);
  if (!ctx) throw new Error("useEipUser must be used within EipUserProvider");
  return ctx;
}

export function canManageEip(role?: string | null) {
  return role === "company_admin" || role === "dept_manager";
}
