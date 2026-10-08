import "server-only";
import { adminDb } from "./supabase/admin";
import type { Profile } from "./auth";

type AuditEntry = {
  action: string;
  entity: string;
  entityId?: string | null;
  championshipId?: string | null;
  field?: string;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
};

const str = (v: unknown) => (v === undefined || v === null ? null : String(v));

/** Registra uma ou mais alterações administrativas no histórico. */
export async function audit(user: Profile, entries: AuditEntry | AuditEntry[]) {
  const list = Array.isArray(entries) ? entries : [entries];
  if (list.length === 0) return;
  await adminDb().from("audit_logs").insert(
    list.map((e) => ({
      user_id: user.id,
      username: user.username,
      action: e.action,
      entity: e.entity,
      entity_id: e.entityId ?? null,
      championship_id: e.championshipId ?? null,
      field: e.field ?? null,
      old_value: str(e.oldValue),
      new_value: str(e.newValue),
      reason: e.reason ?? null,
    })),
  );
}

export async function notify(userIds: (string | null | undefined)[], title: string, body?: string, link?: string) {
  const ids = [...new Set(userIds.filter((x): x is string => !!x))];
  if (ids.length === 0) return;
  await adminDb().from("notifications").insert(ids.map((user_id) => ({ user_id, title, body, link })));
}
