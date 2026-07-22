export function CloudMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className={compact ? "cloud-mark compact" : "cloud-mark"} aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}
