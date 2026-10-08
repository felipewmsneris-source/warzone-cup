"use client";

import { useActionState } from "react";
import { login } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(login, {});
  return (
    <form action={action} className="panel mt-5 space-y-4 p-5">
      <div>
        <label className="label" htmlFor="username">Usuário</label>
        <input id="username" name="username" className="field" autoCapitalize="none" autoCorrect="off" autoComplete="username" required />
      </div>
      <div>
        <label className="label" htmlFor="password">Senha</label>
        <input id="password" name="password" type="password" className="field" autoComplete="current-password" required />
      </div>
      {state.error && <p role="alert" className="text-sm text-win">{state.error}</p>}
      <button className="btn w-full" disabled={pending}>{pending ? "Entrando…" : "Entrar"}</button>
    </form>
  );
}
