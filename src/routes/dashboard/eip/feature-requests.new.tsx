import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Bold, Italic, Underline, List, ListOrdered, Link as LinkIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useEipUser } from "@/lib/eip-user";
import { DEFAULT_TENANT_ID } from "@/lib/eip-constants";
import { Card, CardContent } from "@/components/ui/card";
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

export const Route = createFileRoute("/dashboard/eip/feature-requests/new")({
  component: NewFeatureRequestPage,
});

const SCOPE_OPTIONS = ["前台", "後台", "全站", "其他"];
const TYPE_OPTIONS = ["新增功能", "修改功能", "修正問題", "其他"];
const MONTHLY_QUOTA = 30;

function NewFeatureRequestPage() {
  const navigate = useNavigate();
  const { appUser } = useEipUser();

  const [title, setTitle] = useState("");
  const [scope, setScope] = useState("");
  const [requestType, setRequestType] = useState("");
  const [area, setArea] = useState("");
  const [points, setPoints] = useState(1);
  const editorRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);

  const exec = (cmd: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(cmd, false, value);
  };
  const insertLink = () => {
    const url = window.prompt("請輸入連結網址", "https://");
    if (url) exec("createLink", url);
  };

  const submit = async () => {
    if (!appUser) return toast.error("尚未載入 EIP 帳號");
    if (!title.trim()) return toast.error("請輸入需求標題");
    if (!scope) return toast.error("請選擇應用範圍");
    if (!requestType) return toast.error("請選擇需求類型");
    if (!area.trim()) return toast.error("請輸入區塊 / 功能名稱");
    const html = editorRef.current?.innerHTML ?? "";
    const plain = (editorRef.current?.innerText ?? "").trim();
    if (!plain) return toast.error("請輸入詳細描述");

    const cost = Math.max(1, Math.floor(points || 1));

    // 點數檢查
    const now = new Date();
    const { data: monthRows, error: mErr } = await supabase
      .from("eip_feature_request")
      .select("points_cost, created_at")
      .gte(
        "created_at",
        new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
      );
    if (mErr) return toast.error(mErr.message);
    const used = (monthRows ?? []).reduce(
      (s, r) => s + (r.points_cost ?? 0),
      0,
    );
    if (used + cost > MONTHLY_QUOTA) {
      return toast.error(
        `本月點數不足（剩 ${Math.max(0, MONTHLY_QUOTA - used)} 點)`,
      );
    }

    setBusy(true);
    try {
      const { error } = await supabase.from("eip_feature_request").insert({
        tenant_id: appUser.tenant_id ?? DEFAULT_TENANT_ID,
        title: title.trim(),
        scope,
        request_type: requestType,
        area: area.trim(),
        points_cost: cost,
        description: html,
        submitter_id: appUser.id,
        status: "pending",
      });
      if (error) throw error;
      toast.success("已送出需求");
      navigate({ to: "/dashboard/eip/feature-requests" });
    } catch (e) {
      toast.error(`失敗：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <Link
          to="/dashboard/eip/feature-requests"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-4 h-4" />
          返回需求清單
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-bold">新增需求單</h1>
        <p className="text-sm text-muted-foreground mt-1">
          填寫以下表單提交新的功能需求
        </p>
      </div>

      <Card>
        <CardContent className="p-6 grid gap-4">
          <Field label="需求標題" required>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>

          <div className="grid md:grid-cols-2 gap-4">
            <Field label="應用範圍" required>
              <Select value={scope} onValueChange={setScope}>
                <SelectTrigger>
                  <SelectValue placeholder="請選擇" />
                </SelectTrigger>
                <SelectContent>
                  {SCOPE_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="需求類型" required>
              <Select value={requestType} onValueChange={setRequestType}>
                <SelectTrigger>
                  <SelectValue placeholder="請選擇" />
                </SelectTrigger>
                <SelectContent>
                  {TYPE_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <Field label="區塊 / 功能名稱" required>
              <Input
                value={area}
                onChange={(e) => setArea(e.target.value)}
                placeholder="例如：用戶管理、名片編輯、會員轉播"
              />
            </Field>
            <Field label="消耗點數">
              <Input
                type="number"
                min={1}
                value={points}
                onChange={(e) => setPoints(Number(e.target.value))}
              />
            </Field>
          </div>

          <Field label="詳細描述" required>
            <div className="border rounded-md overflow-hidden">
              <div className="flex flex-wrap items-center gap-1 border-b bg-muted/40 px-2 py-1">
                <ToolBtn onClick={() => exec("bold")} title="粗體">
                  <Bold className="w-4 h-4" />
                </ToolBtn>
                <ToolBtn onClick={() => exec("italic")} title="斜體">
                  <Italic className="w-4 h-4" />
                </ToolBtn>
                <ToolBtn onClick={() => exec("underline")} title="底線">
                  <Underline className="w-4 h-4" />
                </ToolBtn>
                <div className="w-px h-4 bg-border mx-1" />
                <ToolBtn
                  onClick={() => exec("insertUnorderedList")}
                  title="項目清單"
                >
                  <List className="w-4 h-4" />
                </ToolBtn>
                <ToolBtn
                  onClick={() => exec("insertOrderedList")}
                  title="編號清單"
                >
                  <ListOrdered className="w-4 h-4" />
                </ToolBtn>
                <div className="w-px h-4 bg-border mx-1" />
                <ToolBtn onClick={insertLink} title="插入連結">
                  <LinkIcon className="w-4 h-4" />
                </ToolBtn>
              </div>
              <div
                ref={editorRef}
                contentEditable
                suppressContentEditableWarning
                className="min-h-[180px] p-3 text-sm focus:outline-none prose prose-sm max-w-none"
                data-placeholder="請描述需求情境、預期效益…"
              />
            </div>
          </Field>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="ghost"
              type="button"
              onClick={() =>
                navigate({ to: "/dashboard/eip/feature-requests" })
              }
              disabled={busy}
            >
              取消
            </Button>
            <Button onClick={submit} disabled={busy}>
              送出需求
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-sm">
        {label}
        {required && <span className="text-destructive ml-1">*</span>}
      </Label>
      {children}
    </div>
  );
}

function ToolBtn({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={title}
      className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground"
    >
      {children}
    </button>
  );
}
