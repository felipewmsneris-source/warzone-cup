import Link from "next/link";
import { Shell } from "@/components/Shell";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dateTime } from "@/lib/format";

export default async function Page() {
  await requireAdmin();
  const db = await createClient();
  const { data: logs } = await db.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(300);

  return (
    <Shell wide>
      <Link href="/admin" className="text-sm text-muted underline underline-offset-4">Todos os campeonatos</Link>
      <h1 className="mt-2 text-4xl">Histórico de alterações</h1>
      <p className="mt-1 text-sm text-muted">As 300 alterações administrativas mais recentes.</p>
      <div className="panel mt-5 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line text-xs text-muted">
            <tr>
              <th className="px-3 py-2 font-medium">Data e hora</th>
              <th className="px-3 py-2 font-medium">Usuário</th>
              <th className="px-3 py-2 font-medium">Ação</th>
              <th className="px-3 py-2 font-medium">Valor anterior</th>
              <th className="px-3 py-2 font-medium">Valor novo</th>
              <th className="px-3 py-2 font-medium">Motivo</th>
            </tr>
          </thead>
          <tbody>
            {(logs ?? []).map((l) => (
              <tr key={l.id} className="border-b border-line/60 align-top last:border-0">
                <td className="whitespace-nowrap px-3 py-2 text-muted">{dateTime(l.created_at)}</td>
                <td className="px-3 py-2">{l.username}</td>
                <td className="px-3 py-2">
                  {l.entity === "reports" && l.entity_id ? (
                    <Link href={`/admin/report/${l.entity_id}`} className="underline underline-offset-4">{l.action}</Link>
                  ) : l.action}
                  {l.field && <span className="text-muted"> ({l.field})</span>}
                </td>
                <td className="px-3 py-2 text-muted">{l.old_value ?? "–"}</td>
                <td className="px-3 py-2">{l.new_value ?? "–"}</td>
                <td className="px-3 py-2 text-muted">{l.reason ?? "–"}</td>
              </tr>
            ))}
            {(logs ?? []).length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-muted">Nenhuma alteração registrada.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
