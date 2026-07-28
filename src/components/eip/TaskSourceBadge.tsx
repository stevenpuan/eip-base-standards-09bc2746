import { CalendarDays, FolderKanban, ListChecks, Repeat } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * 任務的來源。對應整合架構圖的 ②③④⑤ 四類 ——
 * 使用者看到徽章要能立刻回答「這件事為什麼在我的清單上」，
 * 所以四個標籤都用來源本身的名字，不用「一般／其他」這種說不出內容的字。
 */
export type TaskSource =
  // ④ 會議決議的行動項指派給我
  | { type: "meeting"; label: string }
  // ⑤ 專案底下的任務
  | { type: "project"; label: string }
  // ② 常態工作：由 recurring_rule 每天自動生出來的任務（兩軸分類裡屬「例行」）
  | { type: "recurring" }
  // ③ 直接在任務看板建立／指派的任務（非常態、非專案、非會議來源）
  | { type: "normal" };

/** 篩選器與分組標題共用的來源名稱，避免同一件事在不同地方叫不同名字 */
export const TASK_SOURCE_LABEL: Record<TaskSource["type"], string> = {
  recurring: "常態工作",
  normal: "任務看板",
  project: "專案任務",
  meeting: "會議決議",
};

export const TASK_SOURCE_HINT: Record<TaskSource["type"], string> = {
  recurring: "常態工作：依週期規則每天自動產生（例行軸）",
  normal: "任務看板：有人直接在任務看板建立或指派給你的任務",
  project: "專案任務：掛在某個專案底下的任務",
  meeting: "會議決議：會議行動項指派給你而產生的任務",
};

export function TaskSourceBadge({ source, className = "" }: { source: TaskSource; className?: string }) {
  if (source.type === "meeting") {
    return (
      <Badge
        variant="secondary"
        className={`text-[10px] gap-0.5 bg-amber-100 text-amber-800 hover:bg-amber-100 ${className}`}
        title={`會議：${source.label}`}
      >
        <CalendarDays className="w-2.5 h-2.5" />
        <span className="truncate max-w-[8rem]">會議：{source.label}</span>
      </Badge>
    );
  }
  if (source.type === "project") {
    return (
      <Badge
        variant="secondary"
        className={`text-[10px] gap-0.5 bg-indigo-100 text-indigo-800 hover:bg-indigo-100 ${className}`}
        title={`專案：${source.label}`}
      >
        <FolderKanban className="w-2.5 h-2.5" />
        <span className="truncate max-w-[8rem]">專案：{source.label}</span>
      </Badge>
    );
  }
  if (source.type === "recurring") {
    return (
      <Badge
        variant="secondary"
        className={`text-[10px] gap-0.5 bg-teal-100 text-teal-800 hover:bg-teal-100 ${className}`}
        title={TASK_SOURCE_HINT.recurring}
      >
        <Repeat className="w-2.5 h-2.5" /> 常態工作
      </Badge>
    );
  }
  // ③「一般」講不出是什麼，改成來源本身的名字
  return (
    <Badge
      variant="secondary"
      className={`text-[10px] gap-0.5 bg-slate-100 text-slate-700 hover:bg-slate-100 ${className}`}
      title={TASK_SOURCE_HINT.normal}
    >
      <ListChecks className="w-2.5 h-2.5" /> 任務看板
    </Badge>
  );
}

/** 根據 task ids + project_id 對應,回傳 task→來源 的 Map */
export function useTaskSources(
  tasks: Array<{ id: string; project_id: string | null; recurring_rule_id?: string | null }>,
): Map<string, TaskSource> {
  const ids = useMemo(() => tasks.map((t) => t.id).sort(), [tasks]);
  const projectIds = useMemo(
    () => Array.from(new Set(tasks.map((t) => t.project_id).filter(Boolean) as string[])).sort(),
    [tasks],
  );

  const meetingLinksQ = useQuery({
    enabled: ids.length > 0,
    queryKey: ["task-sources", "meeting-links", ids],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meeting_action_item")
        .select("linked_task_id, meeting:meeting_id(title)")
        .in("linked_task_id", ids);
      if (error) throw error;
      return data ?? [];
    },
  });

  const projectsQ = useQuery({
    enabled: projectIds.length > 0,
    queryKey: ["task-sources", "projects", projectIds],
    queryFn: async () => {
      const { data, error } = await supabase.from("project").select("id,name").in("id", projectIds);
      if (error) throw error;
      return data ?? [];
    },
  });

  return useMemo(() => {
    const meetingMap = new Map<string, string>();
    (meetingLinksQ.data ?? []).forEach((r: any) => {
      if (r.linked_task_id && r.meeting?.title) meetingMap.set(r.linked_task_id, r.meeting.title);
    });
    const projMap = new Map<string, string>();
    (projectsQ.data ?? []).forEach((p: any) => projMap.set(p.id, p.name));
    const out = new Map<string, TaskSource>();
    tasks.forEach((t) => {
      const m = meetingMap.get(t.id);
      // 判斷順序：會議決議 → 常態工作 → 專案 → 一般。
      // 常態工作排在專案前面，因為它是「例行」那一軸，優先要讓使用者看出來。
      if (m) out.set(t.id, { type: "meeting", label: m });
      else if (t.recurring_rule_id) out.set(t.id, { type: "recurring" });
      else if (t.project_id && projMap.get(t.project_id))
        out.set(t.id, { type: "project", label: projMap.get(t.project_id)! });
      else out.set(t.id, { type: "normal" });
    });
    return out;
  }, [tasks, meetingLinksQ.data, projectsQ.data]);
}
