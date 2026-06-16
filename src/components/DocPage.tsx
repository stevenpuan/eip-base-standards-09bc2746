import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export function DocPage({ docKey, title, description }: { docKey: string; title: string; description?: string }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const editable = can(docKey, "edit");

  const { data } = useQuery({
    queryKey: ["doc", docKey],
    queryFn: async () => {
      const { data } = await supabase.from("doc_pages").select("*").eq("key", docKey).maybeSingle();
      return data as { content: string | null } | null;
    },
  });

  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState("");
  useEffect(() => { setContent(data?.content ?? ""); }, [data]);

  const save = async () => {
    const { error } = await supabase.from("doc_pages").update({ content }).eq("key", docKey);
    if (error) { toast.error(error.message); return; }
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
      <Card>
        <CardContent className="py-6">
          {editing ? (
            <Textarea className="min-h-[400px] font-mono text-sm" value={content} onChange={(e) => setContent(e.target.value)} />
          ) : (
            <div className="whitespace-pre-wrap text-sm leading-7 text-foreground/90">{content || "（尚無內容）"}</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
