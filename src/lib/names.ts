/**
 * Casamento entre o nome lido na print e os jogadores cadastrados no time.
 * Tolera clan tag, caracteres especiais, espaços e maiúsculas/minúsculas.
 */

export type RosterPlayer = { id: string; name: string; nickname: string; aliases?: string[] };
export type NameMatch = { playerId: string | null; score: number };

/** Acima disso o nome é aceito sem conferência humana. */
export const NAME_AUTO_THRESHOLD = 0.85;
/** Abaixo disso o nome é tratado como não reconhecido. */
export const NAME_MIN_THRESHOLD = 0.6;

export function normalizeName(raw: string, clanTag?: string | null): string {
  let s = (raw ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "");
  // remove clan tags entre colchetes/chaves/parênteses: [XAVE$]Nhonho → Nhonho
  s = s.replace(/[\[({<][^\])}>]{1,12}[\])}>]/g, " ");
  s = s.toLowerCase();
  if (clanTag) {
    const tag = clanTag.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/g, "");
    const flat = s.replace(/[^a-z0-9]/g, "");
    // tag digitada sem colchetes na print: "xave nhonho"
    if (tag.length >= 2 && flat.startsWith(tag) && flat.length > tag.length + 1) {
      return flat.slice(tag.length);
    }
    return flat;
  }
  return s.replace(/[^a-z0-9]/g, "");
}

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let last = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, last + (a[i - 1] === b[j - 1] ? 0 : 1));
      last = tmp;
    }
  }
  return prev[b.length];
}

export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const max = Math.max(a.length, b.length);
  return Math.max(0, 1 - levenshtein(a, b) / max);
}

function scoreAgainstPlayer(detected: string, p: RosterPlayer, clanTag?: string | null): number {
  const d = normalizeName(detected, clanTag);
  if (!d) return 0;
  const candidates = [p.nickname, p.name, ...(p.aliases ?? [])]
    .map((c) => normalizeName(c, clanTag))
    .filter(Boolean);
  return Math.max(0, ...candidates.map((c) => similarity(d, c)));
}

/**
 * Atribui cada nome lido a um jogador diferente do elenco, escolhendo a
 * combinação de maior pontuação total. Nomes abaixo do mínimo ficam sem jogador.
 */
export function matchRoster(detected: string[], roster: RosterPlayer[], clanTag?: string | null): NameMatch[] {
  const scores = detected.map((d) => roster.map((p) => scoreAgainstPlayer(d, p, clanTag)));
  let best: { total: number; pick: number[] } = { total: -1, pick: [] };

  const walk = (i: number, used: Set<number>, pick: number[], total: number) => {
    if (i === detected.length) {
      if (total > best.total) best = { total, pick: [...pick] };
      return;
    }
    walk(i + 1, used, [...pick, -1], total); // deixar este nome sem jogador
    roster.forEach((_, j) => {
      if (used.has(j) || scores[i][j] < NAME_MIN_THRESHOLD) return;
      used.add(j);
      walk(i + 1, used, [...pick, j], total + scores[i][j]);
      used.delete(j);
    });
  };
  walk(0, new Set(), [], 0);

  return detected.map((_, i) => {
    const j = best.pick[i] ?? -1;
    return j < 0
      ? { playerId: null, score: Math.max(0, ...scores[i]) }
      : { playerId: roster[j].id, score: scores[i][j] };
  });
}
