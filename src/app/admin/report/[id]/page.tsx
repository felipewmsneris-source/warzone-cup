import Link from "next/link";
import { notFound } from "next/navigation";
import { Shell } from "@/components/Shell";
import { StatusBadge } from "@/components/StatusBadge";
import { ActionForm, Submit } from "@/components/ActionForm";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { adminDb } from "@/lib/supabase/admin";
import { dateTime, displayStatus, FLAG_LABEL, ordinal, pts, teamNo } from "@/lib/format";
import type { Flag, ImageReading, MatchStatus, ReportStatus } from "@/lib/types";
import { correctReport, rejectReport, reopenReport, saveAdminNote, validateReport } from "../../actions";

const pct = (v: number | string | null | undefined) => (v === null || v === undefined ? "–" : `${Math.round(Number(v) * 100)}%`);
const KIND = { PLACEMENT: "Colocação", STATS: "Placar do esquadrão", UNKNOWN: "Não identificada" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const db = await createClient();
  const { data: report } = await db
    .from("reports")
    .select("*, matches(id, match_number, status, championship_id), championship_teams(id, team_number, teams(name, clan_tag))")
    .eq("id", id).maybeSingle();
  if (!report) notFound();
  const match = report.matches as { id: string; match_number: number; status: MatchStatus; championship_id: string };
  const ct = report.championship_teams as { id: string; team_number: number; teams: { name: string; clan_tag: string | null } };

  const [{ data: baixas }, { data: images }, { data: roster }, { data: result }, { data: logs }] = await Promise.all([
    db.from("player_baixas").select("*").eq("report_id", id),
    db.from("report_images").select("*").eq("report_id", id).order("created_at", { ascending: false }),
    db.from("team_players").select("slot, player_id, players(nickname, name)").eq("championship_team_id", ct.id).order("slot"),
    db.from("match_results").select("*").eq("report_id", id).maybeSingle(),
    db.from("audit_logs").select("*").eq("entity_id", id).order("created_at", { ascending: false }),
  ]);
  const signed = await Promise.all(
    (images ?? []).map(async (img) => ({
      ...img,
      url: (await adminDb().storage.from("prints").createSignedUrl(img.storage_path, 900)).data?.signedUrl ?? null,
    })),
  );
  const current = signed.filter((i) => i.is_current);
  const older = signed.filter((i) => !i.is_current);

  const raw = (report.ai_raw ?? {}) as { manual?: boolean; readings?: ImageReading[]; duplicateNotes?: string[]; aiError?: string | null; model?: string | null };
  const manual = !!raw.manual;
  const firstEntry = report.placement === null;
  const stats = raw.readings?.find((r) => r.type === "STATS");
  const flags = (report.flags ?? []) as Flag[];
  const status = report.status as ReportStatus;
  const preview =
    !result && report.placement && report.total_scoring_baixas !== null
      ? (await db.rpc("calc_points", {
          p_championship_id: match.championship_id, p_placement: report.placement, p_scoring_baixas: report.total_scoring_baixas,
        })).data?.[0]
      : null;
  const score = result ?? preview;
  const nick = (playerId: string | null) => {
    const r = (roster ?? []).find((x) => x.player_id === playerId);
    return r ? ((Array.isArray(r.players) ? r.players[0] : r.players) as { nickname: string }).nickname : null;
  };

  return (
    <Shell wide>
      <Link href={`/admin/c/${match.championship_id}/validacao?p=${match.match_number}`} className="text-sm text-muted underline underline-offset-4">
        Voltar para a central de validação
      </Link>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted">Partida {match.match_number}, Time {teamNo(ct.team_number)} {ct.teams.clan_tag}</p>
          <h1 className="text-5xl">{ct.teams.name}</h1>
          <p className="mt-1 text-sm text-muted">
            {report.submitted_at ? `Enviado em ${dateTime(report.submitted_at)}` : "Ainda não confirmado pelo capitão"}
            {report.validated_at && `, validado em ${dateTime(report.validated_at)}${report.validated_by ? "" : " (automático)"}`}
          </p>
        </div>
        <StatusBadge status={displayStatus(match.status, status)} />
      </div>

      {flags.length > 0 && (
        <div className={`panel mt-4 p-4 text-sm ${status === "VALIDADA" ? "" : "border-amber/60"}`}>
          <p className="font-semibold text-amber">{status === "VALIDADA" ? "Alertas levantados no envio" : "Alertas para conferir"}</p>
          <ul className="mt-1 list-disc pl-5">
            {flags.map((f) => <li key={f}>{FLAG_LABEL[f] ?? f}</li>)}
            {(raw.duplicateNotes ?? []).map((n) => <li key={n} className="text-muted">{n}</li>)}
          </ul>
        </div>
      )}
      {report.captain_note && (
        <p className="panel mt-4 p-4 text-sm"><span className="font-semibold">Observação do capitão:</span> {report.captain_note}</p>
      )}

      <div className="mt-5 grid gap-6 lg:grid-cols-[3fr_2fr]">
        <section>
          <h2 className="text-2xl">Prints</h2>
          {current.length === 0 && <p className="mt-2 text-sm text-muted">Nenhuma print enviada.</p>}
          <div className="mt-3 space-y-3">
            {current.map((img) => (
              <figure key={img.id} className="panel overflow-hidden">
                <figcaption className="border-b border-line px-3 py-2 text-sm text-muted">
                  {KIND[img.kind as keyof typeof KIND]}, enviada em {dateTime(img.created_at)}
                </figcaption>
                {img.url && (
                  <a href={img.url} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.url} alt={`Print: ${KIND[img.kind as keyof typeof KIND]}`} className="w-full" />
                  </a>
                )}
              </figure>
            ))}
          </div>
          {older.length > 0 && (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-muted">Prints de envios anteriores ({older.length})</summary>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {older.map((img) => img.url && (
                  <a key={img.id} href={img.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded border border-line">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.url} alt="Print de envio anterior" className="aspect-video w-full object-cover" />
                  </a>
                ))}
              </div>
            </details>
          )}
        </section>

        <div className="space-y-5">
          {!manual && (
          <section className="panel p-4">
            <h2 className="text-2xl">Leitura da IA</h2>
            {raw.aiError && <p className="mt-2 text-sm text-win">A leitura falhou: {raw.aiError}</p>}
            <dl className="mt-3 grid grid-cols-2 gap-y-1 text-sm">
              <dt className="text-muted">Colocação</dt>
              <dd className="text-right">{report.placement ? `${ordinal(report.placement)}${report.placement === 1 ? " (vitória)" : ""}` : "não identificada"}</dd>
              <dt className="text-muted">Confiança geral</dt>
              <dd className="text-right">{pct(report.ai_confidence)}</dd>
            </dl>
            <table className="mt-3 w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr><th className="py-1 font-medium">Nome na print</th><th className="font-medium">Jogador</th><th className="text-right font-medium">Baixas</th></tr>
              </thead>
              <tbody>
                {(baixas ?? []).map((b) => (
                  <tr key={b.id} className="border-t border-line/60">
                    <td className="py-1.5">{b.detected_name ?? "–"}</td>
                    <td>
                      {nick(b.player_id) ?? <span className="text-win">sem correspondência</span>}
                      {b.name_match_score !== null && <span className="ml-1 text-xs text-muted">{pct(b.name_match_score)}</span>}
                    </td>
                    <td className="text-right font-display text-xl font-bold">{b.scoring_baixas ?? <span className="text-win">?</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <dl className="mt-3 grid grid-cols-2 gap-y-1 border-t border-line pt-3 text-sm">
              <dt className="text-muted">Soma dos jogadores</dt>
              <dd className="text-right">{report.total_scoring_baixas ?? "–"}</dd>
              <dt className="text-muted">Total do esquadrão na print</dt>
              <dd className={`text-right ${report.totals_match === false ? "font-semibold text-win" : ""}`}>{report.squad_total_baixas_detected ?? "não lido"}</dd>
              {score && (
                <>
                  <dt className="text-muted">{result ? "Pontos oficiais" : "Pontos se validado"}</dt>
                  <dd className="text-right font-display text-2xl font-bold text-amber">
                    {pts(score.points)}
                    <span className="ml-2 text-xs font-normal text-muted">
                      × {pts(score.multiplier)}{Number(score.bonus) > 0 && ` + ${pts(score.bonus)}`}
                    </span>
                  </dd>
                </>
              )}
            </dl>
            {stats && (
              <p className="mt-3 text-xs text-muted">Colunas vistas no placar: {stats.headers.join(" | ") || "nenhuma"}</p>
            )}
            {(raw.readings ?? []).filter((r) => r.notes).map((r) => (
              <p key={r.index} className="mt-1 text-xs text-muted">Imagem {r.index + 1}: {r.notes}</p>
            ))}
          </section>
          )}

          <section className={`panel p-4 ${firstEntry ? "border-amber/60" : ""}`}>
            <h2 className="text-2xl">{firstEntry ? "Lançar resultado" : "Corrigir resultado"}</h2>
            <p className="mt-1 text-sm text-muted">
              Olhe as prints ao lado. Na tela de resultado, veja a colocação (VITÓRIA = 1). No placar do esquadrão,
              use só a coluna <strong className="text-ink">Baixas</strong>; a coluna Eliminações não conta.
            </p>
            {score && (
              <p className="mt-2 text-sm">
                {result ? "Pontos oficiais" : "Pontos se validado"}:{" "}
                <span className="font-display text-xl font-bold text-amber">{pts(score.points)}</span>
                <span className="ml-1 text-xs text-muted">
                  ({report.total_scoring_baixas} × {pts(score.multiplier)}{Number(score.bonus) > 0 && ` + ${pts(score.bonus)}`})
                </span>
              </p>
            )}
            <ActionForm action={correctReport} className="mt-3 space-y-3">
              <input type="hidden" name="report_id" value={id} />
              <div>
                <label className="label" htmlFor="placement">Colocação (1 = vitória)</label>
                <input id="placement" name="placement" type="number" min={1} max={16} defaultValue={report.placement ?? ""} className="field" required />
              </div>
              {(roster ?? []).map((r) => {
                const p = (Array.isArray(r.players) ? r.players[0] : r.players) as { nickname: string };
                const row = (baixas ?? []).find((b) => b.player_id === r.player_id);
                return (
                  <div key={r.player_id}>
                    <label className="label" htmlFor={`b-${r.player_id}`}>Baixas de {p.nickname}</label>
                    <input id={`b-${r.player_id}`} name={`baixas_${r.player_id}`} type="number" min={0} defaultValue={row?.scoring_baixas ?? ""} className="field" required />
                  </div>
                );
              })}
              <div>
                <label className="label" htmlFor="reason-c">{firstEntry ? "Observação (opcional)" : "Motivo da correção"}</label>
                <input
                  id="reason-c" name="reason" className="field" required={!firstEntry}
                  placeholder={firstEntry ? "Lançamento manual a partir das prints" : "Correção após conferência da screenshot"}
                />
              </div>
              {status !== "VALIDADA" && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="validate" defaultChecked className="size-4" />
                  Validar ao salvar (o resultado entra na classificação)
                </label>
              )}
              <Submit className={firstEntry ? "btn w-full" : "btn btn-ghost"}>{firstEntry ? "Lançar resultado" : "Salvar correção"}</Submit>
            </ActionForm>
          </section>

          <section className="panel space-y-4 p-4">
            <h2 className="text-2xl">Decisão</h2>
            {status !== "VALIDADA" && (
              <ActionForm action={validateReport}>
                <input type="hidden" name="report_id" value={id} />
                <Submit className="btn btn-ok w-full">Validar report</Submit>
              </ActionForm>
            )}
            <ActionForm action={rejectReport} className="grid grid-cols-[1fr_auto] gap-2">
              <input type="hidden" name="report_id" value={id} />
              <input name="reason" className="field" placeholder="Motivo da rejeição" aria-label="Motivo da rejeição" required />
              <Submit className="btn btn-danger">Rejeitar</Submit>
            </ActionForm>
            <ActionForm action={reopenReport} className="grid grid-cols-[1fr_auto] gap-2">
              <input type="hidden" name="report_id" value={id} />
              <input name="reason" className="field" placeholder="Motivo da reabertura" aria-label="Motivo da reabertura" required />
              <Submit className="btn btn-ghost">Reabrir</Submit>
            </ActionForm>
            <p className="text-xs text-muted">Reabrir tira o resultado da classificação e libera o capitão para enviar as prints de novo.</p>
            <ActionForm action={saveAdminNote} className="border-t border-line pt-4">
              <input type="hidden" name="report_id" value={id} />
              <label className="label" htmlFor="note">Observações</label>
              <textarea id="note" name="note" rows={2} defaultValue={report.admin_note ?? ""} className="field" />
              <div className="mt-2"><Submit className="btn btn-ghost btn-sm">Salvar observação</Submit></div>
            </ActionForm>
          </section>
        </div>
      </div>

      <section className="mt-6">
        <h2 className="text-2xl">Histórico deste report</h2>
        {(logs ?? []).length === 0 && <p className="mt-2 text-sm text-muted">Nenhuma alteração administrativa.</p>}
        <ul className="mt-3 space-y-2 text-sm">
          {(logs ?? []).map((l) => (
            <li key={l.id} className="panel p-3">
              <span className="text-muted">{dateTime(l.created_at)}</span> <span className="font-semibold">{l.username}</span> {l.action.toLowerCase()}
              {l.field && <>: {l.field} <span className="text-muted">{l.old_value ?? "–"}</span> → <span className="font-semibold">{l.new_value ?? "–"}</span></>}
              {l.reason && <div className="text-muted">Motivo: {l.reason}</div>}
            </li>
          ))}
        </ul>
      </section>
    </Shell>
  );
}
