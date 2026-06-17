// Edge Function: analyze-feature-request
// 為「需求許願池」單筆 eip_feature_request 產生 AI 可行性分析,寫入 eip_feature_analysis
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });

const MODEL = "claude-sonnet-4-6";

const SYSTEM_PROMPT = `你是「EIP 企業內部入口」系統的技術評估顧問。
EIP 平台目前包含的模組:任務看板/我的任務、會議(可將決議轉任務)、專案(看板與里程碑)、公告(對象範圍與已讀)、成員管理、需求許願池。
請依據使用者提交的需求,輸出一份**只含 JSON**(不要 markdown、不要前後文字)的評估,欄位嚴格如下:
{
  "feasibility": "high" | "medium" | "low",
  "complexity": "low" | "medium" | "high",
  "confidence": 0-100 整數,
  "relevance": 0-100 整數,
  "estimated_points": 整數(預估工作量點數,數字越大越多工),
  "recommendation": "execute" | "evaluate" | "hold" | "reject",
  "reason": "繁體中文 2-4 句",
  "approach": "繁體中文,建議做法",
  "risks": "繁體中文,風險或注意事項",
  "similar_notes": "繁體中文,是否與既有功能或其他需求重複/相關;無則寫『無明顯重複』",
  "dev_brief": "繁體中文,若決定執行給開發者的交辦摘要,可條列"
}
所有文字務必為繁體中文。`;

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  // 直接嘗試
  try {
    return JSON.parse(trimmed);
  } catch {
    // 嘗試從 code fence 或 first { ... last }
    const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = fence
      ? fence[1].trim()
      : trimmed.slice(trimmed.indexOf("{"), trimmed.lastIndexOf("}") + 1);
    return JSON.parse(candidate);
  }
}

function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  try {
    const anthKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthKey) return json(500, { error: "缺少 ANTHROPIC_API_KEY" });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer "))
      return json(401, { error: "未授權" });

    // 用使用者 JWT 建立 client 以套用 RLS,並取得使用者
    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData.user) return json(401, { error: "無效的使用者" });
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const feature_request_id = body?.feature_request_id as string | undefined;
    if (!feature_request_id)
      return json(400, { error: "缺少 feature_request_id" });

    const { data: fr, error: frErr } = await supabase
      .from("eip_feature_request")
      .select(
        "id, tenant_id, title, scope, request_type, area, description, points_cost",
      )
      .eq("id", feature_request_id)
      .maybeSingle();
    if (frErr) return json(500, { error: frErr.message });
    if (!fr) return json(404, { error: "需求不存在或無權限" });

    // 取同租戶其他需求標題,輔助重複/相關判斷
    const { data: others } = await supabase
      .from("eip_feature_request")
      .select("title, area, status")
      .neq("id", feature_request_id)
      .limit(40);

    const userMessage = [
      `【本次需求】`,
      `標題:${fr.title}`,
      `應用範圍:${fr.scope ?? "—"}`,
      `需求類型:${fr.request_type ?? "—"}`,
      `區塊/功能:${fr.area ?? "—"}`,
      `自評點數:${fr.points_cost ?? 1}`,
      `詳細描述:`,
      stripHtml(fr.description) || "(無)",
      ``,
      `【目前其他需求(供重複/相關判斷,僅標題清單)】`,
      ...(others ?? []).map(
        (o) => `- [${o.status}] ${o.title}${o.area ? ` / ${o.area}` : ""}`,
      ),
      ``,
      `請輸出 JSON。`,
    ].join("\n");

    const anthResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!anthResp.ok) {
      const text = await anthResp.text();
      return json(502, {
        error: `Anthropic API 失敗 (${anthResp.status})`,
        detail: text.slice(0, 500),
      });
    }
    const anthJson = await anthResp.json();
    const text =
      (anthJson?.content?.[0]?.text as string | undefined) ?? "";
    if (!text) return json(502, { error: "AI 回應為空" });

    let parsed: Record<string, unknown>;
    try {
      parsed = extractJson(text) as Record<string, unknown>;
    } catch (e) {
      return json(502, {
        error: "AI 回應解析失敗",
        detail: text.slice(0, 500),
      });
    }

    const toInt = (v: unknown) => {
      const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
      return Number.isFinite(n) ? Math.round(n) : null;
    };

    const insertPayload = {
      feature_request_id,
      tenant_id: fr.tenant_id,
      created_by: userId,
      model: MODEL,
      feasibility: (parsed.feasibility as string) ?? null,
      complexity: (parsed.complexity as string) ?? null,
      confidence: toInt(parsed.confidence),
      relevance: toInt(parsed.relevance),
      estimated_points: toInt(parsed.estimated_points),
      recommendation: (parsed.recommendation as string) ?? null,
      reason: (parsed.reason as string) ?? null,
      approach: (parsed.approach as string) ?? null,
      risks: (parsed.risks as string) ?? null,
      similar_notes: (parsed.similar_notes as string) ?? null,
      dev_brief: (parsed.dev_brief as string) ?? null,
      raw: anthJson,
    };

    const { data: inserted, error: insErr } = await supabase
      .from("eip_feature_analysis")
      .insert(insertPayload)
      .select("*")
      .single();
    if (insErr) return json(500, { error: insErr.message });

    return json(200, { analysis: inserted });
  } catch (e) {
    console.error("[analyze-feature-request] error", e);
    return json(500, {
      error: e instanceof Error ? e.message : String(e),
    });
  }
});
