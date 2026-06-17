import * as XLSX from "xlsx";

export function exportToExcel<T extends Record<string, unknown>>(opts: {
  filename: string; // 例如 "任務"
  sheetName?: string;
  rows: T[];
  columns: { header: string; key: keyof T | string; map?: (row: T) => unknown }[];
}) {
  const { filename, sheetName = "Sheet1", rows, columns } = opts;
  const data = rows.map((r) => {
    const o: Record<string, unknown> = {};
    columns.forEach((c) => {
      o[c.header] = c.map ? c.map(r) : (r as Record<string, unknown>)[c.key as string] ?? "";
    });
    return o;
  });
  const ws = XLSX.utils.json_to_sheet(data, {
    header: columns.map((c) => c.header),
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  XLSX.writeFile(wb, `${filename}_${stamp}.xlsx`);
}
