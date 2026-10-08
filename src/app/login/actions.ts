"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { adminDb } from "@/lib/supabase/admin";
import { cleanUsername, usernameToEmail } from "@/lib/auth";

export type AuthState = { error?: string };

export async function login(_: AuthState, fd: FormData): Promise<AuthState> {
  const username = String(fd.get("username") ?? "");
  const password = String(fd.get("password") ?? "");
  if (!username || !password) return { error: "Informe usuário e senha." };
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email: usernameToEmail(username), password });
  if (error || !data.user) return { error: "Usuário ou senha incorretos." };
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", data.user.id).maybeSingle();
  revalidatePath("/", "layout");
  redirect(profile?.role === "ADMIN" ? "/admin" : "/capitao");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/");
}

/** Cria o primeiro administrador. Só funciona enquanto não existir nenhum. */
export async function createFirstAdmin(_: AuthState, fd: FormData): Promise<AuthState> {
  const token = String(fd.get("token") ?? "");
  const username = cleanUsername(String(fd.get("username") ?? ""));
  const password = String(fd.get("password") ?? "");
  if (!process.env.SETUP_TOKEN || token !== process.env.SETUP_TOKEN) return { error: "Senha de instalação incorreta." };
  if (username.length < 3) return { error: "O usuário precisa de ao menos 3 letras ou números." };
  if (password.length < 8) return { error: "A senha precisa de ao menos 8 caracteres." };
  const db = adminDb();
  const { count } = await db.from("profiles").select("id", { count: "exact", head: true }).eq("role", "ADMIN");
  if ((count ?? 0) > 0) return { error: "Já existe um administrador. Entre pela tela de login." };
  const { data, error } = await db.auth.admin.createUser({
    email: usernameToEmail(username), password, email_confirm: true,
  });
  if (error || !data.user) return { error: `Não foi possível criar o usuário: ${error?.message ?? ""}` };
  const { error: pErr } = await db
    .from("profiles").insert({ id: data.user.id, username, display_name: username, role: "ADMIN" });
  if (pErr) {
    await db.auth.admin.deleteUser(data.user.id);
    return { error: "Não foi possível criar o perfil. Confira se a migration do banco foi executada." };
  }
  redirect("/login");
}
