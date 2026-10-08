import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { LiveRefresh } from "@/components/LiveRefresh";
import { StatusBadge } from "@/components/StatusBadge";
import { Deadline } from "@/components/Deadline";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { adminDb } from "@/lib/supabase/admin";
import { canSubmit } from "@/lib/rules";
import { displayStatus, FLAG_LABEL, ordinal, pts, teamNo } from "@/lib/format";
import type { Flag, MatchStatus, ReportStatus } from "@/lib/types";
import { UploadPrints, ConfirmButtons } from "./ReportFlow";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // a leitura das prints pela IA pode levar alguns segundos

export default async function Page({ params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = await params;
  const profile = await requireProfile();
  if (profile.role === "ADMIN") redirect("/admin");
  const db = await createClient();

  const { data: match } = await db.from("matches").select("*").eq("id", matchId).maybeSingle();
  if (!match) notFound();
  const { data: ct } = await db
    .from("championship_teams").select("id, team_number, teams(name)")
    .eq("championship_id", match.championship_id).eq("captain_user_id", profile.id).maybeSingle();
  if (!ct) notFound();
  const team = (Array.isArray(ct.teams) ? ct.teams[0] : ct.teams) as { name: string };

  const { data: report } = await db
    .from("reports").select("*").eq("match_id", matchId).eq("championship_team_id", ct.id).maybeSingle();
  const [{ data: baixas }, { data: images }] = report
    ? await Promise.all([
        db.from("player_baixas").select("*, players(nickname)").eq("report_id", report.id),
        db.from("report_images").select("id, storage_path, kind").eq("report_id", report.id).eq("is_current", true),
      ])
    : [{ data: [] }, { data: [] }];

  // o RLS já garantiu que estas imagens são do time do capitão; só então assinamos as URLs
  const signed = await Promise.all(
    (images ?? []).map(async (img) => {
      const { data } = await adminDb().storage.from("prints").createSignedUrl(img.storage_path, 600);
      return { id: img.id, kind: img.kind, url: data?.signedUrl ?? null };
    }),
  );

  const preview =
    report?.placement && report.total_scoring_baixas !== null
      ? (await db.rpc("calc_points", {
          p_championship_id: match.championship_id,
          p_placement: report.placement,
          p_scoring_baixas: report.total_scoring_baixas,
        })).data?.[0]
      : null;

  const status = displayStatus(match.status as MatchStatus, report?.status as ReportStatus | undefined);
  const allowed = canSubmit(match, report);
  const isDraft = report?.status === "RASCUNHO" && !!report.ai_raw;
  const hasReading = !!report?.ai_raw;
  const flags = ((report?.flags ?? []) as Flag[]);
  const unreadable = "Não foi possível identificar com segurança.";

  return (
    <Shell>
      <LiveRefresh tables={["reports", "matches"]} />
      <Link href="/capitao" className="text-sm text-muted underline underline-offset-4">Voltar para o meu time</Link>
      <div className="mt-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted">Time {teamNo(ct.team_number)} {team.name}</p>
          <h1 className="text-5xl">Partida {match.match_number}</h1>
        </div>
        <StatusBadge status={status} />
      </div>
      {allowed.ok && match.deadline && !report?.late_allowed && (
        <p className="mt-2 text-sm"><Deadline iso={match.deadline} /></p>
      )}
      {report?.late_allowed && allowed.ok && (
        <p className="mt-2 text-sm text-amber">O administrador autorizou o envio deste report.</p>
      )}
      {report?.status === "REJEITADA" && (
        <p className="panel mt-4 border-win/60 p-3 text-sm">
          <span className="font-semibold text-win">Report rejeitado.</span> {report.admin_note}
        </p>
      )}

      {hasReading && report && (
        <section className="panel mt-5 p-4">
          <h2 className="text-2xl">{isDraft ? "Resultado identificado" : "Resultado enviado"}</h2>
          <dl className="mt-4 space-y-4">
            <div>
              <dt className="text-sm text-muted">Colocação</dt>
              <dd className="font-display text-3xl font-bold">
                {report.placement ? (
                  <>
                    {ordinal(report.placement)}
                    {report.placement === 1 && <span className="ml-3 text-win">Vitória</span>}
                  </>
                ) : (
                  <span className="text-lg font-normal text-win">{unreadable}</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted">Baixas</dt>
              <dd>
                {(baixas ?? []).length === 0 && <span className="text-win">{unreadable}</span>}
                <ul className="mt-1 divide-y divide-line/60">
                  {(baixas ?? []).map((b) => {
                    const p = (Array.isArray(b.players) ? b.players[0] : b.players) as { nickname: string } | null;
                    return (
                      <li key={b.id} className="flex items-center justify-between py-1.5">
                        <span>
                          {p?.nickname ?? b.detected_name}
                          {!p && <span className="ml-2 text-xs text-win">não está no elenco</span>}
                        </span>
                        <span className="font-display text-2xl font-bold">
                          {b.scoring_baixas ?? <span className="text-sm font-normal text-win">ilegível</span>}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </dd>
            </div>
            <div className="flex items-end justify-between border-t border-line pt-3">
              <div>
                <dt className="text-sm text-muted">Total</dt>
                <dd className="font-display text-3xl font-bold">
                  {report.total_scoring_baixas !== null ? `${report.total_scoring_baixas} baixas` : "–"}
                </dd>
              </div>
              {preview && (
                <div className="text-right">
                  <dt className="text-sm text-muted">
                    {report.total_scoring_baixas} × {pts(preview.multiplier)}
                    {Number(preview.bonus) > 0 && ` + ${pts(preview.bonus)}`}
                  </dt>
                  <dd className="font-display text-4xl font-extrabold text-amber">{pts(preview.points)} pontos</dd>
                </div>
              )}
            </div>
          </dl>

          {flags.length > 0 && report.status !== "VALIDADA" && (
            <div className="mt-4 rounded border border-amber/50 p-3 text-sm">
              <p className="font-semibold text-amber">Este report passa pela conferência do administrador.</p>
              <ul className="mt-1 list-disc pl-5 text-muted">
                {flags.map((f) => <li key={f}>{FLAG_LABEL[f] ?? f}</li>)}
              </ul>
            </div>
          )}
          {report.captain_note && <p className="mt-3 text-sm text-muted">Sua observação: {report.captain_note}</p>}
          {report.admin_note && report.status !== "REJEITADA" && (
            <p className="mt-3 text-sm text-muted">Observação do administrador: {report.admin_note}</p>
          )}

          {signed.length > 0 && (
            <div className="mt-4 grid grid-cols-2 gap-2">
              {signed.map((img) =>
                img.url ? (
                  <a key={img.id} href={img.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded border border-line">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.url} alt={img.kind === "PLACEMENT" ? "Print da colocação" : img.kind === "STATS" ? "Print do placar" : "Print enviada"} className="aspect-video w-full object-cover" />
                  </a>
                ) : null,
              )}
            </div>
          )}

          {isDraft && allowed.ok && (
            <ConfirmButtons matchId={matchId} needsReview={flags.length > 0} />
          )}
        </section>
      )}

      {allowed.ok ? (
        <UploadPrints matchId={matchId} resend={hasReading} />
      ) : (
        !hasReading && <p className="panel mt-5 p-4 text-muted">{allowed.reason}</p>
      )}
    </Shell>
  );
}
