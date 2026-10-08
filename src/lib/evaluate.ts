import type { Flag, ImageReading, ReportStatus } from "./types";
import { NAME_AUTO_THRESHOLD, type NameMatch } from "./names";

/** Confiança mínima da IA para um report seguir sem conferência humana. */
export const AI_CONFIDENCE_THRESHOLD = 0.9;

export type Evaluation = {
  placement: number | null;
  victory: boolean;
  players: { detectedName: string; baixas: number | null; confidence: number }[];
  totalBaixas: number | null;
  squadTotalDetected: number | null;
  totalsMatch: boolean | null;
  confidence: number;
  flags: Flag[];
};

/**
 * Junta a leitura das imagens (em qualquer ordem) e levanta os alertas.
 * Nada aqui "completa" valores: o que a IA não leu continua null e vira alerta.
 */
export function evaluateReadings(readings: ImageReading[], teamCount = 16): Evaluation {
  const flags: Flag[] = [];
  const best = (kind: ImageReading["type"]) =>
    readings.filter((r) => r.type === kind).sort((a, b) => b.confidence - a.confidence)[0];
  const placementImg = best("PLACEMENT");
  const statsImg = best("STATS");

  let placement: number | null = null;
  let victory = false;
  if (!placementImg) {
    flags.push("SEM_PRINT_COLOCACAO");
  } else {
    placement = Number.isInteger(placementImg.placement) ? placementImg.placement : null;
    victory = placementImg.victory === true;
    if (victory && placement === null) placement = 1;
    if (placement === null) flags.push("COLOCACAO_ILEGIVEL");
    else if (placement < 1 || placement > teamCount) flags.push("COLOCACAO_FORA_DA_FAIXA");
    if (placement !== null && victory !== (placement === 1)) flags.push("VITORIA_INCONSISTENTE");
  }

  let players: Evaluation["players"] = [];
  let totalBaixas: number | null = null;
  let squadTotalDetected: number | null = null;
  let totalsMatch: boolean | null = null;
  if (!statsImg) {
    flags.push("SEM_PRINT_PLACAR");
  } else {
    players = statsImg.players.map((p) => ({
      detectedName: p.detectedName,
      baixas: Number.isInteger(p.baixas) && (p.baixas as number) >= 0 ? p.baixas : null,
      confidence: p.confidence,
    }));
    if (!statsImg.headers.some((h) => /baixas/i.test(h))) flags.push("COLUNA_BAIXAS_NAO_LOCALIZADA");
    if (players.length !== 3) flags.push("JOGADORES_INCOMPLETOS");
    if (players.some((p) => p.baixas === null)) flags.push("BAIXAS_ILEGIVEIS");
    else if (players.length > 0) totalBaixas = players.reduce((s, p) => s + (p.baixas as number), 0);

    squadTotalDetected = Number.isInteger(statsImg.squadTotalBaixas) ? statsImg.squadTotalBaixas : null;
    if (squadTotalDetected === null) flags.push("TOTAL_ESQUADRAO_ILEGIVEL");
    else if (totalBaixas !== null) {
      totalsMatch = totalBaixas === squadTotalDetected;
      if (!totalsMatch) flags.push("SOMA_DIFERENTE_DO_TOTAL");
    }
  }

  const confidences = [
    placementImg?.confidence ?? 0,
    statsImg?.confidence ?? 0,
    ...players.map((p) => p.confidence),
  ];
  const confidence = Math.min(...confidences);
  if (confidence < AI_CONFIDENCE_THRESHOLD && placementImg && statsImg) flags.push("LEITURA_BAIXA_CONFIANCA");

  return { placement, victory: placement === 1, players, totalBaixas, squadTotalDetected, totalsMatch, confidence, flags };
}

export function nameFlags(matches: NameMatch[]): Flag[] {
  const flags: Flag[] = [];
  if (matches.some((m) => !m.playerId)) flags.push("NOME_NAO_RECONHECIDO");
  else if (matches.some((m) => m.score < NAME_AUTO_THRESHOLD)) flags.push("NOME_BAIXA_CONFIANCA");
  return flags;
}

/** Alertas que significam conflito de informação (e não só leitura insegura). */
const DIVERGENCE_FLAGS: Flag[] = [
  "SOMA_DIFERENTE_DO_TOTAL", "VITORIA_INCONSISTENTE", "COLOCACAO_REPETIDA",
  "VITORIA_REPETIDA", "DIVERGENCIA_INFORMADA_PELO_CAPITAO",
];

/** Status do report no momento em que o capitão confirma. */
export function statusOnConfirm(flags: Flag[], autoValidate: boolean): ReportStatus {
  if (flags.some((f) => DIVERGENCE_FLAGS.includes(f))) return "DIVERGENCIA";
  if (flags.length > 0) return "EM_ANALISE";
  return autoValidate ? "VALIDADA" : "ENVIADA";
}
