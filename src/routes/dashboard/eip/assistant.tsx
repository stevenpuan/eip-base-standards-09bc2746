import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { Plus, Send, MessageSquare, Loader2, Menu } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/eip/assistant")({
  component: AssistantPage,
});

type Conversation = {
  id: string;
  title: string | null;
  created_at: string;
};
type Message = {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  created_at: string;
};
type PendingMsg = { id: string; role: "user" | "assistant"; content: string; pending?: boolean };

const QUICK_PROMPTS = [
  "我今天有什麼要做？",
  "我有逾期任務嗎？",
  "最新公告",
  "幫我查文件",
];

function AssistantPage() {
  const qc = useQueryClient();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useState<PendingMsg[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const conversationsQ = useQuery({
    queryKey: ["eip", "assistant", "conversations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("eip_assistant_conversation")
        .select("id,title,created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Conversation[];
    },
  });

  const messagesQ = useQuery({
    enabled: !!conversationId,
    queryKey: ["eip", "assistant", "messages", conversationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("eip_assistant_message")
        .select("*")
        .eq("conversation_id", conversationId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Message[];
    },
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messagesQ.data, optimistic, sending]);

  const fetchMessages = async (cid: string) => {
    const { data, error } = await supabase
      .from("eip_assistant_message")
      .select("*")
      .eq("conversation_id", cid)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data ?? []) as Message[];
  };

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || sending) return;
    setError(null);
    setInput("");
    setSending(true);
    const userMsg: PendingMsg = { id: `u-${Date.now()}`, role: "user", content };
    const thinkingMsg: PendingMsg = { id: `a-${Date.now()}`, role: "assistant", content: "思考中…", pending: true };
    setOptimistic((prev) => [...prev, userMsg, thinkingMsg]);
    try {
      const { data, error } = await supabase.functions.invoke("eip-assistant", {
        body: { conversation_id: conversationId, user_message: content },
      });
      if (error) throw new Error(error.message || "呼叫失敗");
      if (data?.error) throw new Error(data.error);
      const newId = (data?.conversation_id as string | undefined) ?? conversationId;
      const reply = (data?.reply as string | undefined) ?? "";

      // Replace the "thinking" placeholder with the actual reply immediately
      setOptimistic((prev) =>
        prev.map((m) => (m.pending ? { ...m, content: reply, pending: false } : m))
      );

      if (newId && newId !== conversationId) {
        setConversationId(newId);
        qc.invalidateQueries({ queryKey: ["eip", "assistant", "conversations"] });
      }

      // Refetch persisted messages for the (possibly new) conversation, then clear optimistic
      if (newId) {
        try {
          const fresh = await qc.fetchQuery({
            queryKey: ["eip", "assistant", "messages", newId],
            queryFn: () => fetchMessages(newId),
          });
          if (fresh.length > 0) setOptimistic([]);
        } catch {
          // keep optimistic visible if fetch fails
        }
      }
    } catch (e: any) {
      setError(e?.message ?? "未知錯誤");
      setOptimistic((prev) => prev.filter((m) => !m.pending));
    } finally {
      setSending(false);
    }
  };

  const newConversation = () => {
    setConversationId(null);
    setOptimistic([]);
    setError(null);
  };

  const selectConversation = (id: string) => {
    setOptimistic([]);
    setError(null);
    setConversationId(id);
  };

  const messages: PendingMsg[] = [
    ...((messagesQ.data ?? []).map((m) => ({
      id: m.id,
      role: m.role as "user" | "assistant",
      content: m.content,
    }))),
    ...optimistic,
  ];


  const Sidebar = (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b">
        <Button onClick={newConversation} className="w-full" size="sm">
          <Plus className="w-4 h-4 mr-1" /> 新對話
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {(conversationsQ.data ?? []).map((c) => (
          <button
            key={c.id}
            onClick={() => setConversationId(c.id)}
            className={cn(
              "w-full text-left px-3 py-2 rounded-md text-sm hover:bg-accent flex items-start gap-2",
              conversationId === c.id && "bg-accent font-medium"
            )}
          >
            <MessageSquare className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
            <span className="truncate flex-1">{c.title || "未命名對話"}</span>
          </button>
        ))}
        {!conversationsQ.data?.length && (
          <div className="text-xs text-muted-foreground p-3">尚無對話</div>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-[calc(100vh-9rem)]">
      <PageHeader title="AI 助理" description="詢問任務、公告、文件等 EIP 內容" />
      <div className="flex-1 flex gap-4 min-h-0">
        {/* Desktop sidebar */}
        <Card className="hidden lg:flex w-64 flex-col overflow-hidden p-0">{Sidebar}</Card>

        {/* Chat area */}
        <Card className="flex-1 flex flex-col overflow-hidden p-0">
          <div className="lg:hidden flex items-center justify-between border-b p-2">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" size="sm">
                  <Menu className="w-4 h-4 mr-1" /> 對話
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="p-0 w-72">
                <SheetTitle className="sr-only">過去對話</SheetTitle>
                {Sidebar}
              </SheetContent>
            </Sheet>
            <Button variant="ghost" size="sm" onClick={newConversation}>
              <Plus className="w-4 h-4 mr-1" /> 新對話
            </Button>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.length === 0 && (
              <div className="text-center text-muted-foreground text-sm py-8">
                有什麼可以幫您？試試下方的快捷提問。
              </div>
            )}
            {messages.map((m) => (
              <div
                key={m.id}
                className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words",
                    m.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground"
                  )}
                >
                  {m.pending ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="w-3 h-3 animate-spin" /> 思考中…
                    </span>
                  ) : (
                    m.content
                  )}
                </div>
              </div>
            ))}
          </div>

          {error && (
            <div className="mx-4 mb-2 text-sm text-destructive border border-destructive/30 bg-destructive/5 rounded-md px-3 py-2">
              {error}
            </div>
          )}

          <div className="border-t p-3 space-y-2">
            <div className="flex flex-wrap gap-2">
              {QUICK_PROMPTS.map((q) => (
                <Button
                  key={q}
                  variant="outline"
                  size="sm"
                  disabled={sending}
                  onClick={() => send(q)}
                >
                  {q}
                </Button>
              ))}
            </div>
            <div className="flex gap-2 items-end">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send(input);
                  }
                }}
                placeholder="輸入訊息，Enter 送出，Shift+Enter 換行"
                rows={2}
                className="resize-none"
                disabled={sending}
              />
              <Button onClick={() => send(input)} disabled={sending || !input.trim()}>
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
