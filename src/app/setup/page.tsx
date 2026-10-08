import { redirect } from "next/navigation";
import { adminDb } from "@/lib/supabase/admin";
import { SetupForm } from "./SetupForm";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { count, error } = await adminDb()
    .from("profiles").select("id", { count: "exact", head: true }).eq("role", "ADMIN");
  if (!error && (count ?? 0) > 0) redirect("/login");
  return (
    <main className="mx-auto max-w-sm px-4 pt-12">
      <h1 className="text-4xl">Criar o administrador</h1>
      <p className="mt-1 text-sm text-muted">Esta tela só funciona uma vez, enquanto não existir nenhum administrador.</p>
      {error && (
        <p className="mt-4 text-sm text-win">
          Não foi possível ler o banco. Confira as variáveis de ambiente e se a migration foi executada no Supabase.
        </p>
      )}
      <SetupForm />
    </main>
  );
}
