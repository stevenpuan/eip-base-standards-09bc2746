import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Link2 } from "lucide-react";
import { toast } from "sonner";

// eip_leave_handover_item 與 eip_quick_report.deputy_id 尚未進 types.ts，用寬鬆型別的 client
import { supabase } from "@/lib/supabase";
import { useEipUser } from "@/lib/eip-user";
import { useActiveUsers } from "@/hooks/useUsers";
import { validateExternalUrl } from "@/lib/eip-url";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const NO_ASSIGNEE = "__none__";

type Draft = { key: string; title: string; assigneeId: string; url: string };

/** 本地日期字串；toISOString() 在 UTC+8 會退回前一天，不能用 */
const todayLocal = () => new Date().toLocaleDateString("sv-SE");

/** 把「日期 + 時間」組成帶時區位移的 timestamptz，避免被當成 UTC */
function stamp(date: string, time: string) {
  const d = new Date(`${date}T${time}:00`);
  const p = (n: number) => String(n).padStart(2, "0");
  const offMin = -d.getTimezoneOffset();
  const abs = Math.abs(offMin);
  return (
    `${date}T${time}:00` +
    `${offMin >= 0 ? "+" : "-"}${p(Math.floor(abs / 60))}:${p(abs % 60)}`
  );
}

let seq = 0;
const newKey = () => `d${++seq}`;

/**
 * 請假申請 ＋ 代辦事項清單（規格書 H、原型 H-1）。
 *
 * 三個刻意的設計決定，對應訪談定案：
 *  ・**沒有假別、沒有事由** —— EZ9 已有正式假單，EIP 只管交接，避免兩套資料
 *    （定案第 13 條）。舊資料的 leave_type 欄位保留但不再有輸入入口。
 *  ・**代理人是每次請假指定**（存 eip_quick_report.deputy_id），
 *    不是 app_user.deputy_id 那個靜態代理人（那是通知副本用）。
 *  ・**主管不核准、不簽核**（定案第 14 條）：送出只發通知給單位主管與代理人，
 *    這個表單裡不會有任何「送審」的概念。
 *
 * 代辦清單跟請假單一起送出，因為代理人要的是「哪幾件事要接手」，
 * 分兩步做的話多數人只會做第一步。
 */
export function LeaveRequestDialog({
  open,
  onClose,
  onSubmitted,
}: {
  open: boolean;
  onClose: () => void;
  onSubmitted?: () => void;
}) {
  const { appUser } = useEipUser();
  const qc = useQueryClient();
  const usersQ = useActiveUsers();

  const [fromDate, setFromDate] = useState(todayLocal());
  const [toDate, setToDate] = useState(todayLocal());
  const [fromTime, setFromTime] = useState("08:00");
  const [toTime, setToTime] = useState("17:30");
  const [deputyId, setDeputyId] = useState<string>(NO_ASSIGNEE);
  const [items, setItems] = useState<Draft[]>([{ key: newKey(), title: "", assigneeId: NO_ASSIGNEE, url: "" }]);
  const [busy, setBusy] = useState(false);

  const others = (usersQ.data ?? []).filter((u) => u.id !== appUser?.id);

  const patch = (key: string, p: Partial<Draft>) =>
    setItems((prev) => prev.map((x) => (x.key === key ? { ...x, ...p } : x)));

  const reset = () => {
    setFromDate(todayLocal());
    setToDate(todayLocal());
    setFromTime("08:00");
    setToTime("17:30");
    setDeputyId(NO_ASSIGNEE);
    setItems([{ key: newKey(), title: "", assigneeId: NO_ASSIGNEE, url: "" }]);
  };

  const submit = async () => {
    if (!appUser?.id || busy) return;
    if (!fromDate || !toDate) return toast.error("請選擇請假區間");
    if (toDate < fromDate) return toast.error("迄日不可早於起日");
    if (fromDate === toDate && toTime <= fromTime) return toast.error("同一天的迄時要晚於起時");
    if (deputyId === NO_ASSIGNEE) return toast.error("請指定這次請假的代理人");

    const filled = items.filter((x) => x.title.trim());
    for (const it of filled) {
      const u = it.url.trim();
      if (u) {
        const bad = validateExternalUrl(u);
        if (bad) return toast.error(`「${it.title.trim()}」的${bad}`);
      }
    }

    setBusy(true);
    // 送出即通知（單位主管＋代理人），不進任何簽核流程
    const { data: rep, error } = await supabase
      .from("eip_quick_report")
      .insert({
        type: "leave",
        report_date: fromDate,
        leave_from: stamp(fromDate, fromTime),
        leave_to: stamp(toDate, toTime),
        deputy_id: deputyId,
        submitted_at: new Date().toISOString(),
      })
      .select("id")
      .maybeSingle();

    if (error || !rep?.id) {
      setBusy(false);
      return toast.error(`送出失敗：${error?.message ?? "沒有取得單號，請重試"}`);
    }

    // 代辦項目是附帶寫入：失敗不該讓請假單消失，但也絕對不能照跳成功
    let itemErr: string | null = null;
    if (filled.length) {
      const { error: ie } = await supabase.from("eip_leave_handover_item").insert(
        filled.map((x, i) => ({
          quick_report_id: rep.id,
          title: x.title.trim(),
          // 沒指定就掛給這次的代理人（DB trigger 也會補，這裡先寫清楚語意）
          assignee_id: x.assigneeId === NO_ASSIGNEE ? deputyId : x.assigneeId,
          url: x.url.trim() || null,
          sort_order: i + 1,
        })),
      );
      if (ie) itemErr = ie.message;
    }
    setBusy(false);

    if (itemErr) {
      toast.warning(`請假已送出，但代辦事項沒有存進去（${itemErr}），請到臨時回報頁補上`);
    } else if (filled.length === 0) {
      toast.success("請假已送出（沒有代辦事項，可直接在清單頁結案）");
    } else {
      toast.success(`請假已送出，${filled.length} 項代辦已通知代理人`);
    }

    void qc.invalidateQueries({ queryKey: ["eip", "quick-reports"] });
    void qc.invalidateQueries({ queryKey: ["eip", "leave-handover-inbox"] });
    reset();
    onSubmitted?.();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>請假申請 ＋ 代辦事項清單</DialogTitle>
          <DialogDescription>
            送出後不需主管核准，系統會直接通知單位主管與代理人。
            假別與事由請走 EZ9 正式假單，這裡只處理期間的工作交接。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* 區間 ＋ 代理人 */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">請假起日 / 時間</Label>
              <div className="flex gap-2 mt-1">
                <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="h-9" />
                <Input type="time" value={fromTime} onChange={(e) => setFromTime(e.target.value)} className="h-9 w-28" />
              </div>
            </div>
            <div>
              <Label className="text-xs">請假迄日 / 時間</Label>
              <div className="flex gap-2 mt-1">
                <Input type="date" value={toDate} min={fromDate} onChange={(e) => setToDate(e.target.value)} className="h-9" />
                <Input type="time" value={toTime} onChange={(e) => setToTime(e.target.value)} className="h-9 w-28" />
              </div>
            </div>
          </div>

          <div>
            <Label className="text-xs">代理人（必填，這一次請假的代理人）</Label>
            <Select value={deputyId} onValueChange={setDeputyId}>
              <SelectTrigger className="h-9 mt-1">
                <SelectValue placeholder="選擇代理人…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_ASSIGNEE}>未指定</SelectItem>
                {others.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {usersQ.isError && (
              <p className="text-[11px] text-destructive mt-1">
                人員清單載入失敗，請重新整理後再送出，否則代理人會是空的。
              </p>
            )}
          </div>

          {/* 代辦清單 */}
          <div className="rounded-md border p-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm font-medium">代辦事項清單</span>
              <span className="text-[11px] text-muted-foreground">
                每一項可以單獨指派給不同人；留空的列不會送出
              </span>
              <div className="flex-1" />
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => setItems((p) => [...p, { key: newKey(), title: "", assigneeId: NO_ASSIGNEE, url: "" }])}
              >
                <Plus className="w-3.5 h-3.5 mr-1" />
                新增
              </Button>
            </div>

            <div className="space-y-2">
              {items.map((it) => (
                <div key={it.key} className="grid gap-2 sm:grid-cols-[1fr_140px_1fr_32px] items-center">
                  <Input
                    placeholder="代辦事項（例如：加工部排程表更新）"
                    value={it.title}
                    onChange={(e) => patch(it.key, { title: e.target.value })}
                    className="h-9 text-sm"
                  />
                  <Select value={it.assigneeId} onValueChange={(v) => patch(it.key, { assigneeId: v })}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="指派" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_ASSIGNEE}>同代理人</SelectItem>
                      {others.map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="relative">
                    <Link2 className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="連結（選填）\\NAS\… 或 https://…"
                      value={it.url}
                      onChange={(e) => patch(it.key, { url: e.target.value })}
                      className="h-9 pl-7 text-xs font-mono"
                    />
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0"
                    disabled={items.length === 1}
                    onClick={() => setItems((p) => p.filter((x) => x.key !== it.key))}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              代理人在「我的工作」就能勾完成，完成度即時回傳給你與單位主管；全部完成時系統自動發第二段通知。
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? "送出中…" : "送出申請"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
