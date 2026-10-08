import Link from "next/link";
import { Shell } from "@/components/Shell";
import { createClient } from "@/lib/supabase/server";
import { getStandings, type Championship } from "@/lib/queries";
import { dateOnly, pts } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Page() {
  const db = await createClient();
  const { data } = await db.from("championships").select("*").neq("status", "RASCUNHO").order("number", { ascending: false });
  const list = (data ?? []) as Championship[];
  const leaders = await Promise.all(list.map(async (c) => (await getStandings(c)).find((s) => s.matches_played > 0)));

  return (
    <Shell>
      <h1 className="text-4xl">Histórico de campeonatos</h1>
      {list.length === 0 && <p className="mt-3 text-muted">Nenhum campeonato publicado ainda.</p>}
      <ul className="mt-5 space-y-2">
        {list.map((c, i) => (
          <li key={c.id}>
            <Link href={`/c/${c.id}`} className="panel flex flex-wrap items-center justify-between gap-3 p-4 hover:border-muted">
              <div>
                <div className="font-display text-2xl font-bold">
                  <span className="mr-2 text-muted">#{String(c.number).padStart(3, "0")}</span>
                  {c.name}
                </div>
                <div className="text-sm text-muted">
                  {dateOnly(c.event_date) || "Sem data"} {c.status === "ATIVO" ? "(em andamento)" : ""}
                </div>
              </div>
              {leaders[i] && (
                <div className="text-right">
                  <div className="text-xs text-muted">{c.status === "ENCERRADO" ? "Campeão" : "Líder"}</div>
                  <div className="font-display text-xl font-semibold">
                    {leaders[i]!.team_name} <span className="text-amber">{pts(leaders[i]!.total_points)}</span>
                  </div>
                </div>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </Shell>
  );
}
