import { useMemo } from "react";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export type VisibilityScope = "company" | "department";

interface DeptLite {
  id: string;
  name: string;
  parent_id?: string | null;
  sort_order?: number | null;
}

const INDENT = "\u00A0\u00A0\u00A0\u00A0";

/** 依 parent_id 組成樹，回傳已扁平化的選項（含縮排），依 sort_order 排序。 */
export function buildDeptTreeOptions<T extends DeptLite>(
  depts: T[],
): { id: string; label: string; depth: number; dept: T }[] {
  const byParent = new Map<string | null, T[]>();
  for (const d of depts) {
    const k = (d.parent_id ?? null) as string | null;
    const arr = byParent.get(k) ?? [];
    arr.push(d);
    byParent.set(k, arr);
  }
  for (const arr of byParent.values()) {
    arr.sort(
      (a, b) =>
        (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
        a.name.localeCompare(b.name, "zh-Hant"),
    );
  }
  const out: { id: string; label: string; depth: number; dept: T }[] = [];
  const idSet = new Set(depts.map((d) => d.id));
  const walk = (parent: string | null, depth: number) => {
    const list = byParent.get(parent) ?? [];
    for (const d of list) {
      out.push({ id: d.id, label: INDENT.repeat(depth) + d.name, depth, dept: d });
      walk(d.id, depth + 1);
    }
  };
  // 真正的頂層 = parent_id 為 null 或指向不存在於本清單的節點
  walk(null, 0);
  for (const [parent, list] of byParent.entries()) {
    if (parent && !idSet.has(parent)) {
      for (const d of list) {
        out.push({ id: d.id, label: d.name, depth: 0, dept: d });
        walk(d.id, 1);
      }
    }
  }
  return out;
}

/** 共用「可見範圍」欄位（下拉 + 條件式部門下拉）。 */
export function VisibilityScopeFields({
  scope, onScopeChange, deptId, onDeptIdChange, departments, disabled,
}: {
  scope: VisibilityScope;
  onScopeChange: (v: VisibilityScope) => void;
  deptId: string | null;
  onDeptIdChange: (id: string | null) => void;
  departments: DeptLite[];
  disabled?: boolean;
}) {
  const options = useMemo(() => buildDeptTreeOptions(departments), [departments]);
  return (
    <div className="grid gap-2">
      <div className="grid gap-1.5">
        <Label className="text-xs text-muted-foreground">可見範圍</Label>
        <Select
          value={scope}
          onValueChange={(v) => {
            const s = v as VisibilityScope;
            onScopeChange(s);
            if (s === "company") onDeptIdChange(null);
          }}
          disabled={disabled}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="company">全公司</SelectItem>
            <SelectItem value="department">部門</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {scope === "department" && (
        <div className="grid gap-1.5">
          <Label className="text-xs text-muted-foreground">部門 <span className="text-destructive">*</span></Label>
          <Select
            value={deptId ?? ""}
            onValueChange={(v) => onDeptIdChange(v || null)}
            disabled={disabled}
          >
            <SelectTrigger><SelectValue placeholder="選擇部門" /></SelectTrigger>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="text-[11px] text-muted-foreground">
            選擇部門後，該部門及其上層主管可見；其他部門看不到。
          </div>
        </div>
      )}
    </div>
  );
}

/** 列表/卡片用標籤：company → 全公司；department → 顯示部門名稱。 */
export function VisibilityBadge({
  scope, departmentId, deptMap, className,
}: {
  scope: VisibilityScope | string | null | undefined;
  departmentId: string | null | undefined;
  deptMap: Map<string, { name: string }>;
  className?: string;
}) {
  if (scope === "company") {
    return (
      <Badge
        variant="outline"
        className={`text-[10px] bg-blue-50 text-blue-700 border-blue-200 ${className ?? ""}`}
      >
        全公司
      </Badge>
    );
  }
  if (scope === "department") {
    const name = departmentId ? deptMap.get(departmentId)?.name ?? "部門" : "未指定部門";
    return (
      <Badge
        variant="outline"
        className={`text-[10px] bg-slate-100 text-slate-700 border-slate-200 ${className ?? ""}`}
      >
        {name}
      </Badge>
    );
  }
  return null;
}

/** 表單送出前的可見範圍驗證；通過回傳 payload 片段，失敗回傳 error 訊息。 */
export function validateVisibility(
  scope: VisibilityScope,
  deptId: string | null,
): { ok: true; payload: { visibility_scope: VisibilityScope; department_id: string | null } } | { ok: false; error: string } {
  if (scope === "department" && !deptId) {
    return { ok: false, error: "請選擇部門" };
  }
  return {
    ok: true,
    payload: {
      visibility_scope: scope,
      department_id: scope === "department" ? deptId : null,
    },
  };
}
