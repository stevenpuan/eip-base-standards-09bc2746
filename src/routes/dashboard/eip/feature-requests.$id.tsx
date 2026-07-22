import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft,
  Pencil,
  Sparkles,
  RefreshCw,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useEipUser } from "@/lib/eip-user";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type { Database } from "@/integrations/supabase/types";

export const Route = createFileRoute("/dashboard/eip/feature-requests/$id")({
  component: FeatureRequestDetailPage,
});

type FeatureRequest =
  Database["public"]["Tables"]["eip_feature_request"]["Row"];
type Analysis = Database["public"]["Tables"]["eip_feature_analysis"]["Row"];
type AppUser = Database["public"]["Tables"]["app_user"]["Row"];

const STATUS_LABEL: Record<string, string> = {
  pending: "待處理",
  evaluating: "評估中",
  preparing: "準備中",
  in_progress: "進行中",
  done: "已完成",
  rejected: "不採用",
};

const FEASIBILITY_LABEL: Record<string, string> = {
  high: "高",
  medium: "中",
  low: "低",
};
const FEASIBILITY_COLOR: Record<string, string> = {
  high: "bg-emerald-100 text-emerald-700",
  medium: "bg-amber-100 text-amber-700",
  low: "bg-rose-100 text-rose-700",
};
const COMPLEXITY_LABEL: Record<string, string> = {
  low: "低",
  medium: "中",
  high: "高",
};
const COMPLEXITY_COLOR: Record<string, string> = {
  low: "bg-emerald-100 text-emerald-700",
  medium: "bg-amber-100 text-amber-700",
  high: "bg-rose-100 text-rose-700",
};
const RECO_LABEL: Record<string, string> = {
  execute: "建議執行",
  evaluate: "可評估",
  hold: "暫緩",
  reject: "不建議",
};
const RECO_COLOR: Record<string, string> = {
  execute: "bg-emerald-100 text-emerald-700 border-emerald-200",
  evaluate: "bg-blue-100 text-blue-700 border-blue-200",
  hold: "bg-amber-100 text-amber-700 border-amber-200",
  reject: "bg-rose-100 text-rose-700 border-rose-200",
};

function FeatureRequestDetailPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const { appUser } = useEipUser();
  const { can } = useAuth();
  const canManage = can("eip_feature_pool", "edit");
  const [briefOpen, setBriefOpen] = useState(false);

  const frQ = useQuery({
    queryKey: ["eip", "feature-request", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("eip_feature_request")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data as FeatureRequest | null;
    },
  });

  const submitterQ = useQuery({
    queryKey: ["eip", "feature-request-submitter", frQ.data?.submitter_id],
    enabled: !!frQ.data?.submitter_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_user")
        .select("*")
        .eq("id", frQ.data!.submitter_id!)
        .maybeSingle();
      if (error) throw error;
      return data as AppUser | null;
    },
  });

  const analysisQ = useQuery({
    queryKey: ["eip", "feature-analysis", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("eip_feature_analysis")
        .select("*")
        .eq("feature_request_id", id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as Analysis | null;
    },
  });

  const analyzeMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke(
        "analyze-feature-request",
        { body: { feature_request_id: id } },
      );
      if (error) throw error;
      if ((data as { error?: string })?.error)
        throw new Error((data as { error: string }).error);
      return data;
    },
    onSuccess: () => {
      toast.success("AI 分析完成");
      qc.invalidateQueries({ queryKey: ["eip", "feature-analysis", id] });
    },
    onError: (e) => toast.error(`AI 分析失敗:${e instanceof Error ? e.message : String(e)}`),
  });

  if (frQ.isLoading)
    return <div className="text-muted-foreground py-8">載入中…</div>;
  if (!frQ.data)
    return (
      <div className="space-y-4">
        <BackLink />
        <div className="text-muted-foreground py-8">找不到此需求</div>
      </div>
    );

  const fr = frQ.data;
  const canEdit = canManage || (appUser && fr.submitter_id === appUser.id);
  const a = analysisQ.data;

  return (
    <div className="space-y-4 max-w-4xl">
      <BackLink />

      <Card>
        <CardContent className="p-6 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold">{fr.title}</h1>
              <div className="flex flex-wrap items-center gap-2 mt-2 text-xs">
                <Badge variant="secondary">
                  狀態:{STATUS_LABEL[fr.status] ?? fr.status}
                </Badge>
                {fr.scope && <Badge variant="outline">{fr.scope}</Badge>}
                {fr.request_type && (
                  <Badge variant="outline">{fr.request_type}</Badge>
                )}
                {fr.area && <Badge variant="outline">{fr.area}</Badge>}
                <span className="text-muted-foreground">
                  點數 {fr.points_cost}
                </span>
              </div>
            </div>
            {canEdit && (
              <Button asChild variant="outline" size="sm">
                <Link
                  to="/dashboard/eip/feature-requests/$id/edit"
                  params={{ id: fr.id }}
                >
                  <Pencil className="w-4 h-4" />
                  編輯
                </Link>
              </Button>
            )}
          </div>

          <Separator />

          <div className="text-xs text-muted-foreground flex flex-wrap gap-4">
            <span>提交者:{submitterQ.data?.name ?? "—"}</span>
            <span>建立時間:{new Date(fr.created_at).toLocaleString("zh-TW")}</span>
            {fr.completed_at && (
              <span>
                完成時間:{new Date(fr.completed_at).toLocaleString("zh-TW")}
              </span>
            )}
          </div>

          <div>
            <div className="text-sm font-medium mb-2">詳細描述</div>
            {fr.description ? (
              <div
                className="prose prose-sm max-w-none text-sm border rounded-md p-3 bg-muted/30"
                dangerouslySetInnerHTML={{ __html: fr.description }}
              />
            ) : (
              <div className="text-sm text-muted-foreground">(無)</div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-md bg-violet-100 text-violet-700 flex items-center justify-center">
                <Sparkles className="w-4 h-4" />
              </div>
              <div>
                <div className="text-sm font-semibold">AI 可行性分析</div>
                <div className="text-[11px] text-muted-foreground">
                  以上為 AI 評估參考,非最終決策
                </div>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => analyzeMut.mutate()}
              disabled={analyzeMut.isPending}
            >
              <RefreshCw
                className={`w-4 h-4 ${analyzeMut.isPending ? "animate-spin" : ""}`}
              />
              {a ? "重新分析" : "開始分析"}
            </Button>
          </div>

          {analysisQ.isLoading ? (
            <div className="text-sm text-muted-foreground py-4">載入中…</div>
          ) : analyzeMut.isPending && !a ? (
            <div className="text-sm text-muted-foreground py-4">AI 分析中…</div>
          ) : !a ? (
            <div className="text-sm text-muted-foreground py-4">
              尚未產生分析,點擊「開始分析」由 AI 評估此需求。
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <Metric label="可行性">
                  <Badge
                    variant="secondary"
                    className={FEASIBILITY_COLOR[a.feasibility ?? ""] ?? ""}
                  >
                    {FEASIBILITY_LABEL[a.feasibility ?? ""] ?? a.feasibility ?? "—"}
                  </Badge>
                </Metric>
                <Metric label="複雜度">
                  <Badge
                    variant="secondary"
                    className={COMPLEXITY_COLOR[a.complexity ?? ""] ?? ""}
                  >
                    {COMPLEXITY_LABEL[a.complexity ?? ""] ?? a.complexity ?? "—"}
                  </Badge>
                </Metric>
                <Metric label="信賴度">
                  <span className="text-lg font-semibold">
                    {a.confidence ?? "—"}
                    {a.confidence != null && <span className="text-xs font-normal">%</span>}
                  </span>
                </Metric>
                <Metric label="相關性">
                  <span className="text-lg font-semibold">
                    {a.relevance ?? "—"}
                    {a.relevance != null && <span className="text-xs font-normal">%</span>}
                  </span>
                </Metric>
                <Metric label="預估點數">
                  <span className="text-lg font-semibold">
                    {a.estimated_points ?? "—"}
                  </span>
                </Metric>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">建議</span>
                <Badge
                  variant="outline"
                  className={`text-xs ${RECO_COLOR[a.recommendation ?? ""] ?? ""}`}
                >
                  {RECO_LABEL[a.recommendation ?? ""] ?? a.recommendation ?? "—"}
                </Badge>
              </div>

              <Section title="理由">{a.reason}</Section>
              <Section title="建議做法">{a.approach}</Section>
              <Section title="風險與注意事項">{a.risks}</Section>
              <Section title="重複/相關提醒">{a.similar_notes}</Section>

              <div>
                <button
                  type="button"
                  onClick={() => setBriefOpen((v) => !v)}
                  className="flex items-center gap-1 text-sm font-medium text-foreground hover:text-primary"
                >
                  {briefOpen ? (
                    <ChevronDown className="w-4 h-4" />
                  ) : (
                    <ChevronRight className="w-4 h-4" />
                  )}
                  開發交辦摘要
                </button>
                {briefOpen && (
                  <div className="mt-2 text-sm whitespace-pre-wrap border rounded-md p-3 bg-muted/30">
                    {a.dev_brief || "(無)"}
                  </div>
                )}
              </div>

              <div className="text-[11px] text-muted-foreground">
                由 {a.model ?? "AI"} 於{" "}
                {new Date(a.created_at).toLocaleString("zh-TW")} 產生
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/dashboard/eip/feature-requests"
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="w-4 h-4" />
      返回需求清單
    </Link>
  );
}

function Metric({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border rounded-md p-3 bg-background">
      <div className="text-[11px] text-muted-foreground mb-1">{label}</div>
      <div>{children}</div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children?: string | null;
}) {
  return (
    <div>
      <div className="text-xs font-medium text-muted-foreground mb-1">
        {title}
      </div>
      <div className="text-sm whitespace-pre-wrap">{children || "—"}</div>
    </div>
  );
}
