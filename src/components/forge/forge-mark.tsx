interface ForgeMarkProps {
  compact?: boolean;
  className?: string;
}

export function ForgeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path className="forge-icon-body" d="M3 3h18l-3 5H9v3h8l-2.5 4H9v6H3V3Z" fill="currentColor" />
      <path className="forge-icon-spark" d="m18.25 15.25 2.25 2.25-2.25 2.25L16 17.5l2.25-2.25Z" fill="currentColor" />
    </svg>
  );
}

export function ForgeMark({ compact = false, className }: ForgeMarkProps) {
  return (
    <span className={["forge-mark", compact ? "is-compact" : "", className ?? ""].filter(Boolean).join(" ")} aria-label="Forge">
      <ForgeIcon />
      {!compact && <span aria-hidden="true">Forge</span>}
    </span>
  );
}
