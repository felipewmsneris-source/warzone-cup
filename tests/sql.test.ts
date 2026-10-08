import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

/** Sobe um Postgres em memória, simula o que o Supabase já traz pronto e roda a migration real. */
async function boot() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create publication supabase_realtime;
    grant usage on schema public, auth to anon, authenticated, service_role;
  `);
  await db.exec(readFileSync("supabase/migrations/0001_init.sql", "utf8"));
  return db;
}

const U = {
  admin: "00000000-0000-0000-0000-0000000000a0",
  cap1: "00000000-0000-0000-0000-0000000000c1",
  cap2: "00000000-0000-0000-0000-0000000000c2",
};

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users values ('${U.admin}'), ('${U.cap1}'), ('${U.cap2}');
    insert into profiles (id, username, display_name, role) values
      ('${U.admin}', 'admin', 'Admin', 'ADMIN'), ('${U.cap1}', 'nhonho', 'Nhonho', 'CAPTAIN'), ('${U.cap2}', 'kiko', 'Kiko', 'CAPTAIN');
    insert into championships (id, name, status, is_public) values
      ('10000000-0000-0000-0000-000000000001', 'Copa', 'ATIVO', true),
      ('10000000-0000-0000-0000-000000000002', 'Oculto', 'RASCUNHO', false);
    insert into scoring_rules (championship_id, placement_from, placement_to, multiplier, bonus) values
      ('10000000-0000-0000-0000-000000000001', 1, 1, 2.0, 10), ('10000000-0000-0000-0000-000000000001', 2, 2, 1.6, 0),
      ('10000000-0000-0000-0000-000000000001', 3, 3, 1.5, 0), ('10000000-0000-0000-0000-000000000001', 4, 4, 1.4, 0),
      ('10000000-0000-0000-0000-000000000001', 5, 5, 1.3, 0), ('10000000-0000-0000-0000-000000000001', 6, 10, 1.2, 0),
      ('10000000-0000-0000-0000-000000000001', 11, 16, 1.0, 0);
    insert into teams (id, name) values ('20000000-0000-0000-0000-000000000001', 'XAVE'), ('20000000-0000-0000-0000-000000000002', 'VILA');
    insert into championship_teams (id, championship_id, team_id, team_number, captain_user_id) values
      ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 1, '${U.cap1}'),
      ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 2, '${U.cap2}');
    insert into matches (id, championship_id, match_number, status) values
      ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 1, 'ABERTA'),
      ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 2, 'ABERTA');
    insert into reports (id, match_id, championship_team_id, status, placement, total_scoring_baixas) values
      ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'ENVIADA', 1, 14),
      ('50000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 'ENVIADA', 1, 9),
      ('50000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', 'ENVIADA', 8, 7);
  `);
}

const C = "10000000-0000-0000-0000-000000000001";

test("pontuação: todos os exemplos do regulamento, sem erro de casa decimal", async () => {
  const db = await boot();
  await seed(db);
  const cases: [number, number, string][] = [
    [12, 10, "10.00"], [8, 10, "12.00"], [5, 10, "13.00"], [4, 10, "14.00"],
    [3, 10, "15.00"], [2, 10, "16.00"], [1, 10, "30.00"], [1, 14, "38.00"], [8, 7, "8.40"], [3, 12, "18.00"],
  ];
  for (const [placement, baixas, expected] of cases) {
    const r = await db.query<{ points: string }>("select points from calc_points($1, $2, $3)", [C, placement, baixas]);
    assert.equal(r.rows[0].points, expected, `${placement}º com ${baixas} baixas`);
  }
  assert.equal((await db.query("select * from calc_points($1, 17, 5)", [C])).rows.length, 0);
});

test("validação grava o resultado, soma por partida e impede dois vencedores", async () => {
  const db = await boot();
  await seed(db);
  await db.query("select apply_validation('50000000-0000-0000-0000-000000000001', $1)", [U.admin]);
  await db.query("select apply_validation('50000000-0000-0000-0000-000000000003', null)");
  await assert.rejects(
    db.query("select apply_validation('50000000-0000-0000-0000-000000000002', $1)", [U.admin]),
    /duplicate key|unique/i,
  );
  const st = await db.query<{ status: string }>("select status from reports where id = '50000000-0000-0000-0000-000000000002'");
  assert.equal(st.rows[0].status, "ENVIADA", "a validação recusada não altera o report");

  const s = await db.query<Record<string, unknown>>("select * from standings where team_number = 1");
  assert.equal(s.rows[0].total_points, "46.40"); // 38 + 8,4 — multiplicador só nas baixas de cada partida
  assert.equal(s.rows[0].total_baixas, 21);
  assert.equal(s.rows[0].victories, 1);
  assert.equal(s.rows[0].matches_played, 2);
  assert.equal(s.rows[0].last_placement, 8);
  assert.deepEqual(s.rows[0].points_by_match, { "1": 38, "2": 8.4 });

  // mudar a regra e recalcular
  await db.exec(`update scoring_rules set bonus = 20 where championship_id = '${C}' and placement_from = 1`);
  await db.query("select recalc_championship($1)", [C]);
  const again = await db.query<{ total_points: string }>("select total_points from standings where team_number = 1");
  assert.equal(again.rows[0].total_points, "56.40");
});

test("report incompleto não pode ser validado", async () => {
  const db = await boot();
  await seed(db);
  await db.exec("update reports set placement = null where id = '50000000-0000-0000-0000-000000000003'");
  await assert.rejects(db.query("select apply_validation('50000000-0000-0000-0000-000000000003', null)"), /REPORT_INCOMPLETO/);
});

test("RLS: público, capitão e admin enxergam só o que devem; ninguém grava direto", async () => {
  const db = await boot();
  await seed(db);
  await db.query("select apply_validation('50000000-0000-0000-0000-000000000001', null)");
  const as = async (role: string, uid: string, sql: string) => {
    await db.exec(`set role ${role}; select set_config('test.uid', '${uid}', false);`);
    try {
      return await db.query<Record<string, unknown>>(sql);
    } finally {
      await db.exec("reset role");
    }
  };
  const count = async (role: string, uid: string, table: string) => (await as(role, uid, `select * from ${table}`)).rows.length;

  // público
  assert.equal(await count("anon", "", "championships"), 1, "só o campeonato publicado");
  assert.equal(await count("anon", "", "standings"), 2);
  assert.equal(await count("anon", "", "match_results"), 1);
  for (const t of ["reports", "report_images", "player_baixas", "audit_logs", "notifications", "profiles", "image_hashes"]) {
    assert.equal(await count("anon", "", t), 0, `público não lê ${t}`);
  }
  // capitão: só o próprio time
  assert.equal(await count("authenticated", U.cap1, "reports"), 2);
  assert.equal(await count("authenticated", U.cap2, "reports"), 1);
  assert.equal(await count("authenticated", U.cap1, "profiles"), 1);
  assert.equal(await count("authenticated", U.cap1, "audit_logs"), 0);
  // admin
  assert.equal(await count("authenticated", U.admin, "reports"), 3);
  assert.equal(await count("authenticated", U.admin, "championships"), 2);

  // escrita direta negada no banco, até para o capitão dono do report
  for (const sql of [
    "update reports set total_scoring_baixas = 99",
    "insert into match_results (report_id, match_id, championship_id, championship_team_id, placement, victory, scoring_baixas, multiplier, bonus, points) select id, match_id, '" + C + "', championship_team_id, 2, false, 99, 1, 0, 99 from reports limit 1",
    "delete from match_results",
    "update profiles set role = 'ADMIN'",
    "select apply_validation('50000000-0000-0000-0000-000000000003', null)",
  ]) {
    await assert.rejects(as("authenticated", U.cap1, sql), /permission denied/i, sql);
  }
});
