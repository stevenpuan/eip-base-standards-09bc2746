// eip_my_routine_today / eip_toggle_routine_item 尚未進 types.ts，用寬鬆型別的 client
import { supabase } from "@/lib/supabase";

export type RoutineSection = "morning" | "afternoon" | "special";

export type RoutineRow = {
  section: RoutineSection;
  sort_order: number;
  text: string;
  done: boolean;
  note: string | null;
  /** 相關檔案：NAS 路徑或網址（訪談定案第 5 條） */
  link: string | null;
  source: string | null;
  ref_id: string | null;
  require_content: boolean;
};

/** 與 DB 端 eip_set_routine_item 的檢查同一條規則，前端先擋是為了給看得懂的訊息 */
export const ROUTINE_LINK_SHAPE = /^(https?:\/\/|file:\/\/|\\\\)/;

export type ToggleResult = {
  ok: boolean;
  log_id: string;
  status: string;
  routine_done: number;
  routine_total: number;
  /** 已勾選、但「需填執行內容」還空著的筆數（送出日誌前必須為 0） */
  missing_content: number;
};

/** 台北時區的今天（不要用 toISOString，UTC+8 會退回前一天） */
export const taipeiToday = () => new Date().toLocaleDateString("sv-SE");

/**
 * 把 Date 轉成本地(台北)日期字串 YYYY-MM-DD。
 * 這是全站唯一的「日期欄位格式化」來源——凡是要送給 DATE 欄位、或當「今天/某天」
 * 比較的字串，都用這支或 taipeiToday()，不要用 d.toISOString().slice(0,10)
 * （那是 UTC，UTC+8 在清晨或月初/月底會退回前一天，是反覆出現的時區 bug 來源）。
 */
export const toDateStr = (d: Date) => d.toLocaleDateString("sv-SE");

export const ROUTINE_SOURCE_LABEL: Record<string, string> = {
  personal_routine: "個人例行",
  recurring: "常態工作",
  task: "任務",
  meeting_action: "會議決議",
};

/**
 * 讀「今天該做的例行」（上午＋下午）與勾選狀態。
 *
 * 前端不要再自己判斷「有日誌就讀日誌、沒有就讀 seed」——那會變成第二份實作。
 * 判斷在 DB 的 eip_my_routine_today（0137）裡。
 */
export async function fetchRoutineToday(date?: string) {
  const { data, error } = await supabase.rpc("eip_my_routine_today", {
    p_date: date ?? taipeiToday(),
  });
  if (error) throw error;
  return ((data ?? []) as unknown as RoutineRow[]).slice().sort((a, b) => {
    // 上午在前、下午在後，區內照原順序
    if (a.section !== b.section) return a.section === "morning" ? -1 : 1;
    return a.sort_order - b.sort_order;
  });
}

/**
 * 設定單一例行項目的「今天有做」與／或「執行內容」。
 *
 * 唯一的寫入實作在 DB 的 eip_set_routine_item（0138）：「我的工作區」與
 * 「工作日誌」都呼叫這支，兩邊都不准自己改 work_log 的 jsonb ——
 * 同一個欄位兩份實作就是之前通知重複那件事的成因。
 *
 * done / note 傳 undefined 代表「不改這個欄位」；note 傳空字串是「清空」。
 * 當天還沒有日誌時 DB 會先用 seed 建一筆草稿，所以從工作區直接操作也存得進去
 * （原本工作日誌的勾選只改前端 state，沒按「儲存草稿」就會整批消失）。
 */
export async function setRoutineItem(args: {
  date: string;
  section: RoutineSection;
  done?: boolean;
  note?: string;
  /** 傳 undefined = 不改；傳空字串 = 清空 */
  link?: string;
  source?: string | null;
  refId?: string | null;
  text?: string | null;
}): Promise<ToggleResult> {
  const { data, error } = await supabase.rpc("eip_set_routine_item", {
    p_date: args.date,
    p_section: args.section,
    // 有 source+ref_id 就用它當鍵；手動新增的項目退回比對 text
    p_source: args.refId ? (args.source ?? "") : null,
    p_ref_id: args.refId ?? null,
    p_text: args.refId ? null : (args.text ?? null),
    p_done: args.done ?? null,
    p_note: args.note ?? null,
    p_link: args.link ?? null,
  });
  if (error) throw error;
  return data as unknown as ToggleResult;
}

/**
 * 把某一項從「今天這一筆日誌」移除。
 *
 * 注意語意：移除的是今天日誌裡的項目，**不是刪掉個人例行範本**。
 * 範本要停用或刪除請到「個人例行」頁；明天照樣會帶進來，
 * 按工作日誌的「同步今日任務」也會把它帶回來（與既有行為一致）。
 *
 * 今天還沒有日誌時直接回成功、不會建出一筆空日誌。
 */
export async function removeRoutineItem(args: {
  date: string;
  section: RoutineSection;
  source?: string | null;
  refId?: string | null;
  text?: string | null;
}): Promise<ToggleResult> {
  const { data, error } = await supabase.rpc("eip_remove_routine_item", {
    p_date: args.date,
    p_section: args.section,
    p_source: args.refId ? (args.source ?? "") : null,
    p_ref_id: args.refId ?? null,
    p_text: args.refId ? null : (args.text ?? null),
  });
  if (error) throw error;
  return data as unknown as ToggleResult;
}

/** 只改勾選的便利包裝（工作日誌的 checkbox 用） */
export async function toggleRoutineItem(args: {
  date: string;
  section: RoutineSection;
  done: boolean;
  source?: string | null;
  refId?: string | null;
  text?: string | null;
}): Promise<ToggleResult> {
  return setRoutineItem({ ...args, done: args.done });
}
