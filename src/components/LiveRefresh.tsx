"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { browserDb } from "@/lib/supabase/browser";

/**
 * Mantém a página atualizada sem refresh manual: escuta as mudanças do banco
 * (Supabase Realtime) e, como garantia, recarrega os dados a cada intervalo.
 */
export function LiveRefresh({ tables, intervalMs = 20000 }: { tables: string[]; intervalMs?: number }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const key = tables.join(",");

  useEffect(() => {
    const refresh = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 400);
    };
    const db = browserDb();
    const channel = db.channel(`live-${key}`);
    key.split(",").forEach((table) => {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, refresh);
    });
    channel.subscribe();
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, intervalMs);
    return () => {
      clearInterval(poll);
      if (timer.current) clearTimeout(timer.current);
      db.removeChannel(channel);
    };
  }, [key, intervalMs, router]);

  return null;
}
