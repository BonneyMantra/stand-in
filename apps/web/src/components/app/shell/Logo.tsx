/** Stand-in mark: a solid key-head with a hollow twin offset behind it (the decoy). */
export function Logo({ className = "size-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" className={className} aria-hidden>
      <rect width="28" height="28" rx="7" fill="var(--color-ink-850)" stroke="var(--color-line-strong)" />
      <circle cx="12" cy="12" r="4.2" fill="none" stroke="var(--color-decoy)" strokeWidth="1.4" strokeDasharray="2 1.6" />
      <circle cx="15.5" cy="15.5" r="4.2" fill="var(--color-fg)" />
      <circle cx="15.5" cy="15.5" r="1.5" fill="var(--color-ink-850)" />
    </svg>
  );
}
