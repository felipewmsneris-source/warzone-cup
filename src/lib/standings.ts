import type { RankedStanding, Standing } from "./types";

type Key = "victories" | "baixas" | "last_placement";

const cmp: Record<Key, (a: Standing, b: Standing) => number> = {
  victories: (a, b) => b.victories - a.victories,
  baixas: (a, b) => b.total_baixas - a.total_baixas,
  last_placement: (a, b) => (a.last_placement ?? 999) - (b.last_placement ?? 999),
};

/**
 * Ordena por pontos e depois pelos critérios configurados no campeonato.
 * Persistindo o empate, vale a decisão do administrador (tiebreak_manual);
 * sem decisão, os times ficam marcados como empatados.
 */
export function rank(rows: Standing[], tiebreakOrder: string[]): RankedStanding[] {
  const keys = tiebreakOrder.filter((k): k is Key => k in cmp);
  const normalized = rows.map((r) => ({
    ...r,
    total_points: Number(r.total_points),
    points_by_match: Object.fromEntries(
      Object.entries(r.points_by_match ?? {}).map(([k, v]) => [k, Number(v)]),
    ),
  }));
  const auto = (a: Standing, b: Standing) => {
    // centésimos inteiros: comparação exata, sem ruído de ponto flutuante
    const d = Math.round(b.total_points * 100) - Math.round(a.total_points * 100);
    if (d !== 0) return d;
    for (const k of keys) {
      const x = cmp[k](a, b);
      if (x !== 0) return x;
    }
    return 0;
  };
  const sorted = [...normalized].sort(
    (a, b) =>
      auto(a, b) ||
      (a.tiebreak_manual ?? 999) - (b.tiebreak_manual ?? 999) ||
      a.team_number - b.team_number,
  );
  return sorted.map((row, i) => {
    const unresolved = (other?: Standing) =>
      !!other && auto(row, other) === 0 && (row.tiebreak_manual ?? 999) === (other.tiebreak_manual ?? 999);
    return {
      ...row,
      position: i + 1,
      tied: row.matches_played > 0 && (unresolved(sorted[i - 1]) || unresolved(sorted[i + 1])),
    };
  });
}
