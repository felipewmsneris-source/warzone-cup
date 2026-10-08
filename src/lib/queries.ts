import "server-only";
import { createClient } from "./supabase/server";
import { rank } from "./standings";
import type { RankedStanding, Standing } from "./types";

export type Championship = {
  id: string; number: number; name: string; event_date: string | null;
  status: "RASCUNHO" | "ATIVO" | "ENCERRADO"; is_public: boolean; auto_validate: boolean; tiebreak_order: string[];
};

/** Campeonato em destaque: o ativo mais recente; se não houver, o último visível. */
export async function currentChampionship(): Promise<Championship | null> {
  const db = await createClient();
  const { data } = await db
    .from("championships").select("*")
    .order("status", { ascending: true }) // enum: RASCUNHO, ATIVO, ENCERRADO
    .order("number", { ascending: false });
  const list = (data ?? []) as Championship[];
  return list.find((c) => c.status === "ATIVO") ?? list.find((c) => c.status === "ENCERRADO") ?? null;
}

export async function getChampionship(id: string): Promise<Championship | null> {
  const db = await createClient();
  const { data } = await db.from("championships").select("*").eq("id", id).maybeSingle();
  return (data as Championship) ?? null;
}

export async function getStandings(c: Championship): Promise<RankedStanding[]> {
  const db = await createClient();
  const { data } = await db.from("standings").select("*").eq("championship_id", c.id);
  return rank((data ?? []) as Standing[], c.tiebreak_order);
}
