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

export const PRIORITY_COLOR: Record<string, string> = {
  low: "bg-slate-100 text-slate-700",
  normal: "bg-blue-100 text-blue-700",
  high: "bg-amber-100 text-amber-700",
  urgent: "bg-red-100 text-red-700",
};
