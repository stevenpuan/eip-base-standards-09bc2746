// EIP 專案使用 src/integrations/supabase/client.ts（已連線到 steven01 EIP 專案）。
// 模板舊頁面會查詢一些 EIP 資料庫不存在的表，為避免 typed client 阻擋編譯，這裡以 any 形式 re-export。
// EIP 新頁面若需要型別,可直接從 @/integrations/supabase/client 取 typed 版本。
import { supabase as typedSupabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const supabase: SupabaseClient<any, any, any> = typedSupabase as any;
