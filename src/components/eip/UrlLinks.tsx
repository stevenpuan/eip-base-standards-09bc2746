import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link2, Plus, Trash2, ExternalLink, FolderOpen } from "lucide-react";
import { toast } from "sonner";

// eip_url_link 尚未進 src/integrations/supabase/types.ts，這裡用寬鬆型別的 client
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type UrlLinkEntity = "task" | "work_log" | "anomaly" | "project" | "meeting" | "document";

type Row = {
  id: string;
  label: string | null;
  url: string;
  created_by: string | null;
  created_at: string;
};

/** DB 端也有同一條 check constraint（eip_url_link_url_shape），前端先擋是為了給人看得懂的訊息 */
const URL_SHAPE = /^(https?:\/\/|file:\/\/|\\\\)/;
const isUnc = (u: string) => u.startsWith("\\\\");

/**
 * 通用外部連結（NAS 路徑或網址）。
 *
 * 這是規格書第五章第 8 項、訪談定案第 5 條要的東西：「有相關檔案（NAS 或其他）
 * 可掛連結補充說明」。跟 EntityLinks 是兩件不同的事 ——
 *   EntityLinks（eip_link）＝ 系統內實體關聯，任務連到文件／會議／專案
 *   UrlLinks（eip_url_link）＝ 系統外的檔案與網址
 * 先前只做了前者，NAS 連結這條需求整條沒接到，這個元件補上。
 *
 * UNC 路徑（\\server\share\...）瀏覽器不允許用連結直接開啟，
 * 所以那種一律改成「複製路徑」，不要給一個點了沒反應的連結。
 */
export function UrlLinks({
  entityType,
  entityId,
  readOnly = false,
  title = "相關連結",
}: {
  entityType: UrlLinkEntity;
  entityId: string;
  readOnly?: boolean;
  title?: string;
}) {
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const q = useQuery({
    enabled: !!entityId,
    queryKey: ["eip", "url-links", entityType, entityId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("eip_url_link")
        .select("id,label,url,created_by,created_at")
        .eq("entity_type", entityType)
        .eq("entity_id", entityId)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });

  const rows = q.data ?? [];

  const add = async () => {
    const u = url.trim();
    if (!u) return toast.error("請輸入連結");
    if (!URL_SHAPE.test(u)) {
      return toast.error("連結格式不對：請用 http(s)://、file:// 或 \\\\伺服器\\分享資料夾");
    }
    setBusy(true);
    const { error } = await supabase
      .from("eip_url_link")
      .insert({ entity_type: entityType, entity_id: entityId, label: label.trim() || null, url: u });
    setBusy(false);
    if (error) return toast.error(`新增失敗：${error.message}`);
    setLabel("");
    setUrl("");
    setAdding(false);
    void q.refetch();
  };

  const remove = async (r: Row) => {
    if (!window.confirm(`移除連結「${r.label || r.url}」？`)) return;
    setRemoving(r.id);
    const { error } = await supabase.from("eip_url_link").delete().eq("id", r.id);
    setRemoving(null);
    if (error) return toast.error(`移除失敗：${error.message}`);
    void q.refetch();
  };

  const copy = async (u: string) => {
    try {
      await navigator.clipboard.writeText(u);
      toast.success("已複製路徑，貼到檔案總管即可開啟");
    } catch {
      // 沒有 clipboard 權限（http 或舊瀏覽器）時至少把路徑顯示出來讓人手動複製
      toast.info(u);
    }
  };

  return (
    <div className="mt-2 border-t pt-3">
      <div className="text-sm font-medium mb-2 flex items-center gap-1.5">
        <Link2 className="w-3.5 h-3.5" />
        {title}
        {rows.length > 0 && (
          <span className="text-xs text-muted-foreground font-normal">{rows.length}</span>
        )}
        <div className="flex-1" />
        {!readOnly && !adding && (
          <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setAdding(true)}>
            <Plus className="w-3.5 h-3.5 mr-1" />
            新增
          </Button>
        )}
      </div>

      {q.isLoading ? (
        <div className="text-xs text-muted-foreground">載入中…</div>
      ) : q.isError ? (
        <div className="text-xs flex items-center gap-2">
          <span className="text-destructive">連結載入失敗</span>
          <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => void q.refetch()}>
            重試
          </Button>
        </div>
      ) : rows.length === 0 && !adding ? (
        <div className="text-xs text-muted-foreground">
          尚無連結。可以放 NAS 資料夾路徑（\\伺服器\分享資料夾\…）或網址。
        </div>
      ) : (
        <div className="space-y-1">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-2 rounded-md border px-2 py-1.5">
              {isUnc(r.url) ? (
                <>
                  <FolderOpen className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <button
                    type="button"
                    onClick={() => void copy(r.url)}
                    className="text-sm flex-1 min-w-0 truncate text-left hover:underline"
                    title={`${r.url}（點擊複製路徑）`}
                  >
                    {r.label || r.url}
                  </button>
                  <span className="text-[10px] text-muted-foreground shrink-0">NAS</span>
                </>
              ) : (
                <>
                  <ExternalLink className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm flex-1 min-w-0 truncate text-primary hover:underline"
                    title={r.url}
                  >
                    {r.label || r.url}
                  </a>
                </>
              )}
              {!readOnly && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0 shrink-0"
                  disabled={removing === r.id}
                  onClick={() => void remove(r)}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {!readOnly && adding && (
        <div className="mt-2 space-y-2">
          <Input
            placeholder="顯示名稱（選填，例如「檢驗報告資料夾」）"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="h-8 text-sm"
          />
          <Input
            placeholder="\\\\NAS\\品保\\2026\\ 或 https://…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void add();
              }
            }}
            className="h-8 text-sm font-mono"
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void add()} disabled={busy || !url.trim()}>
              {busy ? "新增中…" : "新增"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setAdding(false);
                setLabel("");
                setUrl("");
              }}
            >
              取消
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            NAS 路徑（\\伺服器\…）瀏覽器不能直接開，點擊會複製路徑，貼到檔案總管即可。
          </p>
        </div>
      )}
    </div>
  );
}
