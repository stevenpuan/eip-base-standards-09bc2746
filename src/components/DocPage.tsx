import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { DocRenderer } from "@/components/DocRenderer";
import { humanizeError } from "@/lib/eip-error";

export function DocPage({ docKey, title, description }: { docKey: string; title: string; description?: string }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const editable = can(docKey, "edit");

  const { data } = useQuery({
    queryKey: ["doc", docKey],
    queryFn: async () => {
      const { data, error } = await supabase.from("doc_pages").select("*").eq("key", docKey).maybeSingle();
      if (error) throw error;
      return data as { content: string | null } | null;
    },
  });

  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState("");
  useEffect(() => { setContent(data?.content ?? ""); }, [data]);

  const save = async () => {
    const { data: rows, error } = await supabase
      .from("doc_pages")
      .upsert({ key: docKey, content }, { onConflict: "key" })
      .select("id");
    if (error) { toast.error(humanizeError(error, "儲存")); return; }
    if (!rows || rows.length === 0) {
      toast.error("儲存失敗：沒有寫入任何內容（可能是權限不足），請聯絡系統管理者");
      return;
    }
    toast.success("已儲存");
    setEditing(false);
    qc.invalidateQueries({ queryKey: ["doc", docKey] });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        description={description}
        actions={editable ? (
          editing ? (
            <>
              <Button variant="outline" onClick={() => { setEditing(false); setContent(data?.content ?? ""); }}>取消</Button>
              <Button onClick={save}>儲存</Button>
            </>
          ) : (
            <Button onClick={() => setEditing(true)}>編輯</Button>
          )
        ) : undefined}
      />
      {editing ? (
        <Card>
          <CardContent className="py-6">
            <Textarea className="min-h-[400px] font-mono text-sm" value={content} onChange={(e) => setContent(e.target.value)} />
          </CardContent>
        </Card>
      ) : (
        <DocRenderer content={content} />
      )}
    </div>
  );
}
