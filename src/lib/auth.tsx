import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { logActivity } from "./logging";

export type Action = "view" | "create" | "edit" | "delete" | "export";
export type PermFlags = Record<Action, boolean>;
export type PermMap = Record<string, PermFlags>;
// 子頁面層：每個動作可為 true(開) / false(關) / null(繼承模組層)
export type PageFlags = Record<Action, boolean | null>;
export type PageMap = Record<string, PageFlags>;

export interface Profile {
  id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  status: string;
}

interface AuthContextValue {
  loading: boolean;
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  roles: string[];
  isAdmin: boolean;
  can: (key: string, action?: Action) => boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const ACTIONS: Action[] = ["view", "create", "edit", "delete", "export"];

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [perms, setPerms] = useState<PermMap>({});
  const [pagePerms, setPagePerms] = useState<PageMap>({});

  const loadUserData = async (uid: string) => {
    const { data: prof } = await supabase.from("profiles").select("*").eq("id", uid).maybeSingle();
    setProfile((prof as Profile) ?? null);

    const { data: ur } = await supabase
      .from("user_roles")
      .select("role_id, roles(code)")
      .eq("user_id", uid);
    const rows = (ur ?? []) as unknown as Array<{ role_id: string; roles: { code: string } | null }>;
    setRoles(rows.map((r) => r.roles?.code).filter(Boolean) as string[]);

    const roleIds = rows.map((r) => r.role_id);
    if (!roleIds.length) {
      setPerms({});
      setPagePerms({});
      return;
    }

    // 模組層
    const { data: rmp } = await supabase.from("role_module_permissions").select("*").in("role_id", roleIds);
    const map: PermMap = {};
    (rmp ?? []).forEach((p: any) => {
      const cur = map[p.module_key] ?? { view: false, create: false, edit: false, delete: false, export: false };
      map[p.module_key] = {
        view: cur.view || p.can_view,
        create: cur.create || p.can_create,
        edit: cur.edit || p.can_edit,
        delete: cur.delete || p.can_delete,
        export: cur.export || p.can_export,
      };
    });
    setPerms(map);

    // 子頁面層（多角色合併：任一 true → true；否則任一 false → false；否則 null 繼承）
    const { data: rpp } = await supabase.from("role_page_permissions").select("*").in("role_id", roleIds);
    const pmap: PageMap = {};
    (rpp ?? []).forEach((p: any) => {
      const cur = pmap[p.page_key] ?? { view: null, create: null, edit: null, delete: null, export: null };
      const merged: PageFlags = { ...cur };
      ACTIONS.forEach((a) => {
        const v = p["can_" + a] as boolean | null;
        if (cur[a] === true || v === true) merged[a] = true;
        else if (cur[a] === false || v === false) merged[a] = false;
        else merged[a] = null;
      });
      pmap[p.page_key] = merged;
    });
    setPagePerms(pmap);
  };

  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      setSession(data.session ?? null);
      if (data.session?.user) await loadUserData(data.session.user.id);
      setLoading(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, sess) => {
      setSession(sess);
      if (sess?.user) await loadUserData(sess.user.id);
      else {
        setProfile(null);
        setRoles([]);
        setPerms({});
        setPagePerms({});
      }
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const isAdmin = roles.includes("admin");
  const can = (key: string, action: Action = "view") => {
    if (isAdmin) return true;
    const pageVal = pagePerms[key]?.[action]; // true | false | null | undefined
    if (pageVal === true) return true;
    if (pageVal === false) return false;
    return !!perms[key]?.[action]; // 繼承模組層
  };
  const signOut = async () => {
    await logActivity("logout");
    await supabase.auth.signOut();
  };
  const refresh = async () => {
    if (session?.user) await loadUserData(session.user.id);
  };

  return (
    <AuthContext.Provider
      value={{ loading, session, user: session?.user ?? null, profile, roles, isAdmin, can, refresh, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
