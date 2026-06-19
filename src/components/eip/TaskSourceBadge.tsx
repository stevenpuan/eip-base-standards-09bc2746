import { CalendarDays, FolderKanban, ListChecks } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";

export type TaskSource =
  | { type: "meeting"; label: string }
  | { type: "project"; label: string }
  | { type: "normal" };

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
  return (
    <Badge variant="secondary" className={`text-[10px] gap-0.5 bg-slate-100 text-slate-700 hover:bg-slate-100 ${className}`}>
      <ListChecks className="w-2.5 h-2.5" /> 一般
    </Badge>
  );
}

/** 根據 task ids + project_id 對應,回傳 task→來源 的 Map */
export function useTaskSources(
  tasks: Array<{ id: string; project_id: string | null }>,
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
      if (m) out.set(t.id, { type: "meeting", label: m });
      else if (t.project_id && projMap.get(t.project_id))
        out.set(t.id, { type: "project", label: projMap.get(t.project_id)! });
      else out.set(t.id, { type: "normal" });
    });
    return out;
  }, [tasks, meetingLinksQ.data, projectsQ.data]);
}
