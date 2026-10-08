"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireProfile, type Profile } from "@/lib/auth";
import { adminDb } from "@/lib/supabase/admin";
import { canSubmit, ACTIVE } from "@/lib/rules";
import { evaluateReadings, nameFlags, statusOnConfirm } from "@/lib/evaluate";
import { matchRoster, type RosterPlayer } from "@/lib/names";
import { dhash, hamming, sha256, PHASH_MAX_DISTANCE } from "@/lib/imagehash";
import { readScreenshots, type VisionImage } from "@/lib/vision";
import { notify } from "@/lib/log";
import type { Flag, ImageReading } from "@/lib/types";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

const MIME: Record<string, VisionImage["mediaType"]> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
};

/** Carrega partida + time do capitão logado. Falha se o time não for dele. */
async function loadContext(user: Profile, matchId: string) {
  const db = adminDb();
  const { data: match } = await db
    .from("matches").select("id, championship_id, match_number, status, deadline").eq("id", matchId).maybeSingle();
  if (!match) return null;
  const { data: ct } = await db
    .from("championship_teams")
    .select("id, team_number, team_id, captain_user_id, teams(name, clan_tag)")
    .eq("championship_id", match.championship_id)
    .eq("captain_user_id", user.id)
    .maybeSingle();
  if (!ct) return null;
  const { data: report } = await db
    .from("reports").select("*").eq("match_id", match.id).eq("championship_team_id", ct.id).maybeSingle();
  return { db, match, ct, report };
}

/** Passo 1: confere a permissão e devolve URLs assinadas para o envio direto das prints. */
export async function prepareUpload(
  matchId: string,
  exts: string[],
): Promise<Result<{ uploads: { path: string; token: string }[] }>> {
  const user = await requireProfile();
  const ctx = await loadContext(user, matchId);
  if (!ctx) return fail("Partida não encontrada para o seu time.");
  const { db, match, ct } = ctx;
  let { report } = ctx;

  const allowed = canSubmit(match, report);
  if (!allowed.ok) return fail(allowed.reason!);
  if (exts.length < 1 || exts.length > 4) return fail("Envie de 1 a 4 imagens.");
  if (exts.some((e) => !MIME[e])) return fail("Formato de imagem não aceito. Use JPG, PNG ou WEBP.");

  if (!report) {
    const { data, error } = await db
      .from("reports")
      .insert({ match_id: match.id, championship_team_id: ct.id, status: "RASCUNHO" })
      .select("*").single();
    if (error) return fail("Não foi possível iniciar o report. Tente de novo.");
    report = data;
  }
  const { count } = await db
    .from("report_images").select("id", { count: "exact", head: true }).eq("report_id", report.id);
  if ((count ?? 0) >= 16) return fail("Limite de reenvios atingido nesta partida. Fale com o administrador.");

  const prefix = `${match.championship_id}/partida-${match.match_number}/time-${ct.team_number}/${report.id}`;
  const uploads: { path: string; token: string }[] = [];
  for (const ext of exts) {
    const path = `${prefix}/${randomUUID()}.${ext}`;
    const { data, error } = await db.storage.from("prints").createSignedUploadUrl(path);
    if (error || !data) return fail("Não foi possível preparar o envio das imagens.");
    uploads.push({ path, token: data.token });
  }
  return { ok: true, uploads };
}

/** Passo 2: guarda as prints, procura duplicadas, lê com a IA e grava a leitura como rascunho. */
export async function analyzeReport(matchId: string, paths: string[]): Promise<Result> {
  const user = await requireProfile();
  const ctx = await loadContext(user, matchId);
  if (!ctx || !ctx.report) return fail("Report não encontrado para o seu time.");
  const { db, match, ct, report } = ctx;

  const allowed = canSubmit(match, report);
  if (!allowed.ok) return fail(allowed.reason!);
  const prefix = `${match.championship_id}/partida-${match.match_number}/time-${ct.team_number}/${report.id}/`;
  if (paths.length < 1 || paths.length > 4 || paths.some((p) => !p.startsWith(prefix) || p.includes(".."))) {
    return fail("Imagens inválidas para este report.");
  }

  // baixa do storage o que o capitão acabou de enviar
  const files: { path: string; buf: Buffer; mediaType: VisionImage["mediaType"] }[] = [];
  for (const path of paths) {
    const { data, error } = await db.storage.from("prints").download(path);
    if (error || !data) return fail("Uma das imagens não chegou ao servidor. Envie de novo.");
    const buf = Buffer.from(await data.arrayBuffer());
    if (buf.length > 10 * 1024 * 1024) return fail("Imagem acima de 10 MB.");
    files.push({ path, buf, mediaType: MIME[path.split(".").pop()!.toLowerCase()] });
  }

  // prints anteriores continuam guardadas, mas deixam de ser as atuais
  await db.from("report_images").update({ is_current: false }).eq("report_id", report.id);
  const { data: imageRows, error: imgErr } = await db
    .from("report_images")
    .insert(
      files.map((f) => ({
        report_id: report.id,
        championship_id: match.championship_id,
        match_id: match.id,
        championship_team_id: ct.id,
        uploaded_by: user.id,
        storage_path: f.path,
      })),
    )
    .select("id, storage_path");
  if (imgErr || !imageRows) return fail("Não foi possível registrar as imagens.");

  // ---------- duplicadas ----------
  const flags = new Set<Flag>();
  const duplicateNotes: string[] = [];
  try {
    const hashes = await Promise.all(files.map(async (f) => ({ sha: sha256(f.buf), ph: await dhash(f.buf) })));
    const { data: known } = await db
      .from("image_hashes")
      .select("sha256, phash, report_images!inner(report_id, championship_team_id, match_id)")
      .eq("championship_id", match.championship_id);
    const { data: sameFileElsewhere } = await db
      .from("image_hashes")
      .select("sha256, phash, report_images!inner(report_id, championship_team_id, match_id)")
      .in("sha256", hashes.map((h) => h.sha));
    type Known = { sha256: string; phash: string; report_images: { report_id: string } | { report_id: string }[] };
    const others = [...((known ?? []) as Known[]), ...((sameFileElsewhere ?? []) as Known[])].filter((k) => {
      const ri = Array.isArray(k.report_images) ? k.report_images[0] : k.report_images;
      return ri && ri.report_id !== report.id;
    });
    hashes.forEach((h, i) => {
      const hit = others.find((o) => o.sha256 === h.sha || hamming(o.phash, h.ph) <= PHASH_MAX_DISTANCE);
      if (hit) {
        flags.add("POSSIVEL_PRINT_DUPLICADA");
        duplicateNotes.push(`Imagem ${i + 1} parece igual a uma print de outro report.`);
      }
    });
    if (hashes.length === 2 && hashes[0].sha === hashes[1].sha) {
      flags.add("POSSIVEL_PRINT_DUPLICADA");
      duplicateNotes.push("As duas imagens enviadas são o mesmo arquivo.");
    }
    await db.from("image_hashes").insert(
      hashes.map((h, i) => ({
        report_image_id: imageRows.find((r) => r.storage_path === files[i].path)!.id,
        championship_id: match.championship_id,
        sha256: h.sha,
        phash: h.ph,
      })),
    );
  } catch {
    return fail("Uma das imagens está corrompida ou não é uma imagem válida.");
  }

  // ---------- leitura pela IA ----------
  let readings: ImageReading[] = [];
  let aiError: string | null = null;
  try {
    readings = await readScreenshots(files.map((f) => ({ data: f.buf, mediaType: f.mediaType })));
  } catch (e) {
    aiError = e instanceof Error ? e.message : "erro desconhecido";
    flags.add("FALHA_NA_IA");
  }

  const ev = evaluateReadings(readings);
  ev.flags.forEach((f) => flags.add(f));

  // ---------- nomes x elenco ----------
  const { data: rosterRows } = await db
    .from("team_players").select("player_id, players(id, name, nickname)").eq("championship_team_id", ct.id);
  const { data: aliasRows } = await db.from("team_aliases").select("player_id, alias").eq("team_id", ct.team_id);
  const roster: RosterPlayer[] = (rosterRows ?? []).map((r) => {
    const p = (Array.isArray(r.players) ? r.players[0] : r.players) as { id: string; name: string; nickname: string };
    return { ...p, aliases: (aliasRows ?? []).filter((a) => a.player_id === p.id).map((a) => a.alias) };
  });
  const team = (Array.isArray(ct.teams) ? ct.teams[0] : ct.teams) as { clan_tag: string | null } | null;
  const matches = matchRoster(ev.players.map((p) => p.detectedName), roster, team?.clan_tag);
  if (ev.players.length > 0) nameFlags(matches).forEach((f) => flags.add(f));

  await db.from("player_baixas").delete().eq("report_id", report.id);
  if (ev.players.length > 0) {
    await db.from("player_baixas").insert(
      ev.players.map((p, i) => ({
        report_id: report.id,
        player_id: matches[i].playerId,
        detected_name: p.detectedName,
        scoring_baixas: p.baixas,
        read_confidence: p.confidence,
        name_match_score: Number(matches[i].score.toFixed(3)),
      })),
    );
  }
  for (const r of readings) {
    const f = files[r.index];
    if (f) await db.from("report_images").update({ kind: r.type }).eq("storage_path", f.path);
  }

  const { error: upErr } = await db
    .from("reports")
    .update({
      status: "RASCUNHO",
      placement: ev.placement,
      victory: ev.placement === 1,
      total_scoring_baixas: ev.totalBaixas,
      squad_total_baixas_detected: ev.squadTotalDetected,
      totals_match: ev.totalsMatch,
      ai_confidence: readings.length ? Number(ev.confidence.toFixed(3)) : null,
      ai_raw: { readings, duplicateNotes, aiError, model: process.env.ANTHROPIC_MODEL || "claude-opus-5-5" },
      flags: [...flags],
      captain_note: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", report.id);
  if (upErr) return fail("Não foi possível gravar a leitura. Tente de novo.");

  revalidatePath(`/capitao/partida/${matchId}`);
  return { ok: true };
}

/** Passo 3: o capitão confirma a leitura ou informa divergência. Ele nunca edita os números. */
export async function confirmReport(matchId: string, dispute: boolean, note: string): Promise<Result> {
  const user = await requireProfile();
  const ctx = await loadContext(user, matchId);
  if (!ctx || !ctx.report) return fail("Report não encontrado para o seu time.");
  const { db, match, ct, report } = ctx;
  if (report.status !== "RASCUNHO" || !report.ai_raw) return fail("Envie as prints antes de confirmar.");
  const allowed = canSubmit(match, report);
  if (!allowed.ok) return fail(allowed.reason!);
  if (dispute && note.trim().length < 5) return fail("Descreva em poucas palavras o que está errado na leitura.");

  const flags = new Set<Flag>(report.flags as Flag[]);
  flags.delete("COLOCACAO_REPETIDA");
  flags.delete("VITORIA_REPETIDA");
  if (dispute) flags.add("DIVERGENCIA_INFORMADA_PELO_CAPITAO");

  // 16 times: uma colocação por time, um vencedor por partida
  if (report.placement) {
    const { data: clash } = await db
      .from("reports").select("id")
      .eq("match_id", match.id).eq("placement", report.placement)
      .neq("id", report.id).in("status", ACTIVE);
    if (clash && clash.length > 0) flags.add(report.placement === 1 ? "VITORIA_REPETIDA" : "COLOCACAO_REPETIDA");
  }

  const { data: champ } = await db
    .from("championships").select("auto_validate").eq("id", match.championship_id).single();
  let status = statusOnConfirm([...flags], champ?.auto_validate ?? false);

  await db
    .from("reports")
    .update({
      status: status === "VALIDADA" ? "ENVIADA" : status,
      flags: [...flags],
      captain_note: note.trim() || null,
      late_allowed: false,
      submitted_by: user.id,
      submitted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", report.id);

  if (status === "VALIDADA") {
    const { error } = await db.rpc("apply_validation", { p_report_id: report.id, p_user_id: null });
    if (error) {
      // outro time foi validado com a mesma colocação neste meio-tempo
      status = "DIVERGENCIA";
      flags.add(report.placement === 1 ? "VITORIA_REPETIDA" : "COLOCACAO_REPETIDA");
      await db.from("reports").update({ status, flags: [...flags] }).eq("id", report.id);
    }
  }

  const link = `/capitao/partida/${matchId}`;
  if (status === "VALIDADA") {
    await notify([user.id], `Partida ${match.match_number}: report validado`, "O resultado já está na classificação.", link);
  } else {
    if (status === "DIVERGENCIA") {
      await notify([user.id], `Partida ${match.match_number}: report com divergência`, "O administrador vai conferir as prints.", link);
    }
    const { data: admins } = await db.from("profiles").select("id").eq("role", "ADMIN");
    await notify(
      (admins ?? []).map((a) => a.id),
      `Time ${String(ct.team_number).padStart(2, "0")} · Partida ${match.match_number}: conferir report`,
      status === "DIVERGENCIA" ? "Divergência" : status === "EM_ANALISE" ? "Em análise" : "Aguardando validação",
      `/admin/report/${report.id}`,
    );
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

export async function markNotificationsRead(): Promise<void> {
  const user = await requireProfile();
  await adminDb()
    .from("notifications").update({ read_at: new Date().toISOString() })
    .eq("user_id", user.id).is("read_at", null);
  revalidatePath("/", "layout");
}
