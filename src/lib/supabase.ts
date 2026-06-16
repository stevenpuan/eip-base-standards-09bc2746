// EIP 專案使用 src/integrations/supabase/client.ts（已連線到 steven01 EIP 專案）。
// 為避免兩個 GoTrueClient 實例搶 localStorage，這裡直接 re-export 同一個 client。
export { supabase } from "@/integrations/supabase/client";
