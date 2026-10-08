import Link from "next/link";
import type { Championship } from "@/lib/queries";

export function AdminNav({ c, current }: { c: Championship; current: "config" | "times" | "validacao" }) {
  const tabs = [
    { key: "validacao", label: "Central de validação", href: `/admin/c/${c.id}/validacao` },
    { key: "times", label: "Times e capitães", href: `/admin/c/${c.id}/times` },
    { key: "config", label: "Partidas e regras", href: `/admin/c/${c.id}` },
  ];
  return (
    <div className="mb-6">
      <Link href="/admin" className="text-sm text-muted underline underline-offset-4">Todos os campeonatos</Link>
      <h1 className="mt-2 text-4xl">
        <span className="mr-2 text-muted">#{String(c.number).padStart(3, "0")}</span>
        {c.name}
      </h1>
      <nav className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-b border-line">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            aria-current={t.key === current ? "page" : undefined}
            className={`-mb-px border-b-2 pb-2 font-display text-xl font-semibold ${
              t.key === current ? "border-amber text-ink" : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {t.label}
          </Link>
        ))}
        <Link href={`/c/${c.id}`} className="-mb-px ml-auto pb-2 text-sm text-muted hover:text-ink">Ver classificação</Link>
      </nav>
    </div>
  );
}
