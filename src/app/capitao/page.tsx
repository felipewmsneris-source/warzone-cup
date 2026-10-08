import Link from "next/link";
import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { LiveRefresh } from "@/components/LiveRefresh";
import { StatusBadge } from "@/components/StatusBadge";
import { Deadline } from "@/components/Deadline";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dateTime, displayStatus, pts, teamNo } from "@/lib/format";
import type { MatchStatus, ReportStatus } from "@/lib/types";
import { markNotificationsRead } from "./actions";

export const dynamic = "force-dynamic";

type CT = {
  id: string; team_number: number; captain_player_id: string | null;
  teams: { name: string; clan_tag: string | null };
  championships: { id: string; name: string; number: number; status: string };
};

export default async function Page() {
  const profile = await requireProfile();
  if (profile.role === "ADMIN") redirect("/admin");
  const db = await createClient();

  const { data: mine } = await db
    .from("championship_teams")
    .select("id, team_number, captain_player_id, teams(name, clan_tag), championships(id, name, number, status)")
    .eq("captain_user_id", profile.id);
  const list = ((mine ?? []) as unknown as CT[]).sort((a, b) => b.championships.number - a.championships.number);
  const ct = list.find((x) => x.championships.status === "ATIVO") ?? list[0];

  if (!ct) {
    return (
      <Shell>
        <h1 className="text-4xl">Olá, {profile.display_name}</h1>
        <p className="mt-2 text-muted">Seu login ainda não está ligado a um time. Fale com o organizador.</p>
      </Shell>
    );
  }

  const [{ data: roster }, { data: matches }, { data: reports }, { data: results }, { data: notes }] = await Promise.all([
    db.from("team_players").select("slot, player_id, players(nickname)").eq("championship_team_id", ct.id).order("slot"),
    db.from("matches").select("*").eq("championship_id", ct.championships.id).order("match_number"),
    db.from("reports").select("id, match_id, status, late_allowed").eq("championship_team_id", ct.id),
    db.from("match_results").select("match_id, points").eq("championship_team_id", ct.id),
    db.from("notifications").select("*").order("created_at", { ascending: false }).limit(8),
  ]);
  const unread = (notes ?? []).filter((n) => !n.read_at).length;

  return (
    <Shell>
      <LiveRefresh tables={["matches", "reports", "notifications"]} />
      <p className="text-muted">Olá, {profile.display_name}</p>
      <p className="mt-3 text-sm text-muted">Time {teamNo(ct.team_number)} {ct.teams.clan_tag}</p>
      <h1 className="text-5xl">{ct.teams.name}</h1>
      <p className="mt-2 text-sm">
        {(roster ?? []).map((r) => {
          const p = (Array.isArray(r.players) ? r.players[0] : r.players) as { nickname: string };
          return (
            <span key={r.slot} className="mr-4 inline-block">
              {p.nickname}
              {r.player_id === ct.captain_player_id && <span className="ml-1 text-xs text-amber">capitão</span>}
            </span>
          );
        })}
      </p>
      <p className="mt-1 text-xs text-muted">{ct.championships.name}</p>

      <h2 className="mt-7 text-2xl">Partidas</h2>
      <ul className="mt-3 space-y-2">
        {(matches ?? []).map((m) => {
          const report = (reports ?? []).find((r) => r.match_id === m.id);
          const result = (results ?? []).find((r) => r.match_id === m.id);
          const status = displayStatus(m.status as MatchStatus, report?.status as ReportStatus | undefined);
          const open = status === "AGUARDANDO" || status === "REJEITADA";
          return (
            <li key={m.id}>
              <Link
                href={`/capitao/partida/${m.id}`}
                className={`panel flex items-center justify-between gap-3 p-4 hover:border-muted ${open ? "border-amber/60" : ""}`}
              >
                <div>
                  <div className="font-display text-2xl font-bold">Partida {m.match_number}</div>
                  {open && m.deadline && !report?.late_allowed && (
                    <div className="text-sm"><Deadline iso={m.deadline} /></div>
                  )}
                  {open && <div className="mt-1 text-sm font-semibold text-amber">Reportar resultado</div>}
                </div>
                <div className="text-right">
                  <StatusBadge status={status} />
                  {result && <div className="mt-1 font-display text-2xl font-bold text-amber">{pts(result.points)}</div>}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="mt-8 flex items-center justify-between">
        <h2 className="text-2xl">Avisos {unread > 0 && <span className="text-amber">({unread})</span>}</h2>
        {unread > 0 && (
          <form action={markNotificationsRead}>
            <button className="text-sm underline underline-offset-4">Marcar como lidos</button>
          </form>
        )}
      </div>
      <ul className="mt-3 space-y-2">
        {(notes ?? []).length === 0 && <li className="text-sm text-muted">Nenhum aviso por enquanto.</li>}
        {(notes ?? []).map((n) => (
          <li key={n.id} className={`panel p-3 text-sm ${n.read_at ? "opacity-60" : "border-l-4 border-l-amber"}`}>
            {n.link ? <Link href={n.link} className="font-semibold hover:text-amber">{n.title}</Link> : <span className="font-semibold">{n.title}</span>}
            {n.body && <div className="text-muted">{n.body}</div>}
            <div className="mt-1 text-xs text-muted">{dateTime(n.created_at)}</div>
          </li>
        ))}
      </ul>
    </Shell>
  );
}
