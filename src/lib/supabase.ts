import { createClient } from "@supabase/supabase-js";

// 明確指向 base01（自管 Supabase，已套用完整 schema）。
// 刻意「不」讀 import.meta.env，避免 Lovable Cloud 覆寫環境變數時把 app 導到別的 DB。
// 其他系統要重用此模板時，改這兩個常數即可。
// anon key 為可公開金鑰（publishable），存取由資料庫 RLS 控管。
const SUPABASE_URL = "https://gsehyfmwpcfgihxxvqrj.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdzZWh5Zm13cGNmZ2loeHh2cXJqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1MDA3NDYsImV4cCI6MjA5NzA3Njc0Nn0.DxVupYsAfK3ate65hk8osSJD33fJyTmyfSkOGxW7lbM";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
