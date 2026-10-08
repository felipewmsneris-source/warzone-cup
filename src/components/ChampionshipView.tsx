import Link from "next/link";
import { Shell } from "./Shell";
import { Standings } from "./Standings";
import { LiveRefresh } from "./LiveRefresh";
import { getStandings, type Championship } from "@/lib/queries";
import { dateOnly } from "@/lib/format";

export async function ChampionshipView({ championship }: { championship: Championship }) {
  const rows = await getStandings(championship);
  return (
    <Shell>
      <LiveRefresh tables={["match_results"]} />
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-4xl md:text-5xl">{championship.name}</h1>
          <p className="mt-1 text-sm text-muted">
            Campeonato #{String(championship.number).padStart(3, "0")}
            {championship.event_date && `, ${dateOnly(championship.event_date)}`}
            {championship.status === "ENCERRADO" && " (encerrado)"}
          </p>
        </div>
        <Link href={`/transmissao?c=${championship.id}`} className="btn btn-ghost btn-sm">Modo transmissão</Link>
      </div>
      <Standings rows={rows} championshipId={championship.id} />
      <p className="mt-4 text-xs text-muted">
        Pontos da partida = baixas × multiplicador da colocação. A vitória soma mais 10 pontos. A tabela atualiza sozinha.
      </p>
    </Shell>
  );
}
