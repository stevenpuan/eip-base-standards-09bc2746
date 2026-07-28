// eip_my_routine_today / eip_toggle_routine_item 尚未進 types.ts，用寬鬆型別的 client
import { supabase } from "@/lib/supabase";

export type RoutineSection = "morning" | "afternoon" | "special";

export type RoutineRow = {
  section: RoutineSection;
  sort_order: number;
  text: string;
  done: boolean;
  note: string | null;
  source: string | null;
  ref_id: string | null;
  require_content: boolean;
};

export type ToggleResult = {
  ok: boolean;
  log_id: string;
  status: string;
  routine_done: number;
  routine_total: number;
};

/** 台北時區的今天（不要用 toISOString，UTC+8 會退回前一天） */
export const taipeiToday = () => new Date().toLocaleDateString("sv-SE");

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
 * 勾選／取消「今天有做」。
 *
 * 唯一的寫入實作在 DB 的 eip_toggle_routine_item（0137）：「我的工作區」與
 * 「工作日誌」都呼叫這支，兩邊都不准自己改 work_log 的 jsonb ——
 * 同一個欄位兩份實作就是之前通知重複那件事的成因。
 *
 * 當天還沒有日誌時 DB 會先用 seed 建一筆草稿，所以從工作區直接勾也存得進去
 * （原本工作日誌的勾選只改前端 state，沒按「儲存草稿」就會整批消失）。
 */
export async function toggleRoutineItem(args: {
  date: string;
  section: RoutineSection;
  done: boolean;
  source?: string | null;
  refId?: string | null;
  text?: string | null;
}): Promise<ToggleResult> {
  const { data, error } = await supabase.rpc("eip_toggle_routine_item", {
    p_date: args.date,
    p_section: args.section,
    p_done: args.done,
    // 有 source+ref_id 就用它當鍵；手動新增的項目退回比對 text
    p_source: args.refId ? (args.source ?? "") : null,
    p_ref_id: args.refId ?? null,
    p_text: args.refId ? null : (args.text ?? null),
  });
  if (error) throw error;
  return data as unknown as ToggleResult;
}
