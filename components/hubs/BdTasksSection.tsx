"use client";

/**
 * BD hub — Tasks & Follow-ups section. Mounts the existing
 * UnifiedTasks read model (GET /api/platform/tasks) unchanged;
 * dated tasks also appear on the Calendar via the calgen layer.
 */

import UnifiedTasks from "@/components/UnifiedTasks";
import { SectionShell } from "./shared";

export default function BdTasksSection() {
  return (
    <SectionShell
      id="bd-tasks"
      title="Tasks & Follow-ups"
      href="/overview"
    >
      <p className="mb-4 text-sm text-slate-500 dark:text-white/60">
        Every open task across deals and operators — dated tasks appear
        on the Calendar automatically.
      </p>
      <UnifiedTasks />
    </SectionShell>
  );
}
