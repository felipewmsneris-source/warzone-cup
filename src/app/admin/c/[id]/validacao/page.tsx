import Link from "next/link";
import { notFound } from "next/navigation";
import { Shell } from "@/components/Shell";
import { AdminNav } from "@/components/AdminNav";
import { LiveRefresh } from "@/components/LiveRefresh";
import { StatusBadge } from "@/components/StatusBadge";
import { ActionForm, Submit } from "@/components/ActionForm";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getChampionship } from "@/lib/queries";
import { ACTIVE } from "@/lib/rules";
import { displayStatus, FLAG_LABEL, ordinal, pts, teamNo, timeOnly } from "@/lib/format";
import type { Flag, MatchStatus, ReportStatus } from "@/lib/types";
import { allowLate } from "../../../actions";

const MATCH_LABEL: Record<MatchStatus, string> = { NAO_LIBERADA: "não liberada", ABERTA: "aberta", FECHADA: "fechada" };

export default async function Page({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<{ p?: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const { p } = await searchParams;
  const c = await getChampionship(id);
  if (!c) notFound();
  const db = await createClient();
  const [{ data: matches }, { data: teams }] = await Promise.all([
    db.from("matches").select("*").eq("championship_id", id).order("match_number"),
    db.from("championship_teams").select("id, team_number, teams(name)").eq("championship_id", id).order("team_number"),
  ]);
  const matchList = matches ?? [];
  const matchIds = matchList.map((m) => m.id);
  const [{ data: reports }, { data: results }] = await Promise.all([
    matchIds.length ? db.from("reports").select("*").in("match_id", matchIds) : Promise.resolve({ data: [] }),
    db.from("match_results").select("report_id, points").eq("championship_id", id),
  ]);
  const all = (reports ?? []) as {
    id: string; match_id: string; championship_team_id: string; status: ReportStatus; placement: number | null;
    total_scoring_baixas: number | null; flags: Flag[]; late_allowed: boolean; submitted_at: string | null;
  }[];

  const pending = (mId: string) =>
    all.filter((r) => r.match_id === mId && ["ENVIADA", "EM_ANALISE", "DIVERGENCIA"].includes(r.status)).length;
  const selected =
    matchList.find((m) => String(m.match_number) === p) ??
    matchList.find((m) => pending(m.id) > 0) ??
    [...matchList].reverse().find((m) => m.status !== "NAO_LIBERADA") ??
    matchList[0];
  if (!selected) notFound();

  const here = all.filter((r) => r.match_id === selected.id);
  const sent = here.filter((r) => ACTIVE.includes(r.status));
  const count = (st: ReportStatus[]) => here.filter((r) => st.includes(r.status)).length;
  const total = (teams ?? []).length;

  // colocações repetidas entre os reports enviados desta partida
  const byPlacement = new Map<number, string[]>();
  sent.forEach((r) => {
    if (r.placement) byPlacement.set(r.placement, [...(byPlacement.get(r.placement) ?? []), r.championship_team_id]);
  });
  const clashes = [...byPlacement.entries()].filter(([, ids]) => ids.length > 1);
  const number = (ctId: string) => teamNo((teams ?? []).find((t) => t.id === ctId)?.team_number ?? 0);

  const tiles = [
    { label: "times", value: total },
    { label: "enviados", value: sent.length },
    { label: "validados", value: count(["VALIDADA"]) },
    { label: "em análise", value: count(["ENVIADA", "EM_ANALISE", "DIVERGENCIA"]) },
    { label: "faltando", value: total - sent.length },
  ];

  return (
    <Shell wide>
      <LiveRefresh tables={["reports", "match_results", "matches"]} intervalMs={15000} />
      <AdminNav c={c} current="validacao" />

      <nav className="flex flex-wrap gap-2" aria-label="Partidas">
        {matchList.map((m) => (
          <Link
            key={m.id}
            href={`?p=${m.match_number}`}
            aria-current={m.id === selected.id ? "page" : undefined}
            className={`rounded border px-3 py-2 text-sm ${m.id === selected.id ? "border-amber bg-raised" : "border-line hover:bg-raised"}`}
          >
            <span className="font-display text-xl font-bold">Partida {m.match_number}</span>
            <span className="ml-2 text-muted">{MATCH_LABEL[m.status as MatchStatus]}</span>
            {pending(m.id) > 0 && <span className="ml-2 font-semibold text-win">{pending(m.id)} para conferir</span>}
          </Link>
        ))}
      </nav>

      <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {tiles.map((t) => (
          <div key={t.label} className="panel p-3">
            <div className="font-display text-4xl font-bold">{t.value}</div>
            <div className="text-sm text-muted">{t.label}</div>
          </div>
        ))}
      </div>
      {selected.deadline && <p className="mt-2 text-sm text-muted">Prazo dos reports: {timeOnly(selected.deadline)}</p>}

      {clashes.length > 0 && (
        <div role="alert" className="panel mt-4 border-win/70 p-4 text-sm">
          <p className="font-semibold text-win">Colocações repetidas nesta partida</p>
          <ul className="mt-1 list-disc pl-5">
            {clashes.map(([placement, ids]) => (
              <li key={placement}>
                {placement === 1 ? "Mais de um time com vitória" : `Mais de um time em ${placement}º`}: times {ids.map(number).join(" e ")}
              </li>
            ))}
          </ul>
        </div>
      )}

      <ul className="mt-5 grid gap-2 md:grid-cols-2">
        {(teams ?? []).map((t) => {
          const team = (Array.isArray(t.teams) ? t.teams[0] : t.teams) as { name: string };
          const r = here.find((x) => x.championship_team_id === t.id);
          const status = displayStatus(selected.status as MatchStatus, r?.status);
          const result = r && (results ?? []).find((x) => x.report_id === r.id);
          const showReport = r && r.status !== "REABERTO" && (r.status !== "RASCUNHO" || r.placement !== null || r.flags.includes("LEITURA_MANUAL"));
          const flags = r && r.status !== "VALIDADA" ? r.flags : [];
          return (
            <li key={t.id} className={`panel p-3 ${status === "DIVERGENCIA" ? "border-win/60" : ""}`}>
              <div className="flex items-center gap-3">
                <span className="plate">{teamNo(t.team_number)}</span>
                <span className="min-w-0 flex-1 truncate font-display text-xl font-semibold">{team.name}</span>
                <StatusBadge status={status} />
              </div>
              {showReport && r && (
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="text-muted">
                    {r.placement === null && r.flags.includes("LEITURA_MANUAL")
                      ? "aguardando lançamento"
                      : <>{r.placement ? ordinal(r.placement) : "colocação ?"}, {r.total_scoring_baixas ?? "?"} baixas</>}
                    {result && <span className="ml-2 font-semibold text-amber">{pts(result.points)} pts</span>}
                    {r.status === "RASCUNHO" && " (capitão ainda não confirmou)"}
                  </span>
                  <Link href={`/admin/report/${r.id}`} className="btn btn-ghost btn-sm">Abrir report</Link>
                </div>
              )}
              {flags.length > 0 && showReport && (
                <ul className="mt-2 list-disc pl-5 text-xs text-amber">
                  {flags.map((f) => <li key={f}>{FLAG_LABEL[f] ?? f}</li>)}
                </ul>
              )}
              {!showReport && (
                r?.late_allowed ? (
                  <p className="mt-2 text-sm text-amber">Envio autorizado, aguardando o capitão.</p>
                ) : (
                  <ActionForm action={allowLate} className="mt-2">
                    <input type="hidden" name="match_id" value={selected.id} />
                    <input type="hidden" name="ct_id" value={t.id} />
                    <Submit className="text-sm underline underline-offset-4">Autorizar envio fora do prazo</Submit>
                  </ActionForm>
                )
              )}
            </li>
          );
        })}
      </ul>
    </Shell>
  );
}
