import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export const Route = createFileRoute("/dashboard/system-config")({ component: Page });

interface Config { id: string; key: string; value: string | null; group_name: string | null; description: string | null; }

function Page() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const editable = can("system_config", "edit");

  const { data: rows = [] } = useQuery({
    queryKey: ["system_configs"],
    queryFn: async () => {
      const { data, error } = await supabase.from("system_configs").select("*").order("group_name");
      if (error) throw error;
      return data as Config[];
    },
  });

  const [draft, setDraft] = useState<Record<string, string>>({});
  useEffect(() => {
    const m: Record<string, string> = {};
    rows.forEach((r) => (m[r.id] = r.value ?? ""));
    setDraft(m);
  }, [rows]);

  const save = async () => {
    const updates = rows
      .filter((r) => (draft[r.id] ?? "") !== (r.value ?? ""))
      .map((r) => supabase.from("system_configs").update({ value: draft[r.id] }).eq("id", r.id));
    if (updates.length === 0) { toast.info("沒有變更"); return; }
    const results = await Promise.all(updates);
    const err = results.find((x) => x.error);
    if (err?.error) { toast.error(err.error.message); return; }
    toast.success("已儲存");
    qc.invalidateQueries({ queryKey: ["system_configs"] });
  };

  const groups = Array.from(new Set(rows.map((r) => r.group_name ?? "其他")));

  return (
    <div className="space-y-6">
      <PageHeader title="環境參數" description="系統層級設定" actions={editable ? <Button onClick={save}>儲存</Button> : undefined} />
      {groups.map((g) => (
        <Card key={g}>
          <CardHeader><CardTitle className="text-base">{g}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {rows.filter((r) => (r.group_name ?? "其他") === g).map((r) => (
              <div key={r.id} className="grid gap-1 sm:grid-cols-[200px_1fr] sm:items-center sm:gap-4">
                <div>
                  <Label className="text-sm">{r.description ?? r.key}</Label>
                  <div className="text-xs text-muted-foreground font-mono">{r.key}</div>
                </div>
                <Input value={draft[r.id] ?? ""} disabled={!editable} onChange={(e) => setDraft((d) => ({ ...d, [r.id]: e.target.value }))} />
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
