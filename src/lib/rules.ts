import type { MatchStatus, ReportStatus } from "./types";

/** Status em que o capitão ainda pode (re)enviar as prints. */
export const EDITABLE: (ReportStatus | null | undefined)[] = [null, undefined, "RASCUNHO", "REABERTO", "REJEITADA"];
/** Status que "ocupam" uma colocação dentro da partida. */
export const ACTIVE: ReportStatus[] = ["ENVIADA", "EM_ANALISE", "VALIDADA", "DIVERGENCIA"];

export function canSubmit(
  match: { status: MatchStatus; deadline: string | null },
  report: { status: ReportStatus; late_allowed: boolean } | null | undefined,
  now = new Date(),
): { ok: boolean; reason?: string } {
  if (report && !EDITABLE.includes(report.status)) {
    return { ok: false, reason: "Este report já foi enviado. Só o administrador pode reabrir." };
  }
  if (report?.late_allowed) return { ok: true };
  if (match.status === "NAO_LIBERADA") return { ok: false, reason: "Esta partida ainda não foi liberada." };
  if (match.status === "FECHADA") return { ok: false, reason: "Os reports desta partida foram encerrados. Peça autorização ao administrador." };
  if (match.deadline && now > new Date(match.deadline)) {
    return { ok: false, reason: "O prazo desta partida terminou. Peça autorização ao administrador." };
  }
  return { ok: true };
}
