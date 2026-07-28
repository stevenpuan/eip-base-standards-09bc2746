/**
 * 外部連結（NAS 路徑 / 網址）的共用判定與格式。
 *
 * 為什麼要抽出來：`\\server\share` 這種 UNC 路徑瀏覽器不允許用 <a href> 開啟，
 * 而且 URL parser 會把 `\` 正規化成 `/` —— href="\\nas\品保" 會變成
 * protocol-relative 的 //nas/品保，實際開到 https://nas/品保 的錯誤頁。
 * `file://` 從 https 頁面點也會被瀏覽器靜默封鎖。
 * 這兩種一律要走「複製路徑」，不能給一個點了沒反應的連結。
 * 三個地方都要用同一份判定（任務／異常詳情、請假代辦、工作區代辦卡），
 * 所以放在這裡而不是各自寫一份。
 */

/** DB 端的 check constraint 只要求一個反斜線，這裡對齊，不要比 DB 嚴 */
export const EXTERNAL_URL_SHAPE = /^(https?:\/\/|file:\/\/|\\)/;

export const EXTERNAL_URL_MAX = 2000;

/** UNC（\\server\share）與 file:// 都算「本機／網路磁碟路徑」，不能當超連結開 */
export function isLocalPath(url: string): boolean {
  return url.startsWith("\\") || url.toLowerCase().startsWith("file://");
}

/** 回傳 null＝格式沒問題；否則是給使用者看的錯誤訊息 */
export function validateExternalUrl(raw: string): string | null {
  const u = raw.trim();
  if (!u) return "請輸入連結";
  if (!EXTERNAL_URL_SHAPE.test(u)) {
    return "連結格式不對：請用 http(s)://、file:// 或 \\\\伺服器\\分享資料夾";
  }
  if (u.length > EXTERNAL_URL_MAX) return `連結最多 ${EXTERNAL_URL_MAX} 字`;
  return null;
}

/** 複製到剪貼簿；沒有 clipboard 權限（http 或舊瀏覽器）時把路徑顯示出來讓人手動複製 */
export async function copyPath(
  url: string,
  onOk: (msg: string) => void,
  onFallback: (msg: string) => void,
) {
  try {
    await navigator.clipboard.writeText(url);
    onOk("已複製路徑，貼到檔案總管即可開啟");
  } catch {
    onFallback(url);
  }
}
