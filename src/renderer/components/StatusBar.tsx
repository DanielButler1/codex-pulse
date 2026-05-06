type StatusBarProps = {
  authMessage: string;
  pollIntervalSeconds: number;
  onRefresh: () => void;
};

export function StatusBar({ authMessage, pollIntervalSeconds, onRefresh }: StatusBarProps) {
  return (
    <footer className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-sm text-neutral-300">
      <span>{authMessage}</span>
      <div className="flex items-center gap-4">
        <span>Poll interval: {pollIntervalSeconds}s</span>
        <button
          className="rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-neutral-100 transition hover:border-neutral-500 hover:bg-neutral-700"
          onClick={onRefresh}
          type="button"
        >
          Refresh now
        </button>
      </div>
    </footer>
  );
}
