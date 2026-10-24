"use client";

/**
 * Grouped workspace navigation (VCP redesign, §3). Thin local wrapper
 * shaped like the Diligence Workspace redesign's grouped nav (groups
 * with sub-section chips; wraps instead of horizontal scrolling at
 * desktop widths; a group <select> + chip row on mobile) so the shared
 * component can be swapped in when it lands on main. Substitution
 * recorded in the build checkpoint.
 */

export interface NavGroup {
  key: string;
  label: string;
  subs: Array<{ key: string; label: string }>;
}

export default function GroupedNav({
  groups,
  group,
  sub,
  onChange,
}: {
  groups: NavGroup[];
  group: string;
  sub: string;
  onChange: (group: string, sub: string) => void;
}) {
  const active = groups.find((g) => g.key === group) ?? groups[0];
  return (
    <div className="space-y-2">
      {/* Desktop / tablet: wrapping group row (no horizontal scroll). */}
      <div className="hidden flex-wrap gap-1.5 md:flex" role="tablist" aria-label="Workspace sections">
        {groups.map((g) => {
          const isActive = g.key === active.key;
          return (
            <button
              key={g.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onChange(g.key, g.subs[0]?.key ?? "")}
              className={`min-h-[40px] rounded-full px-4 text-sm font-medium transition ${
                isActive
                  ? "bg-[#0d1f3c] text-white shadow-sm dark:bg-[#b8975a] dark:text-[#0d1f3c]"
                  : "bg-slate-100 text-slate-600 hover:bg-[#f0f4fa] hover:text-[#0d1f3c] dark:bg-white/5 dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-white"
              }`}
            >
              {g.label}
            </button>
          );
        })}
      </div>
      {/* Mobile: group dropdown. */}
      <div className="md:hidden">
        <label className="sr-only" htmlFor="vc-group-select">Workspace section</label>
        <select
          id="vc-group-select"
          className="min-h-[44px] w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-[#0d1f3c] outline-none focus:border-[#b8975a] focus:ring-2 focus:ring-[#b8975a]/40 dark:border-white/10 dark:bg-white/5 dark:text-white"
          value={active.key}
          onChange={(e) => {
            const g = groups.find((x) => x.key === e.target.value);
            if (g) onChange(g.key, g.subs[0]?.key ?? "");
          }}
        >
          {groups.map((g) => (
            <option key={g.key} value={g.key}>{g.label}</option>
          ))}
        </select>
      </div>
      {/* Sub-section chips (both form factors). */}
      {active.subs.length > 1 && (
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={`${active.label} views`}>
          {active.subs.map((s) => {
            const isActive = s.key === sub;
            return (
              <button
                key={s.key}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => onChange(active.key, s.key)}
                className={`min-h-[36px] rounded-full border px-3.5 text-[13px] font-medium transition ${
                  isActive
                    ? "border-[#b8975a] bg-[#b8975a]/10 text-[#0d1f3c] ring-1 ring-[#b8975a]/50 dark:text-white"
                    : "border-slate-200 text-slate-500 hover:border-[#b8975a]/60 hover:text-[#0d1f3c] dark:border-white/10 dark:text-white/55 dark:hover:text-white"
                }`}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
