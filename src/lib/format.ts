import type { Flag, MatchStatus, ReportStatus } from "./types";

const nf = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
/** 8.4 → "8,4" · 38 → "38" */
export const pts = (n: number | string | null | undefined) =>
  n === null || n === undefined ? "–" : nf.format(Number(n));

export const ordinal = (n: number | null | undefined) => (n ? `${n}º` : "–");
export const teamNo = (n: number) => String(n).padStart(2, "0");

export const dateTime = (iso: string | null | undefined) =>
  iso
    ? new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo",
      }).format(new Date(iso))
    : "–";
export const timeOnly = (iso: string | null | undefined) =>
  iso
    ? new Intl.DateTimeFormat("pt-BR", { timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(iso))
    : "–";
export const dateOnly = (d: string | null | undefined) =>
  d ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeZone: "UTC" }).format(new Date(d)) : "";

export type DisplayStatus =
  | "NAO_LIBERADA" | "AGUARDANDO" | "ENVIADA" | "EM_ANALISE" | "VALIDADA" | "DIVERGENCIA" | "REJEITADA";

export const STATUS_LABEL: Record<DisplayStatus, string> = {
  NAO_LIBERADA: "Não liberada",
  AGUARDANDO: "Aguardando report",
  ENVIADA: "Enviada",
  EM_ANALISE: "Em análise",
  VALIDADA: "Validada",
  DIVERGENCIA: "Divergência",
  REJEITADA: "Rejeitada",
};

export function displayStatus(match: MatchStatus, report?: ReportStatus | null): DisplayStatus {
  if (report && report !== "RASCUNHO" && report !== "REABERTO") return report;
  if (report === "REABERTO") return "AGUARDANDO";
  return match === "NAO_LIBERADA" ? "NAO_LIBERADA" : "AGUARDANDO";
}

export const FLAG_LABEL: Record<Flag, string> = {
  SEM_PRINT_COLOCACAO: "Nenhuma print mostra a colocação",
  COLOCACAO_ILEGIVEL: "Colocação não identificada com segurança",
  COLOCACAO_FORA_DA_FAIXA: "Colocação fora da faixa de times do campeonato",
  SEM_PRINT_PLACAR: "Nenhuma print mostra o placar do esquadrão",
  COLUNA_BAIXAS_NAO_LOCALIZADA: "Coluna BAIXAS não localizada no placar",
  JOGADORES_INCOMPLETOS: "O placar não mostra exatamente 3 jogadores",
  BAIXAS_ILEGIVEIS: "Baixas de um jogador não identificadas com segurança",
  TOTAL_ESQUADRAO_ILEGIVEL: "Total do esquadrão não identificado",
  SOMA_DIFERENTE_DO_TOTAL: "Soma dos jogadores diferente do total do esquadrão",
  NOME_NAO_RECONHECIDO: "Jogador da print não corresponde ao elenco",
  NOME_BAIXA_CONFIANCA: "Nome de jogador com correspondência duvidosa",
  LEITURA_BAIXA_CONFIANCA: "Leitura da IA com baixa confiança",
  VITORIA_INCONSISTENTE: "Vitória e colocação não batem",
  COLOCACAO_REPETIDA: "Outro time já informou essa colocação nesta partida",
  VITORIA_REPETIDA: "Outro time já informou vitória nesta partida",
  POSSIVEL_PRINT_DUPLICADA: "Possível print duplicada",
  DIVERGENCIA_INFORMADA_PELO_CAPITAO: "O capitão discordou da leitura",
  FALHA_NA_IA: "A leitura automática falhou",
};

export const TIEBREAK_LABEL: Record<string, string> = {
  victories: "Mais vitórias",
  baixas: "Mais baixas",
  last_placement: "Melhor colocação na última partida",
};
