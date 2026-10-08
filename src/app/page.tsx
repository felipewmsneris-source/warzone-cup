import Link from "next/link";
import { Shell } from "@/components/Shell";
import { ChampionshipView } from "@/components/ChampionshipView";
import { currentChampionship } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function Home() {
  const championship = await currentChampionship();
  if (!championship) {
    return (
      <Shell>
        <h1 className="text-4xl">Nenhum campeonato publicado</h1>
        <p className="mt-2 text-muted">
          Assim que o administrador publicar um campeonato, a classificação aparece aqui.{" "}
          <Link href="/login" className="underline">Entrar</Link>
        </p>
      </Shell>
    );
  }
  return <ChampionshipView championship={championship} />;
}
