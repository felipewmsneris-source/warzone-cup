import { notFound } from "next/navigation";
import { ChampionshipView } from "@/components/ChampionshipView";
import { getChampionship } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const championship = await getChampionship(id);
  if (!championship) notFound();
  return <ChampionshipView championship={championship} />;
}
