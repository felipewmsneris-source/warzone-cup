export type ReportStatus =
  | "RASCUNHO" | "REABERTO" | "ENVIADA" | "EM_ANALISE" | "VALIDADA" | "DIVERGENCIA" | "REJEITADA";
export type MatchStatus = "NAO_LIBERADA" | "ABERTA" | "FECHADA";
export type ImageKind = "PLACEMENT" | "STATS" | "UNKNOWN";

/** Leitura de UMA imagem feita pela IA. Valores não lidos com segurança vêm como null. */
export type ImageReading = {
  index: number;
  type: ImageKind;
  placement: number | null;
  victory: boolean;
  headers: string[];
  players: { detectedName: string; baixas: number | null; confidence: number }[];
  squadTotalBaixas: number | null;
  confidence: number;
  notes: string;
};

export type Flag =
  | "SEM_PRINT_COLOCACAO" | "COLOCACAO_ILEGIVEL" | "COLOCACAO_FORA_DA_FAIXA"
  | "SEM_PRINT_PLACAR" | "COLUNA_BAIXAS_NAO_LOCALIZADA" | "JOGADORES_INCOMPLETOS"
  | "BAIXAS_ILEGIVEIS" | "TOTAL_ESQUADRAO_ILEGIVEL" | "SOMA_DIFERENTE_DO_TOTAL"
  | "NOME_NAO_RECONHECIDO" | "NOME_BAIXA_CONFIANCA" | "LEITURA_BAIXA_CONFIANCA"
  | "VITORIA_INCONSISTENTE" | "COLOCACAO_REPETIDA" | "VITORIA_REPETIDA"
  | "POSSIVEL_PRINT_DUPLICADA" | "LEITURA_MANUAL" | "DIVERGENCIA_INFORMADA_PELO_CAPITAO" | "FALHA_NA_IA";

export type Standing = {
  championship_team_id: string;
  championship_id: string;
  team_number: number;
  tiebreak_manual: number | null;
  team_name: string;
  clan_tag: string | null;
  total_points: number;
  total_baixas: number;
  victories: number;
  matches_played: number;
  points_by_match: Record<string, number>;
  last_placement: number | null;
};

export type RankedStanding = Standing & { position: number; tied: boolean };
