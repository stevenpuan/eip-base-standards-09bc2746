import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";

export const Route = createFileRoute("/dashboard/activity-logs")({ component: Page });

function Page() {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["activity_logs"],
    queryFn: async () => {
      const { data, error } = await supabase.from("activity_logs").select("*").order("created_at", { ascending: false }).limit(200);
      if (error) throw error;
      return data as any[];
    },
  });
  return (
    <div className="space-y-6">
      <PageHeader title="操作日誌" description="一般操作行為紀錄（最新 200 筆）" />
      {isLoading ? <p className="text-muted-foreground">載入中…</p> : (
        <Card><CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>動作</TableHead><TableHead>路徑</TableHead><TableHead>IP</TableHead><TableHead>時間</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">尚無紀錄</TableCell></TableRow>}
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.action}</TableCell>
                  <TableCell className="font-mono text-xs">{r.route ?? "—"}</TableCell>
                  <TableCell>{r.ip ?? "—"}</TableCell>
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
