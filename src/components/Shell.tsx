import Link from "next/link";
import { getProfile } from "@/lib/auth";
import { logout } from "@/app/login/actions";

export async function Shell({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  const profile = await getProfile();
  return (
    <>
      <header className="border-b border-line bg-panel">
        <div className={`mx-auto flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 ${wide ? "max-w-7xl" : "max-w-5xl"}`}>
          <Link href="/" className="font-display text-2xl font-extrabold tracking-wide">
            WARZONE <span className="text-amber">CUP</span>
          </Link>
          <nav className="flex flex-1 flex-wrap items-center gap-x-5 gap-y-1 text-sm">
            <Link href="/" className="hover:text-amber">Classificação</Link>
            <Link href="/historico" className="hover:text-amber">Histórico</Link>
            {profile?.role === "CAPTAIN" && <Link href="/capitao" className="hover:text-amber">Meu time</Link>}
            {profile?.role === "ADMIN" && <Link href="/admin" className="hover:text-amber">Painel</Link>}
          </nav>
          {profile ? (
            <form action={logout} className="flex items-center gap-3 text-sm">
              <span className="text-muted">{profile.display_name}</span>
              <button className="underline underline-offset-4 hover:text-amber">Sair</button>
            </form>
          ) : (
            <Link href="/login" className="btn btn-ghost btn-sm">Entrar</Link>
          )}
        </div>
      </header>
      <main className={`mx-auto px-4 py-6 ${wide ? "max-w-7xl" : "max-w-5xl"}`}>{children}</main>
    </>
  );
}
