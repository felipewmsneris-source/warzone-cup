import Link from "next/link";
import { notFound } from "next/navigation";
import { Shell } from "@/components/Shell";
import { LiveRefresh } from "@/components/LiveRefresh";
import { createClient } from "@/lib/supabase/server";
import { getChampionship, getStandings } from "@/lib/queries";
import { ordinal, pts, teamNo } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string; ctId: string }> }) {
  const { id, ctId } = await params;
  const championship = await getChampionship(id);
  if (!championship) notFound();
  const standings = await getStandings(championship);
  const team = standings.find((s) => s.championship_team_id === ctId);
  if (!team) notFound();

  const db = await createClient();
  const [{ data: matches }, { data: results }, { data: roster }, { data: ct }] = await Promise.all([
    db.from("matches").select("id, match_number").eq("championship_id", id).order("match_number"),
    db.from("match_results").select("*").eq("championship_team_id", ctId),
    db.from("team_players").select("slot, player_id, players(nickname)").eq("championship_team_id", ctId).order("slot"),
    db.from("championship_teams").select("captain_player_id").eq("id", ctId).maybeSingle(),
  ]);

  return (
    <Shell>
      <LiveRefresh tables={["match_results"]} />
      <Link href={`/c/${id}`} className="text-sm text-muted underline underline-offset-4">Voltar para a classificação</Link>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted">Time {teamNo(team.team_number)} {team.clan_tag}</p>
          <h1 className="text-5xl">{team.team_name}</h1>
          <p className="mt-2 text-sm">
            {(roster ?? []).map((r) => {
              const p = (Array.isArray(r.players) ? r.players[0] : r.players) as { nickname: string };
              return (
                <span key={r.slot} className="mr-4 inline-block">
                  {p.nickname}
                  {r.player_id === ct?.captain_player_id && <span className="ml-1 text-xs text-amber">capitão</span>}
                </span>
              );
            })}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <span className={`plate ${team.matches_played > 0 && team.position <= 3 ? `plate-${team.position}` : ""}`}>{team.position}º</span>
          <div className="font-display text-5xl font-extrabold text-amber">{pts(team.total_points)}</div>
        </div>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(matches ?? []).map((m) => {
          const r = (results ?? []).find((x) => x.match_id === m.id);
          return (
            <section key={m.id} className="panel p-4">
              <h2 className="text-2xl">Partida {m.match_number}</h2>
              {r ? (
                <dl className="mt-3 grid grid-cols-2 gap-y-2 text-sm">
                  <dt className="text-muted">Colocação</dt>
                  <dd className="text-right">{ordinal(r.placement)}{r.victory && <span className="ml-2 font-semibold text-win">Vitória</span>}</dd>
                  <dt className="text-muted">Baixas</dt>
                  <dd className="text-right">{r.scoring_baixas}</dd>
                  <dt className="text-muted">Multiplicador</dt>
                  <dd className="text-right">{pts(r.multiplier)}</dd>
                  {Number(r.bonus) > 0 && (
                    <>
                      <dt className="text-muted">Bônus</dt>
                      <dd className="text-right">{pts(r.bonus)}</dd>
                    </>
                  )}
                  <dt className="border-t border-line pt-2 text-muted">Pontos</dt>
                  <dd className="border-t border-line pt-2 text-right font-display text-2xl font-bold text-amber">{pts(r.points)}</dd>
                </dl>
              ) : (
                <p className="mt-3 text-sm text-muted">Sem resultado validado.</p>
              )}
            </section>
          );
        })}
      </div>
    </Shell>
  );
}
