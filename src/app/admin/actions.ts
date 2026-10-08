"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cleanUsername, requireAdmin, usernameToEmail, type Profile } from "@/lib/auth";
import { adminDb } from "@/lib/supabase/admin";
import { audit, notify } from "@/lib/log";
import { ACTIVE } from "@/lib/rules";
import type { Flag } from "@/lib/types";

export type FormState = { error?: string; ok?: string };
type Db = ReturnType<typeof adminDb>;

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const done = (ok: string): FormState => {
  revalidatePath("/", "layout");
  return { ok };
};

const DEFAULT_RULES = [
  { placement_from: 1, placement_to: 1, multiplier: 2.0, bonus: 10 },
  { placement_from: 2, placement_to: 2, multiplier: 1.6, bonus: 0 },
  { placement_from: 3, placement_to: 3, multiplier: 1.5, bonus: 0 },
  { placement_from: 4, placement_to: 4, multiplier: 1.4, bonus: 0 },
  { placement_from: 5, placement_to: 5, multiplier: 1.3, bonus: 0 },
  { placement_from: 6, placement_to: 10, multiplier: 1.2, bonus: 0 },
  { placement_from: 11, placement_to: 16, multiplier: 1.0, bonus: 0 },
];

// =====================================================================
// Campeonatos
// =====================================================================
export async function createChampionship(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireAdmin();
  const name = s(fd, "name");
  if (!name) return { error: "Informe o nome do campeonato." };
  const db = adminDb();
  const { data: c, error } = await db
    .from("championships").insert({ name, event_date: s(fd, "event_date") || null }).select("id").single();
  if (error || !c) return { error: "Não foi possível criar o campeonato." };
  await db.from("scoring_rules").insert(DEFAULT_RULES.map((r) => ({ ...r, championship_id: c.id })));
  await db.from("matches").insert(
    [1, 2, 3, 4, 5, 6].map((n) => ({ championship_id: c.id, match_number: n })),
  );
  await audit(user, { action: "Criou campeonato", entity: "championships", entityId: c.id, championshipId: c.id, newValue: name });
  revalidatePath("/", "layout");
  redirect(`/admin/c/${c.id}`);
}

export async function updateChampionship(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireAdmin();
  const id = s(fd, "id");
  const db = adminDb();
  const { data: old } = await db.from("championships").select("*").eq("id", id).single();
  if (!old) return { error: "Campeonato não encontrado." };
  const tiebreak = [s(fd, "tb1"), s(fd, "tb2"), s(fd, "tb3")].filter(Boolean);
  if (new Set(tiebreak).size !== tiebreak.length) return { error: "Cada critério de desempate só pode aparecer uma vez." };
  const next = {
    name: s(fd, "name") || old.name,
    event_date: s(fd, "event_date") || null,
    status: s(fd, "status") || old.status,
    is_public: fd.get("is_public") === "on",
    auto_validate: fd.get("auto_validate") === "on",
    tiebreak_order: tiebreak,
  };
  const { error } = await db.from("championships").update(next).eq("id", id);
  if (error) return { error: "Não foi possível salvar." };
  await audit(
    user,
    (Object.keys(next) as (keyof typeof next)[])
      .filter((k) => String(old[k] ?? "") !== String(next[k] ?? ""))
      .map((k) => ({
        action: "Editou campeonato", entity: "championships", entityId: id, championshipId: id,
        field: k, oldValue: old[k], newValue: next[k],
      })),
  );
  return done("Campeonato salvo.");
}

export async function duplicateChampionship(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireAdmin();
  const id = s(fd, "id");
  const db = adminDb();
  const { data: src } = await db.from("championships").select("*").eq("id", id).single();
  if (!src) return { error: "Campeonato não encontrado." };
  const { data: c, error } = await db
    .from("championships")
    .insert({
      name: s(fd, "name") || `${src.name} (cópia)`,
      event_date: s(fd, "event_date") || null,
      auto_validate: src.auto_validate,
      tiebreak_order: src.tiebreak_order,
    })
    .select("id").single();
  if (error || !c) return { error: "Não foi possível duplicar." };

  const { data: rules } = await db.from("scoring_rules").select("*").eq("championship_id", id);
  await db.from("scoring_rules").insert(
    (rules ?? []).map((r) => ({
      championship_id: c.id, placement_from: r.placement_from, placement_to: r.placement_to,
      multiplier: r.multiplier, bonus: r.bonus,
    })),
  );
  await db.from("matches").insert([1, 2, 3, 4, 5, 6].map((n) => ({ championship_id: c.id, match_number: n })));

  const { data: cts } = await db
    .from("championship_teams").select("*, team_players(player_id, slot)").eq("championship_id", id);
  for (const ct of cts ?? []) {
    const { data: created } = await db
      .from("championship_teams")
      .insert({
        championship_id: c.id, team_id: ct.team_id, team_number: ct.team_number,
        captain_user_id: ct.captain_user_id, captain_player_id: ct.captain_player_id,
      })
      .select("id").single();
    if (created) {
      await db.from("team_players").insert(
        (ct.team_players as { player_id: string; slot: number }[]).map((tp) => ({
          championship_team_id: created.id, player_id: tp.player_id, slot: tp.slot,
        })),
      );
    }
  }
  await audit(user, {
    action: "Duplicou campeonato", entity: "championships", entityId: c.id, championshipId: c.id,
    oldValue: `#${src.number}`, newValue: s(fd, "name"),
  });
  revalidatePath("/", "layout");
  redirect(`/admin/c/${c.id}`);
}

export async function saveRules(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireAdmin();
  const id = s(fd, "id");
  const reason = s(fd, "reason");
  const rows: { placement_from: number; placement_to: number; multiplier: number; bonus: number }[] = [];
  for (let i = 0; i < 12; i++) {
    const from = s(fd, `from_${i}`);
    if (!from) continue;
    const row = {
      placement_from: Number(from),
      placement_to: Number(s(fd, `to_${i}`) || from),
      multiplier: Number(s(fd, `mult_${i}`).replace(",", ".")),
      bonus: Number(s(fd, `bonus_${i}`).replace(",", ".") || 0),
    };
    if (!Number.isInteger(row.placement_from) || !Number.isInteger(row.placement_to) ||
        row.placement_to < row.placement_from || !Number.isFinite(row.multiplier) || !Number.isFinite(row.bonus)) {
      return { error: `Faixa ${i + 1} inválida.` };
    }
    rows.push(row);
  }
  rows.sort((a, b) => a.placement_from - b.placement_from);
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].placement_from <= rows[i - 1].placement_to) return { error: "Há faixas de colocação sobrepostas." };
  }
  if (rows.length === 0) return { error: "Informe ao menos uma faixa." };
  const db = adminDb();
  const { data: old } = await db
    .from("scoring_rules").select("*").eq("championship_id", id).order("placement_from");
  const fmt = (list: typeof rows) =>
    list.map((r) => `${r.placement_from}-${r.placement_to}: x${r.multiplier} +${r.bonus}`).join(" | ");
  await db.from("scoring_rules").delete().eq("championship_id", id);
  await db.from("scoring_rules").insert(rows.map((r) => ({ ...r, championship_id: id })));
  const { data: n } = await db.rpc("recalc_championship", { p_championship_id: id });
  await audit(user, {
    action: "Alterou regras de pontuação", entity: "scoring_rules", championshipId: id,
    oldValue: fmt((old ?? []) as typeof rows), newValue: fmt(rows), reason: reason || null,
  });
  return done(`Regras salvas. ${n ?? 0} resultado(s) recalculado(s).`);
}

// =====================================================================
// Times, jogadores e capitães
// =====================================================================
async function ensureCaptain(db: Db, username: string, password: string, displayName: string) {
  const uname = cleanUsername(username);
  if (uname.length < 3) return { error: "O usuário do capitão precisa de ao menos 3 letras ou números." };
  const { data: existing } = await db.from("profiles").select("id, role").eq("username", uname).maybeSingle();
  if (existing) {
    if (existing.role === "ADMIN") return { error: "Esse usuário é de um administrador." };
    if (password) {
      if (password.length < 6) return { error: "A senha precisa de ao menos 6 caracteres." };
      const { error } = await db.auth.admin.updateUserById(existing.id, { password });
      if (error) return { error: `Não foi possível trocar a senha: ${error.message}` };
    }
    await db.from("profiles").update({ display_name: displayName }).eq("id", existing.id);
    return { id: existing.id as string };
  }
  if (password.length < 6) return { error: "Defina uma senha de ao menos 6 caracteres para o novo capitão." };
  const { data, error } = await db.auth.admin.createUser({
    email: usernameToEmail(uname), password, email_confirm: true,
  });
  if (error || !data.user) return { error: `Não foi possível criar o login: ${error?.message ?? ""}` };
  const { error: pErr } = await db
    .from("profiles").insert({ id: data.user.id, username: uname, display_name: displayName, role: "CAPTAIN" });
  if (pErr) {
    await db.auth.admin.deleteUser(data.user.id);
    return { error: "Não foi possível criar o perfil do capitão." };
  }
  return { id: data.user.id };
}

export async function saveTeam(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireAdmin();
  const db = adminDb();
  const championshipId = s(fd, "championship_id");
  const ctId = s(fd, "ct_id");
  const teamNumber = Number(s(fd, "team_number"));
  const name = s(fd, "name");
  const clanTag = s(fd, "clan_tag") || null;
  const captainSlot = Number(s(fd, "captain_slot") || 1);
  const players = [1, 2, 3].map((i) => ({
    slot: i,
    // "outro jogador" = substituição: cria um cadastro novo e preserva o histórico do anterior
    id: fd.get(`p${i}_new`) === "on" ? "" : s(fd, `p${i}_id`),
    name: s(fd, `p${i}_name`),
    nickname: s(fd, `p${i}_nick`) || s(fd, `p${i}_name`),
    aliases: s(fd, `p${i}_aliases`).split(",").map((a) => a.trim()).filter(Boolean),
  }));
  if (!Number.isInteger(teamNumber) || teamNumber < 1 || teamNumber > 99) return { error: "Número do time inválido." };
  if (!name) return { error: "Informe o nome do time." };
  if (players.some((p) => !p.name)) return { error: "Informe os 3 jogadores." };

  const { data: clash } = await db
    .from("championship_teams").select("id")
    .eq("championship_id", championshipId).eq("team_number", teamNumber).maybeSingle();
  if (clash && clash.id !== ctId) return { error: `Já existe um Time ${teamNumber} neste campeonato.` };

  // login do capitão
  let captainUserId: string | null = null;
  const username = s(fd, "username");
  if (username) {
    const cap = await ensureCaptain(db, username, s(fd, "password"), players[captainSlot - 1].nickname);
    if ("error" in cap) return { error: cap.error };
    captainUserId = cap.id!;
    const { data: other } = await db
      .from("championship_teams").select("id, team_number")
      .eq("championship_id", championshipId).eq("captain_user_id", captainUserId).maybeSingle();
    if (other && other.id !== ctId) return { error: `Esse login já é do capitão do Time ${other.team_number}.` };
  }

  let teamId: string;
  let currentCt = ctId;
  if (ctId) {
    const { data: ct } = await db.from("championship_teams").select("team_id").eq("id", ctId).single();
    if (!ct) return { error: "Time não encontrado." };
    teamId = ct.team_id;
    await db.from("teams").update({ name, clan_tag: clanTag }).eq("id", teamId);
  } else {
    const { data: t, error } = await db.from("teams").insert({ name, clan_tag: clanTag }).select("id").single();
    if (error || !t) return { error: "Não foi possível criar o time." };
    teamId = t.id;
    const { data: ct, error: e2 } = await db
      .from("championship_teams")
      .insert({ championship_id: championshipId, team_id: teamId, team_number: teamNumber })
      .select("id").single();
    if (e2 || !ct) return { error: "Não foi possível incluir o time no campeonato." };
    currentCt = ct.id;
  }

  const playerIds: string[] = [];
  for (const p of players) {
    let pid = p.id;
    if (pid) {
      await db.from("players").update({ name: p.name, nickname: p.nickname }).eq("id", pid);
    } else {
      const { data: np } = await db.from("players").insert({ name: p.name, nickname: p.nickname }).select("id").single();
      if (!np) return { error: "Não foi possível salvar um jogador." };
      pid = np.id;
      await db.from("team_players").upsert(
        { championship_team_id: currentCt, player_id: pid, slot: p.slot },
        { onConflict: "championship_team_id,slot" },
      );
    }
    playerIds.push(pid);
    await db.from("team_aliases").delete().eq("team_id", teamId).eq("player_id", pid);
    if (p.aliases.length) {
      await db.from("team_aliases").insert(p.aliases.map((alias) => ({ team_id: teamId, player_id: pid, alias })));
    }
  }

  await db
    .from("championship_teams")
    .update({
      team_number: teamNumber,
      captain_player_id: playerIds[captainSlot - 1],
      ...(username ? { captain_user_id: captainUserId } : {}),
    })
    .eq("id", currentCt);

  await audit(user, {
    action: ctId ? "Editou time" : "Cadastrou time", entity: "championship_teams", entityId: currentCt,
    championshipId, newValue: `Time ${teamNumber} · ${name} · ${players.map((p) => p.nickname).join(", ")}`,
  });
  return done(ctId ? "Time salvo." : "Time cadastrado.");
}

export async function removeTeam(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireAdmin();
  const ctId = s(fd, "ct_id");
  const db = adminDb();
  const { count } = await db
    .from("reports").select("id", { count: "exact", head: true }).eq("championship_team_id", ctId);
  if ((count ?? 0) > 0) return { error: "Este time já tem reports neste campeonato e não pode ser removido." };
  const { data: ct } = await db
    .from("championship_teams").select("championship_id, team_number").eq("id", ctId).single();
  await db.from("championship_teams").delete().eq("id", ctId);
  await audit(user, {
    action: "Removeu time do campeonato", entity: "championship_teams", entityId: ctId,
    championshipId: ct?.championship_id, oldValue: `Time ${ct?.team_number}`,
  });
  return done("Time removido.");
}

export async function setManualTiebreak(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireAdmin();
  const ctId = s(fd, "ct_id");
  const raw = s(fd, "value");
  const value = raw ? Number(raw) : null;
  if (value !== null && !Number.isInteger(value)) return { error: "Use um número inteiro." };
  const db = adminDb();
  const { data: old } = await db
    .from("championship_teams").select("tiebreak_manual, championship_id").eq("id", ctId).single();
  await db.from("championship_teams").update({ tiebreak_manual: value }).eq("id", ctId);
  await audit(user, {
    action: "Definiu desempate manual", entity: "championship_teams", entityId: ctId,
    championshipId: old?.championship_id, field: "tiebreak_manual",
    oldValue: old?.tiebreak_manual, newValue: value, reason: s(fd, "reason") || null,
  });
  return done("Desempate salvo.");
}

// =====================================================================
// Partidas
// =====================================================================
export async function updateMatch(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireAdmin();
  const id = s(fd, "match_id");
  const status = s(fd, "status");
  const deadlineLocal = s(fd, "deadline"); // datetime-local, horário de Brasília
  const db = adminDb();
  const { data: old } = await db.from("matches").select("*").eq("id", id).single();
  if (!old) return { error: "Partida não encontrada." };
  const deadline = deadlineLocal ? new Date(`${deadlineLocal}:00-03:00`).toISOString() : null;
  if (deadlineLocal && Number.isNaN(Date.parse(deadline!))) return { error: "Prazo inválido." };
  await db.from("matches").update({ status, deadline }).eq("id", id);
  const entries = [];
  if (old.status !== status) entries.push({ field: "status", oldValue: old.status, newValue: status });
  if ((old.deadline ?? "") !== (deadline ?? "")) entries.push({ field: "deadline", oldValue: old.deadline, newValue: deadline });
  await audit(user, entries.map((e) => ({
    action: `Alterou partida ${old.match_number}`, entity: "matches", entityId: id, championshipId: old.championship_id, ...e,
  })));
  if (old.status !== "ABERTA" && status === "ABERTA") {
    const { data: caps } = await db
      .from("championship_teams").select("captain_user_id").eq("championship_id", old.championship_id);
    await notify(
      (caps ?? []).map((c) => c.captain_user_id),
      `Partida ${old.match_number} liberada para report.`,
      deadline ? `Envie as prints até ${new Intl.DateTimeFormat("pt-BR", { timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(deadline))}.` : undefined,
      `/capitao/partida/${id}`,
    );
  }
  return done(`Partida ${old.match_number} atualizada.`);
}

export async function allowLate(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireAdmin();
  const matchId = s(fd, "match_id");
  const ctId = s(fd, "ct_id");
  const db = adminDb();
  const { data: existing } = await db
    .from("reports").select("id, status").eq("match_id", matchId).eq("championship_team_id", ctId).maybeSingle();
  if (existing && ACTIVE.includes(existing.status)) return { error: "Este time já enviou o report. Use Reabrir." };
  if (existing) await db.from("reports").update({ late_allowed: true, status: "REABERTO" }).eq("id", existing.id);
  else await db.from("reports").insert({ match_id: matchId, championship_team_id: ctId, status: "REABERTO", late_allowed: true });
  const { data: ct } = await db
    .from("championship_teams").select("captain_user_id, championship_id, team_number").eq("id", ctId).single();
  const { data: m } = await db.from("matches").select("match_number").eq("id", matchId).single();
  await notify([ct?.captain_user_id], `Partida ${m?.match_number}: envio autorizado pelo administrador.`, undefined, `/capitao/partida/${matchId}`);
  await audit(user, {
    action: "Autorizou envio fora do prazo", entity: "reports", entityId: existing?.id,
    championshipId: ct?.championship_id, newValue: `Time ${ct?.team_number} · Partida ${m?.match_number}`,
  });
  return done("Envio autorizado.");
}

// =====================================================================
// Reports
// =====================================================================
async function loadReport(db: Db, id: string) {
  const { data } = await db
    .from("reports")
    .select("*, matches(id, match_number, championship_id), championship_teams(team_number, captain_user_id)")
    .eq("id", id).maybeSingle();
  if (!data) return null;
  const match = (Array.isArray(data.matches) ? data.matches[0] : data.matches) as { id: string; match_number: number; championship_id: string };
  const ct = (Array.isArray(data.championship_teams) ? data.championship_teams[0] : data.championship_teams) as { team_number: number; captain_user_id: string | null };
  return { report: data, match, ct };
}

const VALIDATION_ERRORS: Record<string, string> = {
  REPORT_INCOMPLETO: "Faltam dados: informe a colocação e as baixas dos 3 jogadores antes de validar.",
  SEM_REGRA_PARA_COLOCACAO: "Não há regra de pontuação para essa colocação.",
};

async function validate(db: Db, user: Profile, id: string): Promise<string | null> {
  const { error } = await db.rpc("apply_validation", { p_report_id: id, p_user_id: user.id });
  if (!error) return null;
  if (error.code === "23505") return "Outro time já está validado com essa colocação nesta partida. Corrija um dos dois antes.";
  return VALIDATION_ERRORS[error.message] ?? `Não foi possível validar: ${error.message}`;
}

export async function validateReport(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireAdmin();
  const id = s(fd, "report_id");
  const db = adminDb();
  const ctx = await loadReport(db, id);
  if (!ctx) return { error: "Report não encontrado." };
  if (ctx.report.status === "VALIDADA") return { error: "Este report já está validado." };
  const err = await validate(db, user, id);
  if (err) return { error: err };
  await audit(user, {
    action: "Validou report", entity: "reports", entityId: id, championshipId: ctx.match.championship_id,
    field: "status", oldValue: ctx.report.status, newValue: "VALIDADA", reason: s(fd, "reason") || null,
  });
  await notify([ctx.ct.captain_user_id], `Partida ${ctx.match.match_number}: seu report foi validado.`, undefined, `/capitao/partida/${ctx.match.id}`);
  return done("Report validado. Classificação atualizada.");
}

async function leaveValidated(db: Db, id: string) {
  await db.from("match_results").delete().eq("report_id", id);
}

export async function rejectReport(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireAdmin();
  const id = s(fd, "report_id");
  const reason = s(fd, "reason");
  if (!reason) return { error: "Informe o motivo da rejeição." };
  const db = adminDb();
  const ctx = await loadReport(db, id);
  if (!ctx) return { error: "Report não encontrado." };
  await leaveValidated(db, id);
  await db.from("reports").update({
    status: "REJEITADA", admin_note: reason, validated_by: null, validated_at: null, updated_at: new Date().toISOString(),
  }).eq("id", id);
  await audit(user, {
    action: "Rejeitou report", entity: "reports", entityId: id, championshipId: ctx.match.championship_id,
    field: "status", oldValue: ctx.report.status, newValue: "REJEITADA", reason,
  });
  await notify([ctx.ct.captain_user_id], `Partida ${ctx.match.match_number}: seu report foi rejeitado.`, reason, `/capitao/partida/${ctx.match.id}`);
  return done("Report rejeitado.");
}

export async function reopenReport(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireAdmin();
  const id = s(fd, "report_id");
  const reason = s(fd, "reason");
  if (!reason) return { error: "Informe o motivo da reabertura." };
  const db = adminDb();
  const ctx = await loadReport(db, id);
  if (!ctx) return { error: "Report não encontrado." };
  await leaveValidated(db, id);
  await db.from("reports").update({
    status: "REABERTO", late_allowed: true, validated_by: null, validated_at: null, updated_at: new Date().toISOString(),
  }).eq("id", id);
  await audit(user, {
    action: "Reabriu report", entity: "reports", entityId: id, championshipId: ctx.match.championship_id,
    field: "status", oldValue: ctx.report.status, newValue: "REABERTO", reason,
  });
  await notify([ctx.ct.captain_user_id], `Partida ${ctx.match.match_number}: report reaberto.`, "Envie as prints novamente.", `/capitao/partida/${ctx.match.id}`);
  return done("Report reaberto. O capitão pode enviar de novo.");
}

/** Correção manual: cada campo alterado vai para o histórico com valor anterior, novo e motivo. */
export async function correctReport(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireAdmin();
  const id = s(fd, "report_id");
  const reason = s(fd, "reason");
  if (!reason) return { error: "Informe o motivo da correção." };
  const db = adminDb();
  const ctx = await loadReport(db, id);
  if (!ctx) return { error: "Report não encontrado." };
  const { report, match } = ctx;

  const placement = Number(s(fd, "placement"));
  if (!Number.isInteger(placement) || placement < 1 || placement > 16) return { error: "Colocação deve ser de 1 a 16." };

  const { data: roster } = await db
    .from("team_players").select("player_id, slot, players(nickname)")
    .eq("championship_team_id", report.championship_team_id).order("slot");
  const { data: current } = await db.from("player_baixas").select("*").eq("report_id", id);
  const entries: Parameters<typeof audit>[1] = [];
  const rows: { player_id: string; scoring_baixas: number; row?: { id: string } }[] = [];
  for (const r of roster ?? []) {
    const raw = s(fd, `baixas_${r.player_id}`);
    const value = Number(raw);
    const nick = ((Array.isArray(r.players) ? r.players[0] : r.players) as { nickname: string }).nickname;
    if (raw === "" || !Number.isInteger(value) || value < 0) return { error: `Informe as baixas de ${nick}.` };
    const row = (current ?? []).find((c) => c.player_id === r.player_id);
    if (!row || row.scoring_baixas !== value) {
      entries.push({
        action: "Corrigiu report", entity: "reports", entityId: id, championshipId: match.championship_id,
        field: `Baixas de ${nick}`, oldValue: row?.scoring_baixas ?? "–", newValue: value, reason,
      });
    }
    rows.push({ player_id: r.player_id, scoring_baixas: value, row });
  }
  if (rows.length !== 3) return { error: "O time precisa ter 3 jogadores cadastrados." };
  if (report.placement !== placement) {
    entries.push({
      action: "Corrigiu report", entity: "reports", entityId: id, championshipId: match.championship_id,
      field: "Colocação", oldValue: report.placement ?? "–", newValue: placement, reason,
    });
  }
  if (entries.length === 0) return { error: "Nenhum valor foi alterado." };

  // linhas lidas pela IA sem jogador correspondente saem; o histórico fica em ai_raw
  const keep = rows.map((r) => r.row?.id).filter(Boolean) as string[];
  const stale = (current ?? []).filter((c) => !keep.includes(c.id)).map((c) => c.id);
  if (stale.length) await db.from("player_baixas").delete().in("id", stale);
  for (const r of rows) {
    if (r.row) await db.from("player_baixas").update({ scoring_baixas: r.scoring_baixas }).eq("id", r.row.id);
    else await db.from("player_baixas").insert({ report_id: id, player_id: r.player_id, scoring_baixas: r.scoring_baixas });
  }
  const total = rows.reduce((sum, r) => sum + r.scoring_baixas, 0);
  // alertas de leitura deixam de valer depois da conferência humana
  const resolved: Flag[] = [
    "SEM_PRINT_COLOCACAO", "COLOCACAO_ILEGIVEL", "COLOCACAO_FORA_DA_FAIXA", "SEM_PRINT_PLACAR",
    "COLUNA_BAIXAS_NAO_LOCALIZADA", "JOGADORES_INCOMPLETOS", "BAIXAS_ILEGIVEIS", "TOTAL_ESQUADRAO_ILEGIVEL",
    "SOMA_DIFERENTE_DO_TOTAL", "NOME_NAO_RECONHECIDO", "NOME_BAIXA_CONFIANCA", "LEITURA_BAIXA_CONFIANCA",
    "VITORIA_INCONSISTENTE", "FALHA_NA_IA",
  ];
  const wasValidated = report.status === "VALIDADA";
  await db.from("reports").update({
    placement, victory: placement === 1, total_scoring_baixas: total,
    flags: (report.flags as Flag[]).filter((f) => !resolved.includes(f)),
    status: report.status === "RASCUNHO" || report.status === "REABERTO" ? "EM_ANALISE" : report.status,
    late_allowed: false,
    updated_at: new Date().toISOString(),
  }).eq("id", id);
  await audit(user, entries);

  if (wasValidated) {
    const err = await validate(db, user, id);
    if (err) {
      await leaveValidated(db, id);
      await db.from("reports").update({ status: "DIVERGENCIA" }).eq("id", id);
      revalidatePath("/", "layout");
      return { error: `Correção salva, mas o report saiu da classificação. ${err}` };
    }
    return done("Correção salva e pontuação recalculada.");
  }
  return done("Correção salva. Valide o report para ele entrar na classificação.");
}

export async function saveAdminNote(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireAdmin();
  const id = s(fd, "report_id");
  const note = s(fd, "note");
  const db = adminDb();
  const ctx = await loadReport(db, id);
  if (!ctx) return { error: "Report não encontrado." };
  await db.from("reports").update({ admin_note: note || null }).eq("id", id);
  await audit(user, {
    action: "Editou observação", entity: "reports", entityId: id, championshipId: ctx.match.championship_id,
    field: "admin_note", oldValue: ctx.report.admin_note, newValue: note,
  });
  return done("Observação salva.");
}
