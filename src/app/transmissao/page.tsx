import { LiveRefresh } from "@/components/LiveRefresh";
import { currentChampionship, getChampionship, getStandings } from "@/lib/queries";
import { pts } from "@/lib/format";
import type { RankedStanding } from "@/lib/types";

export const dynamic = "force-dynamic";

function Row({ r, started }: { r: RankedStanding; started: boolean }) {
  const top = started && r.position <= 3;
  return (
    <li
      className={`grid h-[96px] grid-cols-[128px_1fr_120px_120px_190px] items-center border-b border-line/70 bg-panel/90 ${
        top ? "border-l-[6px]" : "border-l-[6px] border-l-transparent"
      } ${r.position === 1 && top ? "border-l-gold" : r.position === 2 && top ? "border-l-silver" : top ? "border-l-bronze" : ""}`}
    >
      <span className={`plate ml-4 !h-[58px] !min-w-[78px] !text-[40px] ${top ? `plate-${r.position}` : ""}`}>{r.position}</span>
      <span className="truncate pl-5 pr-4 font-display text-[46px] font-bold leading-none">{r.team_name}</span>
      <span className="text-center font-display text-[40px] font-semibold">{r.total_baixas}</span>
      <span className="text-center font-display text-[40px] font-semibold">{r.victories}</span>
      <span className="pr-6 text-right font-display text-[56px] font-extrabold text-amber">{pts(r.total_points)}</span>
    </li>
  );
}

function Column({ rows, started }: { rows: RankedStanding[]; started: boolean }) {
  return (
    <div>
      <div className="grid h-[44px] grid-cols-[128px_1fr_120px_120px_190px] items-center text-[20px] text-muted">
        <span className="pl-6">Pos</span>
        <span className="pl-5">Time</span>
        <span className="text-center">Baixas</span>
        <span className="text-center">Vitórias</span>
        <span className="pr-6 text-right">Pontos</span>
      </div>
      <ol>{rows.map((r) => <Row key={r.championship_team_id} r={r} started={started} />)}</ol>
    </div>
  );
}

export default async function Page({ searchParams }: { searchParams: Promise<{ c?: string; fundo?: string }> }) {
  const { c, fundo } = await searchParams;
  const championship = c ? await getChampionship(c) : await currentChampionship();
  if (!championship) {
    return <p className="p-10 text-2xl text-muted">Nenhum campeonato publicado para transmitir.</p>;
  }
  const rows = await getStandings(championship);
  const started = rows.some((r) => r.matches_played > 0);
  const half = Math.ceil(rows.length / 2);
  const played = Math.max(0, ...rows.map((r) => r.matches_played));

  return (
    <div
      className="relative h-[1080px] w-[1920px] overflow-hidden px-[60px] pt-[44px]"
      style={{ background: fundo === "transparente" ? "transparent" : "linear-gradient(160deg, #0d141b 0%, #121d27 60%, #0d141b 100%)" }}
    >
      {fundo === "transparente" && <style>{"html,body{background:transparent!important}"}</style>}
      <LiveRefresh tables={["match_results"]} intervalMs={10000} />
      <header className="mb-[22px] flex items-end justify-between border-b-4 border-amber pb-[16px]">
        <h1 className="text-[76px] font-extrabold leading-none">{championship.name}</h1>
        <p className="font-display text-[34px] font-semibold text-muted">
          Classificação {played > 0 ? `após a partida ${played} de 6` : "antes da primeira partida"}
        </p>
      </header>
      <div className="grid grid-cols-2 gap-[40px]">
        <Column rows={rows.slice(0, half)} started={started} />
        <Column rows={rows.slice(half)} started={started} />
      </div>
    </div>
  );
}
