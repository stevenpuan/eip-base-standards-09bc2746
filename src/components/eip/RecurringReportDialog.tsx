import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

export type ReportField = {
  label: string;
  type: "text" | "checkbox" | "number" | "date";
};

export function RecurringReportDialog({
  open,
  onClose,
  taskId,
  recurringRuleId,
  initialData,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  taskId: string;
  recurringRuleId: string;
  initialData?: Record<string, unknown> | null;
  onDone?: () => void;
}) {
  const [fields, setFields] = useState<ReportField[]>([]);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [markDone, setMarkDone] = useState(true);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancel = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("recurring_rule")
        .select("report_fields")
        .eq("id", recurringRuleId)
        .maybeSingle();
      if (cancel) return;
      const raw = (data?.report_fields as ReportField[] | null) ?? [];
      setFields(Array.isArray(raw) ? raw : []);
      setValues((initialData as Record<string, unknown>) ?? {});
      setLoading(false);
    })();
    return () => { cancel = true; };
  }, [open, recurringRuleId, initialData]);

  const submit = async () => {
    setBusy(true);
    try {
      const patch: { report_data: Record<string, unknown>; status_id?: string; progress?: number } = {
        report_data: values,
      };
      if (markDone) {
        const { data: doneStatus } = await supabase
          .from("task_status")
          .select("id")
          .eq("is_done_state", true)
          .order("sort_order")
          .limit(1)
          .maybeSingle();
        if (doneStatus?.id) {
          patch.status_id = doneStatus.id;
          patch.progress = 100;
        }
      }
      const { error } = await supabase.from("task").update(patch).eq("id", taskId);
      if (error) throw error;
      toast.success("已回報");
      onDone?.();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "回報失敗");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>週期工作回報</DialogTitle></DialogHeader>
        {loading ? (
          <div className="text-sm text-muted-foreground py-6 text-center">載入中…</div>
        ) : fields.length === 0 ? (
          <div className="text-sm text-muted-foreground py-4">此規則未設定回報欄位，可直接標記完成。</div>
        ) : (
          <div className="space-y-3">
            {fields.map((f, i) => (
              <div key={i} className="space-y-1.5">
                <Label>{f.label}</Label>
                {f.type === "checkbox" ? (
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={!!values[f.label]}
                      onCheckedChange={(v) => setValues((s) => ({ ...s, [f.label]: !!v }))}
                    />
                    <span className="text-sm text-muted-foreground">是</span>
                  </div>
                ) : (
                  <Input
                    type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                    value={(values[f.label] as string | number | undefined) ?? ""}
                    onChange={(e) => setValues((s) => ({ ...s, [f.label]: e.target.value }))}
                  />
                )}
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2 pt-2 border-t mt-2">
          <Checkbox id="rrd-done" checked={markDone} onCheckedChange={(v) => setMarkDone(!!v)} />
          <Label htmlFor="rrd-done" className="cursor-pointer">送出後標記為完成</Label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>取消</Button>
          <Button onClick={submit} disabled={busy}>{busy ? "送出中…" : "送出回報"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
