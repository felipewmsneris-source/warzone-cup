"use client";

import { useEffect, useState } from "react";

/** Mostra o prazo do report e avisa quando faltam 10 minutos ou menos. */
export function Deadline({ iso }: { iso: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);
  const end = new Date(iso).getTime();
  const label = new Intl.DateTimeFormat("pt-BR", { timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(end);
  if (now === null) return <span className="text-muted">Report permitido até {label}</span>;
  const minutes = Math.ceil((end - now) / 60000);
  if (minutes <= 0) return <span className="text-win">Prazo encerrado às {label}</span>;
  if (minutes <= 10) {
    return (
      <span className="font-semibold text-win">
        {minutes === 1 ? "Falta 1 minuto" : `Faltam ${minutes} minutos`} para o encerramento ({label})
      </span>
    );
  }
  return <span className="text-muted">Report permitido até {label}</span>;
}
