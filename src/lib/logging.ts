import { supabase } from "./supabase";

// 操作日誌：登入/登出等一般行為
export async function logActivity(action: string, route?: string) {
  try {
    const { data } = await supabase.auth.getUser();
    await supabase.from("activity_logs").insert({
      user_id: data.user?.id ?? null,
      action,
      route: route ?? (typeof window !== "undefined" ? window.location.pathname : null),
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
    });
  } catch {
    /* 日誌寫入失敗不影響主流程 */
  }
}

// 錯誤日誌：前端例外
export async function logError(message: string, context?: unknown) {
  try {
    const { data } = await supabase.auth.getUser();
    await supabase.from("error_logs").insert({
      level: "error",
      message,
      context: context ? (context as Record<string, unknown>) : null,
      route: typeof window !== "undefined" ? window.location.pathname : null,
      user_id: data.user?.id ?? null,
    });
  } catch {
    /* 忽略 */
  }
}
