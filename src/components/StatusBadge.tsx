import { STATUS_LABEL, type DisplayStatus } from "@/lib/format";

const TONE: Record<DisplayStatus, string> = {
  NAO_LIBERADA: "border-line text-muted",
  AGUARDANDO: "border-amber/60 text-amber",
  ENVIADA: "border-info/60 text-info",
  EM_ANALISE: "border-info/60 text-info",
  VALIDADA: "border-ok/60 text-ok",
  DIVERGENCIA: "border-win/70 text-win",
  REJEITADA: "border-win/70 text-win",
};

export function StatusBadge({ status }: { status: DisplayStatus }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-sm border px-2 py-0.5 text-xs font-semibold ${TONE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}
