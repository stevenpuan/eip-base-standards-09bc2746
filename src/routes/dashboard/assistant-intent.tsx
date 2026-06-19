import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type KeyboardEvent } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Pencil, Trash2, X, Plus } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/dashboard/assistant-intent")({ component: Page });

const MODULE_KEY = "assistant_intent";
const TOOL_HINTS = [
  "get_my_work_summary",
  "list_my_tasks",
  "list_my_projects",
  "list_announcements",
  "search_documents",
];

interface IntentRow {
  id: string;
  feature: string;
  keywords: string[];
  example_questions: string[];
  intent: string | null;
  in_line_assistant: boolean;
  web_route: string | null;
  note: string | null;
  sort_order: number;
  tenant_id: string;
}

interface FormState {
  id?: string;
  feature: string;
  keywords: string[];
  example_questions: string[];
  intent: string;
  in_line_assistant: boolean;
  web_route: string;
  note: string;
  sort_order: number;
}

const emptyForm: FormState = {
  feature: "",
  keywords: [],
  example_questions: [],
  intent: "",
  in_line_assistant: true,
  web_route: "",
  note: "",
  sort_order: 10,
};

function Page() {
  const { user, can } = useAuth();
  const qc = useQueryClient();
  const canView = can(MODULE_KEY, "view");
  const canEdit = can(MODULE_KEY, "edit");

  const { data: tenantId } = useQuery({
    queryKey: ["assistant-intent-tenant", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("app_user")
        .select("tenant_id")
        .eq("id", user!.id)
        .maybeSingle();
      return (data?.tenant_id as string | undefined) ?? null;
    },
  });

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["assistant_intent_all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("eip_assistant_intent")
        .select("*")
        .order("sort_order");
      if (error) throw error;
      return data as IntentRow[];
    },
  });
  const reload = () => qc.invalidateQueries({ queryKey: ["assistant_intent_all"] });

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const isEditing = !!form.id;

  const openCreate = () => {
    const nextOrder = rows.length ? Math.max(...rows.map((r) => r.sort_order)) + 10 : 10;
    setForm({ ...emptyForm, sort_order: nextOrder });
    setFormOpen(true);
  };
  const openEdit = (r: IntentRow) => {
    setForm({
      id: r.id,
      feature: r.feature,
      keywords: r.keywords ?? [],
      example_questions: r.example_questions ?? [],
      intent: r.intent ?? "",
      in_line_assistant: r.in_line_assistant,
      web_route: r.web_route ?? "",
      note: r.note ?? "",
      sort_order: r.sort_order,
    });
    setFormOpen(true);
  };

  const save = async () => {
    if (!form.feature.trim()) {
      toast.error("請填寫功能名稱");
      return;
    }
    const payload = {
      feature: form.feature.trim(),
      keywords: form.keywords,
      example_questions: form.example_questions,
      intent: form.intent.trim() || null,
      in_line_assistant: form.in_line_assistant,
      web_route: form.web_route.trim() || null,
      note: form.note.trim() || null,
      sort_order: form.sort_order,
    };
    if (isEditing) {
      const { error } = await supabase
        .from("eip_assistant_intent")
        .update(payload)
        .eq("id", form.id!);
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("已更新");
    } else {
      if (!tenantId) {
        toast.error("找不到使用者所屬租戶");
        return;
      }
      const { error } = await supabase
        .from("eip_assistant_intent")
        .insert({ ...payload, tenant_id: tenantId });
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("已新增");
    }
    setFormOpen(false);
    reload();
  };

  const del = async (r: IntentRow) => {
    if (!confirm(`確定刪除「${r.feature}」？`)) return;
    const { error } = await supabase.from("eip_assistant_intent").delete().eq("id", r.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("已刪除");
    reload();
  };

  if (!canView) {
    return <div className="text-sm text-muted-foreground">沒有權限檢視此頁。</div>;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI 助理關鍵字"
        description="維護 AI 助理(LINE/網頁)用來判斷使用者意圖的關鍵字"
        actions={
          canEdit ? (
            <Button onClick={openCreate}>
              <Plus className="w-4 h-4 mr-1" />
              新增關鍵字
            </Button>
          ) : undefined
        }
      />

      <div className="text-sm text-muted-foreground bg-muted/40 border rounded-md px-4 py-3">
        這裡的關鍵字決定 AI 助理如何判斷使用者的問題。修改後即時生效,不需重新部署。
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">載入中…</p>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            尚未建立任何關鍵字
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0 divide-y">
            {rows.map((r) => (
              <div
                key={r.id}
                className="p-4 flex flex-col md:flex-row md:items-start gap-3 hover:bg-muted/30 transition-colors"
              >
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{r.feature}</span>
                    {r.in_line_assistant ? (
                      <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-emerald-200">
                        LINE 可查
                      </Badge>
                    ) : (
                      <Badge variant="secondary">導網頁</Badge>
                    )}
                    {r.intent && (
                      <span className="text-xs text-muted-foreground font-mono">
                        → {r.intent}
                      </span>
                    )}
                  </div>
                  {r.keywords?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {r.keywords.map((k, i) => (
                        <span
                          key={i}
                          className="px-2 py-0.5 text-xs rounded-full bg-primary/10 text-primary border border-primary/20"
                        >
                          {k}
                        </span>
                      ))}
                    </div>
                  )}
                  {r.example_questions?.length > 0 && (
                    <div className="text-xs text-muted-foreground">
                      範例:{r.example_questions.join("、")}
                    </div>
                  )}
                  {r.web_route && (
                    <div className="text-xs text-muted-foreground">
                      路徑:<span className="font-mono">{r.web_route}</span>
                    </div>
                  )}
                  {r.note && <div className="text-xs text-muted-foreground">備註:{r.note}</div>}
                </div>
                {canEdit && (
                  <div className="flex md:flex-col gap-2 shrink-0">
                    <Button size="sm" variant="outline" onClick={() => openEdit(r)}>
                      <Pencil className="w-3.5 h-3.5 mr-1" />
                      編輯
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive hover:text-destructive"
                      onClick={() => del(r)}
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-1" />
                      刪除
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <FormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        form={form}
        setForm={setForm}
        onSave={save}
        isEditing={isEditing}
      />
    </div>
  );
}

function FormDialog({
  open,
  onOpenChange,
  form,
  setForm,
  onSave,
  isEditing,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  form: FormState;
  setForm: (f: FormState) => void;
  onSave: () => void;
  isEditing: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? "編輯關鍵字" : "新增關鍵字"}</DialogTitle>
          <DialogDescription>設定 AI 助理判斷使用者意圖的關鍵字與對應行為。</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>功能名稱 *</Label>
            <Input
              value={form.feature}
              onChange={(e) => setForm({ ...form, feature: e.target.value })}
              placeholder="例如:我的任務"
            />
          </div>

          <div className="space-y-1.5">
            <Label>關鍵字</Label>
            <TagInput
              value={form.keywords}
              onChange={(v) => setForm({ ...form, keywords: v })}
              placeholder="輸入後按 Enter 新增"
            />
          </div>

          <div className="space-y-1.5">
            <Label>範例問句</Label>
            <TagInput
              value={form.example_questions}
              onChange={(v) => setForm({ ...form, example_questions: v })}
              placeholder="例如:我今天有什麼任務?"
            />
          </div>

          <div className="flex items-center justify-between rounded-md border px-3 py-2">
            <div>
              <div className="text-sm font-medium">LINE 可直接查</div>
              <div className="text-xs text-muted-foreground">
                開啟後 LINE 可直接回答,否則導到網頁
              </div>
            </div>
            <Switch
              checked={form.in_line_assistant}
              onCheckedChange={(v) => setForm({ ...form, in_line_assistant: v })}
            />
          </div>

          <div className="space-y-1.5">
            <Label>對應 (intent)</Label>
            <Input
              value={form.intent}
              onChange={(e) => setForm({ ...form, intent: e.target.value })}
              placeholder={form.in_line_assistant ? "填工具名,如 list_my_tasks" : "填 web:頁面,如 web:會議"}
            />
            {form.in_line_assistant && (
              <p className="text-xs text-muted-foreground">
                可用工具:{TOOL_HINTS.join("、")}
              </p>
            )}
          </div>

          {!form.in_line_assistant && (
            <div className="space-y-1.5">
              <Label>網頁路徑 (web_route)</Label>
              <Input
                value={form.web_route}
                onChange={(e) => setForm({ ...form, web_route: e.target.value })}
                placeholder="/dashboard/eip/meetings"
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label>備註</Label>
            <Textarea
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              rows={2}
            />
          </div>

          <div className="space-y-1.5">
            <Label>排序</Label>
            <Input
              type="number"
              value={form.sort_order}
              onChange={(e) =>
                setForm({ ...form, sort_order: Number(e.target.value) || 0 })
              }
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={onSave}>{isEditing ? "儲存" : "新增"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TagInput({
  value,
  onChange,
  placeholder,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");
  // keep draft empty when parent resets
  useEffect(() => {
    if (value.length === 0) setDraft("");
  }, [value.length]);

  const add = () => {
    const t = draft.trim();
    if (!t) return;
    if (!value.includes(t)) onChange([...value, t]);
    setDraft("");
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add();
    } else if (e.key === "Backspace" && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  };
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  return (
    <div className="flex flex-wrap gap-1.5 border rounded-md px-2 py-1.5 focus-within:ring-2 focus-within:ring-ring">
      {value.map((t, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-primary/10 text-primary border border-primary/20"
        >
          {t}
          <button
            type="button"
            onClick={() => remove(i)}
            className="hover:text-destructive"
            aria-label="移除"
          >
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}
      <input
        className="flex-1 min-w-[120px] bg-transparent outline-none text-sm py-0.5"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKey}
        onBlur={add}
        placeholder={value.length === 0 ? placeholder : ""}
      />
    </div>
  );
}
