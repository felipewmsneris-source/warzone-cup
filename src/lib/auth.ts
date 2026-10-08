import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";

export type Profile = { id: string; username: string; display_name: string; role: "ADMIN" | "CAPTAIN" };

export const cleanUsername = (u: string) => u.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
export const usernameToEmail = (u: string) =>
  `${cleanUsername(u)}@${process.env.LOGIN_EMAIL_DOMAIN || "capitaes.wzcup.app"}`;

/** Perfil do usuário logado, conferido no servidor do Supabase (não confia no cookie). */
export async function getProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  const { data: profile } = await supabase
    .from("profiles").select("id, username, display_name, role").eq("id", data.user.id).maybeSingle();
  return (profile as Profile) ?? null;
}

export async function requireProfile(): Promise<Profile> {
  const p = await getProfile();
  if (!p) redirect("/login");
  return p;
}

export async function requireAdmin(): Promise<Profile> {
  const p = await requireProfile();
  if (p.role !== "ADMIN") redirect("/capitao");
  return p;
}
