/**
 * 全站錯誤訊息轉譯層。
 *
 * 為什麼要有這一層：先前各頁面都是 `toast.error(error.message)`，使用者實際看到的是
 * `duplicate key value violates unique constraint "work_log_tenant_id_user_id_log_date_key"`
 * 這種字串 —— 一般同仁只會覺得系統壞了，既不知道自己做錯什麼，也不知道下一步該做什麼。
 * 逐頁寫 if-else 一定會漂移，所以判斷集中在這裡，各頁面只負責提供「動作名稱」當 ctx。
 *
 * 判斷順序（由可靠到不可靠）：
 *   1. `code`（SQLSTATE / PostgREST code）—— 最可靠的訊號
 *   2. constraint 名稱（藏在 message／details 裡）—— 同一個 code 可以再細分
 *   3. 已經是人寫給人看的中文（P0001、前端自己 throw 的 Error）—— 原樣透出
 *   4. 網路層（沒有 code ＋ Failed to fetch）
 *   5. 其他 —— 保留代碼，讓維護者事後查得到
 */

/** 從各種錯誤物件裡抽出我們需要的欄位；PostgrestError / AuthError / StorageError 形狀都吃 */
type ErrShape = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
  /** HTTP 狀態碼，只在完全沒有 code 時當備援代碼用 */
  status?: number;
  /** 是不是「原生 Error 實例、而且沒有任何 code」—— 這種通常是前端自己 throw 的 */
  plainError: boolean;
};

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function shapeOf(err: unknown, depth = 0): ErrShape {
  if (!err || typeof err !== "object") {
    return { message: typeof err === "string" ? err : undefined, plainError: false };
  }
  const o = err as Record<string, unknown>;
  // 有些呼叫端拿到的是 `{ error: PostgrestError }`（例如 rpc 包裝、functions.invoke 的回傳），
  // 外層自己沒有 code／message，要往內鑽一層才看得到真正的錯誤。
  if (depth < 2 && o.error && typeof o.error === "object" && !str(o.code) && !str(o.message)) {
    return shapeOf(o.error, depth + 1);
  }
  const code = str(o.code);
  return {
    code,
    message: str(o.message),
    details: str(o.details),
    hint: str(o.hint),
    status: num(o.status) ?? num(o.statusCode),
    plainError: err instanceof Error && !code,
  };
}

/**
 * constraint 名稱 → 具體訊息。
 *
 * constraint 名稱可能出現在 message（unique/check violation）或 details（部分 FK 錯誤），
 * 所以比對時把 message + details + hint 併成一個字串一起找。
 */
const CONSTRAINT_MESSAGES: ReadonlyArray<readonly [RegExp, string]> = [
  [
    /work_log_live_tenant_user_date|work_log_tenant_id_user_id_log_date/,
    "今天的工作日誌已經存在了，請重新整理頁面再操作",
  ],
  [
    /(?:lhi_)?url_shape/,
    "連結格式不正確。請用 http://、https:// 或 \\\\伺服器\\分享資料夾 的路徑",
  ],
  [/eip_link_no_self/, "不能把項目連結到自己"],
  [/task_progress_check/, "進度必須在 0 到 100 之間"],
  [/leave_no_acknowledged/, "請假單的狀態不正確，請重新載入頁面"],
  [/personal_routine_freq|time_slot/, "週期或時段的選項不正確，請重新選擇"],
  [/task_collaborator_pkey/, "這個人已經是協作者了"],
  [/eip_dept_supervisor_pkey/, "這個人已經登記為該部門的督導"],
];

/** code → 訊息。不含需要再看 constraint 的 23505／23514，也不含要原樣透出的 P0001。 */
const CODE_MESSAGES: Readonly<Record<string, string>> = {
  "42501": "沒有權限執行這個動作",
  "23503": "關聯的資料已被刪除或不存在，請重新載入頁面",
  "23502": "有必填欄位沒有填",
  "22P02": "輸入的格式不正確",
  "22007": "輸入的格式不正確",
  PGRST116: "找不到資料，可能已被刪除，請重新載入",
  // JWT 過期／無效。上線後長時間掛在頁面上很容易踩到，落到通用文案會變成
  // 「操作失敗（代碼 PGRST301）」，使用者不會想到只是要重新登入。
  PGRST301: "登入已逾時，請重新登入後再操作",
  "40001": "同時有人在改這筆資料，請重試一次",
  "40P01": "同時有人在改這筆資料，請重試一次",
  "57014": "查詢時間過長，請縮小範圍或稍後再試",
};

/** Supabase Auth 的 code 是英文字串，錯誤訊息也是英文，登入／註冊頁直接透出對使用者沒意義 */
const AUTH_CODE_MESSAGES: Readonly<Record<string, string>> = {
  invalid_credentials: "帳號或密碼不正確，請重新輸入",
  email_not_confirmed: "這個信箱還沒完成驗證，請先收信點開驗證連結",
  user_already_exists: "這個信箱已經註冊過了，請直接登入或改用忘記密碼",
  email_exists: "這個信箱已經註冊過了，請直接登入或改用忘記密碼",
  weak_password: "密碼強度不足，請改用較長且混合字母數字的密碼",
  over_request_rate_limit: "嘗試次數太多，請等幾分鐘後再試",
  over_email_send_rate_limit: "寄信次數太多，請等幾分鐘後再試",
  same_password: "新密碼不能和舊密碼相同",
  session_expired: "登入已逾時，請重新登入",
  session_not_found: "登入已逾時，請重新登入",
};

const NETWORK_HINT = /Failed to fetch|NetworkError|network ?error|ERR_NETWORK|ERR_INTERNET_DISCONNECTED|Load failed|fetch failed/i;

/** 含中日韓文字＝已經是人寫給人看的訊息，不要再包裝 */
const HAS_CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

/** 訊息看起來真的是 constraint 違反（code 掉了才會走這條，別把巧合含 constraint 名的訊息也認進來） */
const LOOKS_LIKE_CONSTRAINT = /constraint|violat/i;

function constraintMessage(haystack: string): string | undefined {
  for (const [re, msg] of CONSTRAINT_MESSAGES) {
    if (re.test(haystack)) return msg;
  }
  return undefined;
}

/** ctx 有值就變成「<動作>失敗：<原因>」，沒有就只給原因 */
function withCtx(body: string, ctx?: string): string {
  const c = ctx?.trim();
  return c ? `${c}失敗：${body}` : body;
}

/**
 * 把任何錯誤翻成一句同仁看得懂、而且知道下一步怎麼做的中文。
 *
 * @param err 任意錯誤：PostgrestError、AuthError、StorageError、Error、字串都可以
 * @param ctx 當下的動作名稱（「儲存日誌」「建立任務」「送出請假」…），會變成訊息前綴
 *
 * @example humanizeError(e, "儲存日誌") // 「儲存日誌失敗：沒有權限執行這個動作」
 */
export function humanizeError(err: unknown, ctx?: string): string {
  const e = shapeOf(err);
  const haystack = [e.message, e.details, e.hint].filter(Boolean).join(" ");

  // P0001 是後端 `raise exception` 的自訂訊息，本來就是刻意寫給使用者看的中文
  // （例：「有協同者、變更紀錄或進度回報的任務不可永久刪除」）。
  // 這種訊息比我們任何轉譯都精確，一定要原樣透出；連 ctx 前綴都不加，
  // 否則會變成「刪除失敗：有協同者…不可永久刪除」這種話中有話、反而模糊。
  if (e.code === "P0001") {
    if (e.message) return e.message;
  }

  // 前端自己 throw 的 Error（`throw new Error("尚未取得 EIP 身分")`）同理：
  // 沒有 code、訊息含中文 ⇒ 是我們自己寫給使用者的，原樣透出。
  if (e.plainError && e.message && HAS_CJK.test(e.message)) return e.message;

  if (e.code === "23505") {
    return withCtx(constraintMessage(haystack) ?? "這筆資料已經存在，請重新整理頁面確認後再操作", ctx);
  }

  if (e.code === "23514") {
    return withCtx(constraintMessage(haystack) ?? "填寫的內容不符合規則，請檢查後重新填寫", ctx);
  }

  if (e.code && CODE_MESSAGES[e.code]) {
    return withCtx(CODE_MESSAGES[e.code], ctx);
  }

  if (e.code && AUTH_CODE_MESSAGES[e.code]) {
    return withCtx(AUTH_CODE_MESSAGES[e.code], ctx);
  }

  // 有時候 code 沒帶到，但 constraint 名稱還在訊息裡（例如經過 RPC 再拋出來的錯誤）
  if (LOOKS_LIKE_CONSTRAINT.test(haystack)) {
    const byConstraint = constraintMessage(haystack);
    if (byConstraint) return withCtx(byConstraint, ctx);
  }

  // 網路層：沒有 code，訊息是瀏覽器 fetch 失敗的字樣
  if (!e.code && haystack && NETWORK_HINT.test(haystack)) {
    return withCtx("連線中斷，請確認網路後重試", ctx);
  }

  // 其他一律保留代碼 —— 把代碼藏掉，之後使用者回報「就是失敗」時就完全查不到問題。
  const label = e.code ?? (e.status !== undefined ? `HTTP ${e.status}` : undefined);
  return withCtx(
    label
      ? `操作失敗（代碼 ${label}）。若持續發生請把這個代碼提供給系統維護者`
      : "操作失敗，請稍後再試。若持續發生請聯絡系統維護者",
    ctx,
  );
}
