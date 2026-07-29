// 預設租戶 ID（資料庫 seed 已建立）。
export const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000001";

export const ROLE_LABEL: Record<string, string> = {
  company_admin: "公司管理員",
  dept_manager: "部門主管",
  member: "成員",
  viewer: "唯讀",
};

export const STATUS_LABEL: Record<string, string> = {
  active: "啟用",
  inactive: "停用",
};

export const PRIORITY_LABEL: Record<string, string> = {
  low: "低",
  normal: "一般",
  high: "高",
  urgent: "緊急",
};

/**
 * 請假單（eip_quick_report type='leave'）視為「已結案」的 status 集合。
 *
 * **不含 acknowledged**：那是舊制「主管已確認」留下的值（正式庫現有請假單大多是它），
 * 新制沒有核准這件事，status 由 eip_lhi_rollup 依代辦完成度推導。把 acknowledged
 * 當成已結案會讓那些單在前端整塊唯讀（代理人不能改、代辦不能增刪），功能對現有資料全滅。
 *
 * 「交接代辦」頁與「臨時回報」頁**必須共用這一份**，兩邊各留一份就會漂移。
 */
export const LEAVE_DONE_STATUSES = new Set(["done", "closed"]);

export const PRIORITY_COLOR: Record<string, string> = {
  low: "bg-slate-100 text-slate-700",
  normal: "bg-blue-100 text-blue-700",
  high: "bg-amber-100 text-amber-700",
  urgent: "bg-red-100 text-red-700",
};
