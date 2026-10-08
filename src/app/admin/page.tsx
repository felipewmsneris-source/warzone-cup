import Link from "next/link";
import { Shell } from "@/components/Shell";
import { ActionForm, Submit } from "@/components/ActionForm";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dateOnly } from "@/lib/format";
import type { Championship } from "@/lib/queries";
import { createChampionship } from "./actions";

const STATUS = { RASCUNHO: "Rascunho", ATIVO: "Em andamento", ENCERRADO: "Encerrado" };

export default async function Page() {
  await requireAdmin();
  const db = await createClient();
  const { data } = await db.from("championships").select("*").order("number", { ascending: false });
  const list = (data ?? []) as Championship[];

  return (
    <Shell wide>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-4xl">Campeonatos</h1>
        <Link href="/admin/auditoria" className="text-sm underline underline-offset-4">Histórico de alterações</Link>
      </div>

      <ul className="mt-5 space-y-2">
        {list.length === 0 && <li className="text-muted">Nenhum campeonato ainda. Crie o primeiro abaixo.</li>}
        {list.map((c) => (
          <li key={c.id}>
            <Link href={`/admin/c/${c.id}/validacao`} className="panel flex flex-wrap items-center justify-between gap-3 p-4 hover:border-muted">
              <div>
                <div className="font-display text-2xl font-bold">
                  <span className="mr-2 text-muted">#{String(c.number).padStart(3, "0")}</span>
                  {c.name}
                </div>
                <div className="text-sm text-muted">{dateOnly(c.event_date) || "Sem data"}</div>
              </div>
              <div className="text-right text-sm">
                <div className={c.status === "ATIVO" ? "font-semibold text-ok" : "text-muted"}>{STATUS[c.status]}</div>
                <div className="text-muted">{c.is_public ? "Público" : "Oculto do público"}</div>
              </div>
            </Link>
          </li>
        ))}
      </ul>

      <section className="panel mt-8 max-w-xl p-5">
        <h2 className="text-2xl">Criar campeonato</h2>
        <p className="mt-1 text-sm text-muted">
          Já nasce com as 6 partidas e as regras de pontuação padrão. Para repetir os times do domingo anterior,
          abra o campeonato anterior e use Duplicar.
        </p>
        <ActionForm action={createChampionship} className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
          <div>
            <label className="label" htmlFor="name">Nome</label>
            <input id="name" name="name" className="field" placeholder="Copa de Domingo" required />
          </div>
          <div>
            <label className="label" htmlFor="event_date">Data</label>
            <input id="event_date" name="event_date" type="date" className="field" />
          </div>
          <div className="sm:col-span-2"><Submit>Criar campeonato</Submit></div>
        </ActionForm>
      </section>
    </Shell>
  );
}
