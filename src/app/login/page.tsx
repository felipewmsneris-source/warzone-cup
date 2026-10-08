import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { getProfile } from "@/lib/auth";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function Page() {
  const profile = await getProfile();
  if (profile) redirect(profile.role === "ADMIN" ? "/admin" : "/capitao");
  return (
    <Shell>
      <div className="mx-auto max-w-sm pt-6">
        <h1 className="text-4xl">Entrar</h1>
        <p className="mt-1 text-sm text-muted">Use o usuário e a senha que o organizador enviou.</p>
        <LoginForm />
      </div>
    </Shell>
  );
}
