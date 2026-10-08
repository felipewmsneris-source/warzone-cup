import Link from "next/link";
import { pts, teamNo } from "@/lib/format";
import type { RankedStanding } from "@/lib/types";

const MATCHES = [1, 2, 3, 4, 5, 6];

function Stat({ value, label }: { value: string | number; label: string }) {
  return (
    <div>
      <div className="font-display text-2xl font-bold leading-none">{value}</div>
      <div className="mt-1 text-xs text-muted">{label}</div>
    </div>
  );
}

export function Standings({ rows, championshipId }: { rows: RankedStanding[]; championshipId: string }) {
  if (rows.length === 0) {
    return <p className="panel p-6 text-muted">Os times deste campeonato ainda não foram cadastrados.</p>;
  }
  const started = rows.some((r) => r.matches_played > 0);
  const podium = started ? rows.slice(0, 3) : [];
  const href = (r: RankedStanding) => `/c/${championshipId}/time/${r.championship_team_id}`;

  return (
    <div className="space-y-6">
      {podium.length > 0 && (
        <ol className="grid gap-3 md:grid-cols-3">
          {podium.map((r) => (
            <li key={r.championship_team_id}>
              <Link
                href={href(r)}
                className={`panel block h-full p-4 hover:border-muted ${r.position === 1 ? "border-gold/70" : ""}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className={`plate plate-${r.position}`}>{r.position}º</span>
                  <span className="text-xs text-muted">Time {teamNo(r.team_number)}</span>
                </div>
                <div className="mt-3 truncate font-display text-3xl font-bold">{r.team_name}</div>
                <div className="mt-1 font-display text-5xl font-extrabold text-amber">
                  {pts(r.total_points)}
                  <span className="ml-2 text-lg font-semibold text-muted">pontos</span>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-3">
                  <Stat value={r.total_baixas} label="baixas" />
                  <Stat value={r.victories} label="vitórias" />
                  <Stat value={r.matches_played} label="partidas" />
                </div>
              </Link>
            </li>
          ))}
        </ol>
      )}

      <div className="panel overflow-x-auto">
        <table className="w-full text-left">
          <thead className="border-b border-line text-xs text-muted">
            <tr>
              <th className="px-3 py-2 font-medium">Pos</th>
              <th className="px-2 py-2 font-medium">Time</th>
              {MATCHES.map((m) => (
                <th key={m} className="hidden px-2 py-2 text-right font-medium md:table-cell">P{m}</th>
              ))}
              <th className="px-2 py-2 text-right font-medium">Baixas</th>
              <th className="px-2 py-2 text-right font-medium"><span className="sm:hidden">Vit.</span><span className="hidden sm:inline">Vitórias</span></th>
              <th className="px-3 py-2 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.championship_team_id} className="border-b border-line/60 last:border-0 hover:bg-raised/60">
                <td className="py-2 pl-2 pr-0 sm:px-3">
                  <span className={`plate ${started && r.position <= 3 ? `plate-${r.position}` : ""}`}>{r.position}</span>
                </td>
                <td className="w-full max-w-0 px-2 py-2">
                  <Link href={href(r)} className="block [overflow-wrap:anywhere] font-display text-lg font-semibold leading-tight hover:text-amber sm:text-xl">
                    {r.team_name}
                  </Link>
                  <span className="text-xs text-muted">
                    Time {teamNo(r.team_number)}
                    {r.tied && <span className="ml-2 text-amber">empate a decidir</span>}
                  </span>
                </td>
                {MATCHES.map((m) => (
                  <td key={m} className="hidden px-2 py-2 text-right text-sm md:table-cell">
                    {m in r.points_by_match ? pts(r.points_by_match[m]) : <span className="text-line">–</span>}
                  </td>
                ))}
                <td className="px-1.5 py-2 text-right sm:px-2">{r.total_baixas}</td>
                <td className="px-1.5 py-2 text-right sm:px-2">{r.victories}</td>
                <td className="whitespace-nowrap py-2 pl-1 pr-3 text-right font-display text-2xl font-bold text-amber">{pts(r.total_points)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
