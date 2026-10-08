import { notFound } from "next/navigation";
import { Shell } from "@/components/Shell";
import { AdminNav } from "@/components/AdminNav";
import { ActionForm, Submit } from "@/components/ActionForm";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getChampionship } from "@/lib/queries";
import { TIEBREAK_LABEL } from "@/lib/format";
import { duplicateChampionship, saveRules, updateChampionship, updateMatch } from "../../actions";

const toLocalInput = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" })
        .format(new Date(iso)).replace(" ", "T")
    : "";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const c = await getChampionship(id);
  if (!c) notFound();
  const db = await createClient();
  const [{ data: matches }, { data: rules }] = await Promise.all([
    db.from("matches").select("*").eq("championship_id", id).order("match_number"),
    db.from("scoring_rules").select("*").eq("championship_id", id).order("placement_from"),
  ]);
  const ruleRows = [...(rules ?? []), ...Array(2).fill(null)];
  const tiebreakKeys = Object.keys(TIEBREAK_LABEL);

  return (
    <Shell wide>
      <AdminNav c={c} current="config" />
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="panel p-5">
          <h2 className="text-2xl">Partidas e prazos</h2>
          <p className="mt-1 text-sm text-muted">
            Abra a partida quando ela terminar. Ao abrir, os capitães recebem o aviso. Horários em Brasília.
          </p>
          <div className="mt-4 space-y-3">
            {(matches ?? []).map((m) => (
              <ActionForm key={m.id} action={updateMatch} className="grid grid-cols-[auto_1fr_1fr_auto] items-end gap-2 border-b border-line/60 pb-3">
                <input type="hidden" name="match_id" value={m.id} />
                <div className="pb-2 font-display text-2xl font-bold">P{m.match_number}</div>
                <div>
                  <label className="label" htmlFor={`st-${m.id}`}>Situação</label>
                  <select id={`st-${m.id}`} name="status" defaultValue={m.status} className="field">
                    <option value="NAO_LIBERADA">Não liberada</option>
                    <option value="ABERTA">Aberta</option>
                    <option value="FECHADA">Fechada</option>
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor={`dl-${m.id}`}>Report até</label>
                  <input id={`dl-${m.id}`} name="deadline" type="datetime-local" defaultValue={toLocalInput(m.deadline)} className="field" />
                </div>
                <Submit className="btn btn-ghost">Salvar</Submit>
              </ActionForm>
            ))}
          </div>
        </section>

        <section className="panel p-5">
          <h2 className="text-2xl">Dados do campeonato</h2>
          <ActionForm action={updateChampionship} className="mt-4 space-y-3">
            <input type="hidden" name="id" value={c.id} />
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="name">Nome</label>
                <input id="name" name="name" defaultValue={c.name} className="field" required />
              </div>
              <div>
                <label className="label" htmlFor="event_date">Data</label>
                <input id="event_date" name="event_date" type="date" defaultValue={c.event_date ?? ""} className="field" />
              </div>
            </div>
            <div>
              <label className="label" htmlFor="status">Situação</label>
              <select id="status" name="status" defaultValue={c.status} className="field">
                <option value="RASCUNHO">Rascunho (em preparação)</option>
                <option value="ATIVO">Em andamento</option>
                <option value="ENCERRADO">Encerrado</option>
              </select>
            </div>
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" name="is_public" defaultChecked={c.is_public} className="mt-1 size-4" />
              <span>Mostrar classificação e resultados ao público</span>
            </label>
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" name="auto_validate" defaultChecked={c.auto_validate} className="mt-1 size-4" />
              <span>
                Validar sozinho os reports sem nenhum alerta
                <span className="block text-muted">Desmarcado, todo report espera a sua validação.</span>
              </span>
            </label>
            <fieldset>
              <legend className="label">Desempate, depois do total de pontos</legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {[0, 1, 2].map((i) => (
                  <select key={i} name={`tb${i + 1}`} defaultValue={c.tiebreak_order[i] ?? ""} className="field" aria-label={`${i + 1}º critério`}>
                    <option value="">Nenhum</option>
                    {tiebreakKeys.map((k) => <option key={k} value={k}>{TIEBREAK_LABEL[k]}</option>)}
                  </select>
                ))}
              </div>
              <p className="mt-1 text-xs text-muted">Se o empate continuar, você decide na aba Times e capitães.</p>
            </fieldset>
            <Submit>Salvar campeonato</Submit>
          </ActionForm>
        </section>

        <section className="panel p-5">
          <h2 className="text-2xl">Regras de pontuação</h2>
          <p className="mt-1 text-sm text-muted">Pontos da partida = baixas × multiplicador + bônus. Salvar recalcula os resultados já validados.</p>
          <ActionForm action={saveRules} className="mt-4">
            <input type="hidden" name="id" value={c.id} />
            <div className="grid grid-cols-4 gap-2 text-xs text-muted">
              <span>Do lugar</span><span>Até o lugar</span><span>Multiplicador</span><span>Bônus</span>
            </div>
            {ruleRows.map((r, i) => (
              <div key={i} className="mt-2 grid grid-cols-4 gap-2">
                <input name={`from_${i}`} defaultValue={r?.placement_from ?? ""} inputMode="numeric" className="field" aria-label="Do lugar" />
                <input name={`to_${i}`} defaultValue={r?.placement_to ?? ""} inputMode="numeric" className="field" aria-label="Até o lugar" />
                <input name={`mult_${i}`} defaultValue={r ? String(r.multiplier).replace(".", ",") : ""} inputMode="decimal" className="field" aria-label="Multiplicador" />
                <input name={`bonus_${i}`} defaultValue={r ? String(r.bonus).replace(".", ",") : ""} inputMode="decimal" className="field" aria-label="Bônus" />
              </div>
            ))}
            <label className="label mt-3" htmlFor="rules-reason">Motivo da alteração</label>
            <input id="rules-reason" name="reason" className="field" />
            <div className="mt-3"><Submit>Salvar regras</Submit></div>
          </ActionForm>
        </section>

        <section className="panel p-5">
          <h2 className="text-2xl">Duplicar campeonato</h2>
          <p className="mt-1 text-sm text-muted">
            Copia times, jogadores, clan tags, capitães e regras. Partidas, reports e pontuação começam zerados.
          </p>
          <ActionForm action={duplicateChampionship} className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
            <input type="hidden" name="id" value={c.id} />
            <div>
              <label className="label" htmlFor="dup-name">Nome do novo campeonato</label>
              <input id="dup-name" name="name" defaultValue={c.name} className="field" required />
            </div>
            <div>
              <label className="label" htmlFor="dup-date">Data</label>
              <input id="dup-date" name="event_date" type="date" className="field" />
            </div>
            <div className="sm:col-span-2"><Submit>Duplicar campeonato</Submit></div>
          </ActionForm>
        </section>
      </div>
    </Shell>
  );
}
