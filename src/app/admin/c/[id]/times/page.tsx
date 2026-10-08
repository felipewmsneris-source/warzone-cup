import { notFound } from "next/navigation";
import { Shell } from "@/components/Shell";
import { AdminNav } from "@/components/AdminNav";
import { ActionForm, Submit } from "@/components/ActionForm";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getChampionship, getStandings } from "@/lib/queries";
import { teamNo } from "@/lib/format";
import { removeTeam, saveTeam, setManualTiebreak } from "../../../actions";

type Row = {
  id: string; team_number: number; team_id: string; captain_user_id: string | null; captain_player_id: string | null;
  tiebreak_manual: number | null;
  teams: { name: string; clan_tag: string | null };
  team_players: { slot: number; player_id: string; players: { id: string; name: string; nickname: string } }[];
};

function TeamForm({
  championshipId, row, username, aliases, nextNumber,
}: {
  championshipId: string; row?: Row; username?: string; aliases: Record<string, string>; nextNumber: number;
}) {
  const player = (slot: number) => row?.team_players.find((tp) => tp.slot === slot)?.players;
  const captainSlot = row?.team_players.find((tp) => tp.player_id === row.captain_player_id)?.slot ?? 1;
  const uid = row?.id ?? "novo";
  return (
    <ActionForm action={saveTeam} className="space-y-4">
      <input type="hidden" name="championship_id" value={championshipId} />
      <input type="hidden" name="ct_id" value={row?.id ?? ""} />
      <div className="grid gap-3 sm:grid-cols-[7rem_1fr_10rem]">
        <div>
          <label className="label" htmlFor={`n-${uid}`}>Número</label>
          <input id={`n-${uid}`} name="team_number" type="number" min={1} max={99} defaultValue={row?.team_number ?? nextNumber} className="field" required />
        </div>
        <div>
          <label className="label" htmlFor={`t-${uid}`}>Nome do time</label>
          <input id={`t-${uid}`} name="name" defaultValue={row?.teams.name ?? ""} className="field" required />
        </div>
        <div>
          <label className="label" htmlFor={`c-${uid}`}>Clan tag (opcional)</label>
          <input id={`c-${uid}`} name="clan_tag" defaultValue={row?.teams.clan_tag ?? ""} placeholder="[XAVE$]" className="field" />
        </div>
      </div>

      <div className="space-y-3">
        {[1, 2, 3].map((slot) => {
          const p = player(slot);
          return (
            <fieldset key={slot} className="grid gap-2 rounded border border-line/70 p-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
              <legend className="px-1 text-xs text-muted">Jogador {slot}</legend>
              <input type="hidden" name={`p${slot}_id`} value={p?.id ?? ""} />
              <div>
                <label className="label" htmlFor={`pn-${uid}-${slot}`}>Nome</label>
                <input id={`pn-${uid}-${slot}`} name={`p${slot}_name`} defaultValue={p?.name ?? ""} className="field" required />
              </div>
              <div>
                <label className="label" htmlFor={`pk-${uid}-${slot}`}>Nickname no jogo</label>
                <input id={`pk-${uid}-${slot}`} name={`p${slot}_nick`} defaultValue={p?.nickname ?? ""} className="field" required />
              </div>
              <div>
                <label className="label" htmlFor={`pa-${uid}-${slot}`}>Outros nicks aceitos (vírgula)</label>
                <input id={`pa-${uid}-${slot}`} name={`p${slot}_aliases`} defaultValue={p ? aliases[p.id] ?? "" : ""} className="field" />
              </div>
              <div className="flex flex-col justify-end gap-1 pb-1 text-sm">
                <label className="flex items-center gap-2">
                  <input type="radio" name="captain_slot" value={slot} defaultChecked={captainSlot === slot} className="size-4" />
                  Capitão
                </label>
                {p && (
                  <label className="flex items-center gap-2 text-muted">
                    <input type="checkbox" name={`p${slot}_new`} className="size-4" />
                    É outro jogador
                  </label>
                )}
              </div>
            </fieldset>
          );
        })}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={`u-${uid}`}>Usuário do capitão</label>
          <input id={`u-${uid}`} name="username" defaultValue={username ?? ""} autoCapitalize="none" className="field" />
        </div>
        <div>
          <label className="label" htmlFor={`pw-${uid}`}>{username ? "Nova senha (em branco mantém a atual)" : "Senha do capitão"}</label>
          <input id={`pw-${uid}`} name="password" type="text" autoComplete="off" className="field" />
        </div>
      </div>
      <Submit>{row ? "Salvar time" : "Cadastrar time"}</Submit>
    </ActionForm>
  );
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const c = await getChampionship(id);
  if (!c) notFound();
  const db = await createClient();
  const { data } = await db
    .from("championship_teams")
    .select("id, team_number, team_id, captain_user_id, captain_player_id, tiebreak_manual, teams(name, clan_tag), team_players(slot, player_id, players(id, name, nickname))")
    .eq("championship_id", id).order("team_number");
  const rows = (data ?? []) as unknown as Row[];
  const captainIds = rows.map((r) => r.captain_user_id).filter(Boolean) as string[];
  const [{ data: profiles }, { data: aliasRows }, standings] = await Promise.all([
    captainIds.length ? db.from("profiles").select("id, username").in("id", captainIds) : Promise.resolve({ data: [] as { id: string; username: string }[] }),
    rows.length ? db.from("team_aliases").select("player_id, alias").in("team_id", rows.map((r) => r.team_id)) : Promise.resolve({ data: [] as { player_id: string; alias: string }[] }),
    getStandings(c),
  ]);
  const aliases: Record<string, string> = {};
  (aliasRows ?? []).forEach((a) => {
    if (a.player_id) aliases[a.player_id] = aliases[a.player_id] ? `${aliases[a.player_id]}, ${a.alias}` : a.alias;
  });
  const used = new Set(rows.map((r) => r.team_number));
  let nextNumber = 1;
  while (used.has(nextNumber)) nextNumber++;
  const tied = standings.filter((s) => s.tied);

  return (
    <Shell wide>
      <AdminNav c={c} current="times" />
      <p className="text-sm text-muted">{rows.length} de 16 times cadastrados.</p>

      {tied.length > 0 && (
        <section className="panel mt-4 border-amber/60 p-4">
          <h2 className="text-2xl">Empate para decidir</h2>
          <p className="mt-1 text-sm text-muted">Os critérios automáticos não separaram estes times. Dê a ordem: o menor número fica na frente.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {tied.map((t) => (
              <ActionForm key={t.championship_team_id} action={setManualTiebreak} className="grid grid-cols-[1fr_5rem_auto] items-end gap-2">
                <input type="hidden" name="ct_id" value={t.championship_team_id} />
                <div className="pb-2">{t.position}º {t.team_name}</div>
                <input name="value" type="number" defaultValue={t.tiebreak_manual ?? ""} className="field" aria-label="Ordem no desempate" />
                <Submit className="btn btn-ghost">Salvar</Submit>
              </ActionForm>
            ))}
          </div>
        </section>
      )}

      <div className="mt-5 space-y-2">
        {rows.map((r) => (
          <details key={r.id} className="panel">
            <summary className="flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 p-4">
              <span className="plate">{teamNo(r.team_number)}</span>
              <span className="font-display text-2xl font-bold">{r.teams.name}</span>
              <span className="text-sm text-muted">
                {r.team_players.sort((a, b) => a.slot - b.slot).map((tp) => tp.players.nickname).join(", ")}
              </span>
              {!r.captain_user_id && <span className="text-sm text-win">sem login de capitão</span>}
            </summary>
            <div className="border-t border-line p-4">
              <TeamForm
                championshipId={id} row={r} aliases={aliases} nextNumber={nextNumber}
                username={(profiles ?? []).find((p) => p.id === r.captain_user_id)?.username}
              />
              <ActionForm action={removeTeam} className="mt-4 border-t border-line pt-3" confirm={`Remover o Time ${r.team_number} deste campeonato?`}>
                <input type="hidden" name="ct_id" value={r.id} />
                <button className="text-sm text-win underline underline-offset-4">Remover time deste campeonato</button>
              </ActionForm>
            </div>
          </details>
        ))}
      </div>

      {rows.length < 16 && (
        <section className="panel mt-6 p-5">
          <h2 className="mb-4 text-2xl">Cadastrar time</h2>
          <TeamForm key={`novo-${rows.length}`} championshipId={id} aliases={aliases} nextNumber={nextNumber} />
        </section>
      )}
    </Shell>
  );
}
