import { test } from "node:test";
import assert from "node:assert/strict";
import { matchRoster, normalizeName } from "../src/lib/names";
import { evaluateReadings, nameFlags, statusOnConfirm } from "../src/lib/evaluate";
import { rank } from "../src/lib/standings";
import { canSubmit } from "../src/lib/rules";
import { pts } from "../src/lib/format";
import type { ImageReading, Standing } from "../src/lib/types";

const roster = [
  { id: "a", name: "Nhonho", nickname: "Nhonho" },
  { id: "b", name: "Seu Madruga", nickname: "Seu Madruga" },
  { id: "c", name: "Coronel", nickname: "Coronel" },
];

const placement = (over: Partial<ImageReading> = {}): ImageReading => ({
  index: 0, type: "PLACEMENT", placement: 1, victory: true, headers: [], players: [],
  squadTotalBaixas: null, confidence: 0.99, notes: "", ...over,
});
const stats = (over: Partial<ImageReading> = {}): ImageReading => ({
  index: 1, type: "STATS", placement: null, victory: false,
  headers: ["NVL", "NOME", "PONTUAÇÃO", "ELIMINAÇÕES", "BAIXAS", "ASSIST.", "REMOBILIZAÇÕES", "DANO"],
  players: [
    { detectedName: "[XAVE$] seu madruga", baixas: 5, confidence: 0.98 },
    { detectedName: "[XAVE$]Nhonho", baixas: 5, confidence: 0.99 },
    { detectedName: "CORONEL", baixas: 4, confidence: 0.99 },
  ],
  squadTotalBaixas: 14, confidence: 0.98, notes: "", ...over,
});

test("clan tag, espaços e maiúsculas não atrapalham o nome", () => {
  assert.equal(normalizeName("[XAVE$]Nhonho", "[XAVE$]"), "nhonho");
  assert.equal(normalizeName("  SEU   madruga ", null), "seumadruga");
  assert.equal(normalizeName("XAVE Nhonho", "[XAVE$]"), "nhonho");
  const m = matchRoster(["[XAVE$] seu madruga", "[XAVE$]Nhonho", "CORONEL"], roster, "[XAVE$]");
  assert.deepEqual(m.map((x) => x.playerId), ["b", "a", "c"]);
  assert.deepEqual(nameFlags(m), []);
});

test("nome parecido não é aprovado sozinho; nome estranho fica sem jogador", () => {
  const close = matchRoster(["Nhonh0x", "Seu Madruga", "Coronel"], roster, null);
  assert.equal(close[0].playerId, "a");
  assert.deepEqual(nameFlags(close), ["NOME_BAIXA_CONFIANCA"]);
  const stranger = matchRoster(["Kiko", "Seu Madruga", "Coronel"], roster, null);
  assert.equal(stranger[0].playerId, null);
  assert.deepEqual(nameFlags(stranger), ["NOME_NAO_RECONHECIDO"]);
});

test("exemplo real: vitória com 5 + 5 + 4 = 14 baixas, em qualquer ordem de envio", () => {
  for (const order of [[placement(), stats()], [stats({ index: 0 }), placement({ index: 1 })]]) {
    const ev = evaluateReadings(order);
    assert.equal(ev.placement, 1);
    assert.equal(ev.victory, true);
    assert.equal(ev.totalBaixas, 14);
    assert.equal(ev.totalsMatch, true);
    assert.deepEqual(ev.flags, []);
    assert.equal(statusOnConfirm(ev.flags, true), "VALIDADA");
    assert.equal(statusOnConfirm(ev.flags, false), "ENVIADA");
  }
});

test("soma diferente do total do esquadrão vira DIVERGÊNCIA", () => {
  const ev = evaluateReadings([placement(), stats({ squadTotalBaixas: 19 })]);
  assert.ok(ev.flags.includes("SOMA_DIFERENTE_DO_TOTAL"));
  assert.equal(statusOnConfirm(ev.flags, true), "DIVERGENCIA");
});

test("valor ilegível nunca é completado: fica null e vai para análise", () => {
  const ev = evaluateReadings([
    placement({ placement: null, victory: false }),
    stats({ players: [...stats().players.slice(0, 2), { detectedName: "CORONEL", baixas: null, confidence: 0.4 }] }),
  ]);
  assert.equal(ev.placement, null);
  assert.equal(ev.totalBaixas, null);
  assert.ok(ev.flags.includes("COLOCACAO_ILEGIVEL"));
  assert.ok(ev.flags.includes("BAIXAS_ILEGIVEIS"));
  assert.equal(statusOnConfirm(ev.flags, true), "EM_ANALISE");
});

test("print faltando, coluna BAIXAS ausente e baixa confiança vão para análise", () => {
  assert.ok(evaluateReadings([placement()]).flags.includes("SEM_PRINT_PLACAR"));
  assert.ok(evaluateReadings([stats()]).flags.includes("SEM_PRINT_COLOCACAO"));
  assert.ok(
    evaluateReadings([placement(), stats({ headers: ["NOME", "ELIMINAÇÕES"] })]).flags.includes("COLUNA_BAIXAS_NAO_LOCALIZADA"),
  );
  assert.ok(evaluateReadings([placement(), stats({ confidence: 0.7 })]).flags.includes("LEITURA_BAIXA_CONFIANCA"));
  assert.ok(evaluateReadings([placement({ placement: 40, victory: false }), stats()]).flags.includes("COLOCACAO_FORA_DA_FAIXA"));
  assert.equal(statusOnConfirm(["DIVERGENCIA_INFORMADA_PELO_CAPITAO"], true), "DIVERGENCIA");
  assert.equal(statusOnConfirm(["POSSIVEL_PRINT_DUPLICADA"], true), "EM_ANALISE");
});

const row = (n: number, over: Partial<Standing>): Standing => ({
  championship_team_id: `t${n}`, championship_id: "c", team_number: n, tiebreak_manual: null, team_name: `T${n}`,
  clan_tag: null, total_points: 0, total_baixas: 0, victories: 0, matches_played: 1, points_by_match: {}, last_placement: null,
  ...over,
});

test("desempate: pontos, vitórias, baixas, última colocação e decisão do admin", () => {
  const order = ["victories", "baixas", "last_placement"];
  const r = rank(
    [
      row(1, { total_points: 50, victories: 0, total_baixas: 30 }),
      row(2, { total_points: 50, victories: 1, total_baixas: 20 }),
      row(3, { total_points: 60.4 }),
      row(4, { total_points: 50, victories: 0, total_baixas: 30, last_placement: 2 }),
    ],
    order,
  );
  assert.deepEqual(r.map((x) => x.team_number), [3, 2, 4, 1]);
  assert.ok(r.every((x) => !x.tied));

  const tie = rank([row(1, { total_points: 10 }), row(2, { total_points: 10 })], order);
  assert.ok(tie.every((x) => x.tied));
  const solved = rank([row(1, { total_points: 10, tiebreak_manual: 2 }), row(2, { total_points: 10, tiebreak_manual: 1 })], order);
  assert.deepEqual(solved.map((x) => x.team_number), [2, 1]);
  assert.ok(solved.every((x) => !x.tied));
});

test("prazo e proteção do report validado", () => {
  const open = { status: "ABERTA" as const, deadline: "2026-10-11T21:45:00-03:00" };
  assert.equal(canSubmit(open, null, new Date("2026-10-11T21:40:00-03:00")).ok, true);
  assert.equal(canSubmit(open, null, new Date("2026-10-11T21:46:00-03:00")).ok, false);
  assert.equal(canSubmit(open, { status: "REABERTO", late_allowed: true }, new Date("2026-10-11T23:00:00-03:00")).ok, true);
  assert.equal(canSubmit(open, { status: "VALIDADA", late_allowed: false }, new Date("2026-10-11T21:00:00-03:00")).ok, false);
  assert.equal(canSubmit({ status: "NAO_LIBERADA", deadline: null }, null).ok, false);
  assert.equal(canSubmit({ status: "FECHADA", deadline: null }, null).ok, false);
});

test("pontuação em formato brasileiro", () => {
  assert.equal(pts(8.4), "8,4");
  assert.equal(pts("38.00"), "38");
});
