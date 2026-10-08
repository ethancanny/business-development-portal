interface KanbanBoardProps<T> {
  stages: readonly string[];
  items: T[];
  getId: (item: T) => string;
  getStage: (item: T) => string;
  renderCard: (item: T) => React.ReactNode;
  onSelect: (item: T) => void;
  emptyText?: string;
}

export default function KanbanBoard<T>({
  stages,
  items,
  getId,
  getStage,
  renderCard,
  onSelect,
  emptyText = "No items",
}: KanbanBoardProps<T>) {
  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {stages.map((stage) => {
        const column = items.filter((i) => getStage(i) === stage);
        return (
          <div
            key={stage}
            className="w-72 shrink-0 rounded-xl border border-slate-200 bg-slate-200/70 p-3 dark:border-white/10 dark:bg-[#132847]"
          >
            <div className="mb-3 flex items-center justify-between px-1">
              <h3 className="text-sm font-semibold text-slate-700 dark:text-white">{stage}</h3>
              <span className="rounded-full bg-slate-300 px-2 py-0.5 text-xs font-medium text-slate-700 dark:bg-white/10 dark:text-[#c8bfa8]">
                {column.length}
              </span>
            </div>
            <div className="flex max-h-[calc(100vh-320px)] flex-col gap-2 overflow-y-auto">
              {column.length === 0 && (
                <p className="rounded-lg border border-dashed border-slate-300 bg-white/50 p-3 text-center text-xs text-slate-400 dark:border-white/15 dark:bg-white/5 dark:text-white/40">
                  {emptyText}
                </p>
              )}
              {column.map((item) => (
                <button
                  key={getId(item)}
                  onClick={() => onSelect(item)}
                  className="rounded-lg border border-transparent bg-white p-3 text-left shadow-sm transition hover:shadow-md dark:border-white/10 dark:bg-[#0d1f3c] dark:shadow-none dark:hover:border-[#b8975a]/60 dark:hover:shadow-lg"
                >
                  {renderCard(item)}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
