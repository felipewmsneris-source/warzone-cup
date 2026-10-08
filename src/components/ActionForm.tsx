"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

type State = { error?: string; ok?: string };

export function ActionForm({
  action, children, className, confirm,
}: {
  action: (prev: State, fd: FormData) => Promise<State>;
  children: React.ReactNode;
  className?: string;
  confirm?: string;
}) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form
      action={formAction}
      className={className}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
      {state.error && <p role="alert" className="mt-2 text-sm text-win">{state.error}</p>}
      {state.ok && <p role="status" className="mt-2 text-sm text-ok">{state.ok}</p>}
    </form>
  );
}

export function Submit({ children, className = "btn" }: { children: React.ReactNode; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className}>
      {pending ? "Salvando…" : children}
    </button>
  );
}
