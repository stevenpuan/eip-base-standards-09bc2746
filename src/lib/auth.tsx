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
  roleNames: string[];
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
  const [roleNames, setRoleNames] = useState<string[]>([]);
  const [perms, setPerms] = useState<PermMap>({});
  const [pagePerms, setPagePerms] = useState<PageMap>({});

  const loadUserData = async (uid: string) => {
    // 平行拉 profile + user_roles，減少 RTT
    const [{ data: prof }, { data: ur }] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", uid).maybeSingle(),
      supabase.from("user_roles").select("role_id, roles(code,name)").eq("user_id", uid),
    ]);
    setProfile((prof as Profile) ?? null);

    const rows = (ur ?? []) as unknown as Array<{ role_id: string; roles: { code: string; name: string } | null }>;
    let codes = rows.map((r) => r.roles?.code).filter(Boolean) as string[];
    let names = rows.map((r) => r.roles?.name).filter(Boolean) as string[];
    const roleIds = rows.map((r) => r.role_id);
    // Fallback: 若 join 未返回 roles（例如 RLS 阻擋），改以 role_id 直查
    if (roleIds.length && (codes.length === 0 || names.length === 0)) {
      const { data: rs } = await supabase.from("roles").select("id,code,name").in("id", roleIds);
      const map = new Map((rs ?? []).map((r: any) => [r.id, r]));
      codes = roleIds.map((id) => map.get(id)?.code).filter(Boolean) as string[];
      names = roleIds.map((id) => map.get(id)?.name).filter(Boolean) as string[];
    }
    setRoles(codes);
    setRoleNames(names);

    if (!roleIds.length) {
      setPerms({});
      setPagePerms({});
      return;
    }

    // 模組層 + 子頁面層平行拉
    const [{ data: rmp }, { data: rpp }] = await Promise.all([
      supabase.from("role_module_permissions").select("*").in("role_id", roleIds),
      supabase.from("role_page_permissions").select("*").in("role_id", roleIds),
    ]);

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
    let lastLoadedUid: string | null = null;

    const runLoad = (uid: string) => {
      if (lastLoadedUid === uid) return;
      lastLoadedUid = uid;
      // 用 setTimeout 把工作丟出回呼堆疊，避免 onAuthStateChange 內直接 await
      // supabase 呼叫造成的 deadlock / 卡頓（Supabase 官方建議）。
      setTimeout(() => {
        if (!active) return;
        void loadUserData(uid);
      }, 0);
    };

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      setSession(data.session ?? null);
      if (data.session?.user) {
        runLoad(data.session.user.id);
      }
      setLoading(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
      if (sess?.user) {
        runLoad(sess.user.id);
      } else {
        lastLoadedUid = null;
        setProfile(null);
        setRoles([]);
        setRoleNames([]);
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
      value={{ loading, session, user: session?.user ?? null, profile, roles, roleNames, isAdmin, can, refresh, signOut }}
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
