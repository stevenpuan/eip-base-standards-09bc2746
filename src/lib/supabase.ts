// EIP 專案使用 src/integrations/supabase/client.ts（已連線到 steven01 EIP 專案）。
// 模板舊頁面會查詢一些 EIP 資料庫不存在的表（menus / profiles / activity_logs ...），
// 為避免 typed client 阻擋編譯，這裡以 untyped 形式 re-export。
import { supabase as typedSupabase } from "@/integrations/supabase/client";

export const supabase = typedSupabase as unknown as ReturnType<
  typeof import("@supabase/supabase-js").createClient
>;
