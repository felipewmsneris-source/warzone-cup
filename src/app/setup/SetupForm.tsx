"use client";

import { useActionState } from "react";
import { createFirstAdmin } from "../login/actions";

export function SetupForm() {
  const [state, action, pending] = useActionState(createFirstAdmin, {});
  return (
    <form action={action} className="panel mt-5 space-y-4 p-5">
      <div>
        <label className="label" htmlFor="token">Senha de instalação (variável SETUP_TOKEN)</label>
        <input id="token" name="token" type="password" className="field" required />
      </div>
      <div>
        <label className="label" htmlFor="username">Usuário do administrador</label>
        <input id="username" name="username" className="field" autoCapitalize="none" required />
      </div>
      <div>
        <label className="label" htmlFor="password">Senha (mínimo de 8 caracteres)</label>
        <input id="password" name="password" type="password" className="field" required minLength={8} />
      </div>
      {state.error && <p role="alert" className="text-sm text-win">{state.error}</p>}
      <button className="btn w-full" disabled={pending}>{pending ? "Criando…" : "Criar administrador"}</button>
    </form>
  );
}
