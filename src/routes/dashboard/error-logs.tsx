import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/dashboard/error-logs")({ component: Page });

function Page() {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["error_logs"],
    queryFn: async () => {
      const { data, error } = await supabase.from("error_logs").select("*").order("created_at", { ascending: false }).limit(200);
      if (error) throw error;
      return data as any[];
    },
  });
  return (
    <div className="space-y-6">
      <PageHeader title="錯誤日誌" description="系統例外紀錄（最新 200 筆）" />
      {isLoading ? <p className="text-muted-foreground">載入中…</p> : (
        <Card><CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>等級</TableHead><TableHead>訊息</TableHead><TableHead>路徑</TableHead><TableHead>時間</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">尚無紀錄</TableCell></TableRow>}
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell><Badge variant={r.level === "fatal" || r.level === "error" ? "destructive" : "secondary"}>{r.level}</Badge></TableCell>
                  <TableCell className="max-w-md truncate">{r.message ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{r.route ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{new Date(r.created_at).toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent></Card>
      )}
    </div>
  );
}
