// Голод между игроками (ОС-1, docs/siege_v2.md, раздел 23): сервер войны судит склад окна лагеря тем же правилом шага, что
// мир и племя: добыча под штрафом по соотношению сил (`world/siegefood`) → прокорм → проверка, город сдан голодом только в
// шаге осады, где склад ниже нуля. Опись новее окна ставит склад заново (хлеб, пришедший в город, прокорм оплачивает); добыча
// слепка — не выше потолка подтверждённых построек (подделка).
import { afterEach, describe, expect, it } from 'vitest';
import { type CastleClaim, type RosterFile, type WarArmy, type WarSheet } from './contract.js';
import { castleIdOf, emptyRoster, upsert } from './roster.js';
import { advance, applyOrder, emptyWars, liveSheet, type SheetAt, type WarFile, type WarRow } from './war.js';
import { phaseAt, setPhaseDie } from '../../src/world/siegeroll.js';
import { breadAt, siegeSince, starvesAt, type SiegeWindow } from '../../src/world/siege.js';
import { siegeCut, siegeCutOf } from '../../src/world/siegefood.js';
import { troopPower } from '../../src/game/battle/price.js';

afterEach(() => setPhaseDie(null));

const A = 'tg-2001';
const B = 'tg-2002';
const T0 = 1_900_000_000_000;

const claim = (name: string): CastleClaim => ({ name, city: name, power: 5000, pop: 400 });

/** Город защитника: склад хлеба на две с половиной фазы без полей, гарнизон — `home`. */
const sheet = (over: Partial<WarSheet> = {}): WarSheet => ({
  army: { spearman: 400, archer: 200 },
  home: { spearman: 400, archer: 200 },
  militia: 20,
  archers: 6,
  resolve: 0,
  pips: {},
  rest: 1,
  food: 10_400,
  townPerHour: 1500,
  perManPerHour: 1,
  stock: { food: 10_400, wood: 5000 },
  stash: 100,
  gold: 400,
  pop: 400,
  bonded: 20,
  levels: { farm: 4, smithy: 2 },
  power: 5000,
  locks: {},
  seen: [],
  ...over,
});

function camped(b: Partial<WarSheet> = {}, army: WarArmy['troops'] = { spearman: 300, archer: 100 }, bAt: Partial<SheetAt> = {}) {
  let roster: RosterFile = emptyRoster();
  roster = upsert(roster, A, claim('Альфа'), T0);
  roster = upsert(roster, B, claim('Бета'), T0);
  const sheets = new Map<string, SheetAt>([
    [A, { sheet: sheet(), at: T0 }],
    [B, { sheet: sheet(b), at: T0, ...bAt }],
  ]);
  const ctx = { roster, sheet: (k: string) => sheets.get(k) ?? null };
  const file = emptyWars() as WarFile;
  expect(applyOrder(file, A, { op: 'march', target: castleIdOf(B), mode: 'siege', fate: 'plunder', army: { troops: army, resolve: 0, pips: {} } }, T0, ctx)).toBeNull();
  const w = file.wars[0] as WarRow;
  advance(file, w.arriveAt + 1, sheets);
  expect(w.phase, 'точка внутри области: лагерь встал').toBe('camp');
  return { file, sheets, w, camp: w.camp as SiegeWindow };
}

describe('ОС-1: склад окна лагеря — добыча под штрафом по соотношению сил', () => {
  it('штраф окна — мерка кольца на минуту постановки: мощь лагеря к гарнизону слепка', () => {
    const { w, camp } = camped({ yieldPerHour: 400 });
    const ratio = troopPower({ spearman: 300, archer: 100 }) / troopPower({ spearman: 400, archer: 200 });
    expect(ratio, 'точка внутри области: лагерь слабее гарнизона').toBeLessThan(1);
    expect(camp.cut).toBeCloseTo(siegeCut(ratio), 9);
    expect(camp.cut).toBeCloseTo(siegeCutOf(troopPower(w.army.troops as never), troopPower({ spearman: 400, archer: 200 })), 9);
    expect(camp.yieldPerHour).toBe(400);
  });

  it('поля кормят город (слабый лагерь, добыча под штрафом не меньше расхода) — шаги проходят, голода нет, отметки голода нет', () => {
    setPhaseDie(() => 7);
    // Расход окна — 1500 + 600 бойцов в час; добыча такая, что после штрафа слабого лагеря её больше.
    const { file, sheets, w, camp } = camped({ yieldPerHour: 30_000 });
    expect(starvesAt(camp), 'склад окна не опустеет').toBe(Infinity);
    expect(w.starvesAt, 'и отметки голода нет').toBeUndefined();
    advance(file, phaseAt(siegeSince(camp), 6) + 1, sheets);
    expect(w.fall, 'голодом не взят').toBeUndefined();
    expect(w.camp?.phases?.length, 'шесть шагов осады прошли').toBe(6);
  });
});

describe('ОС-1: опись новее окна ставит склад заново — хлеб, пришедший в город, прокорм оплачивает', () => {
  it('прогноз окна: голод в третьем шаге; опись с подвозом между шагами — третий шаг город не сдаёт', () => {
    setPhaseDie(() => 7);
    const { file, sheets, w, camp } = camped();
    const since = siegeSince(camp);
    expect(starvesAt(camp), 'точка внутри области: склад окна пуст до третьего шага').toBeLessThan(phaseAt(since, 3));
    // Защитник зашёл между первым и вторым шагом: опись — склад втрое больше (караван, весть).
    const at = phaseAt(since, 1) + 60_000;
    sheets.set(B, { sheet: sheet({ food: 30_000, stock: { food: 30_000, wood: 5000 } }), at });
    advance(file, phaseAt(since, 3) + 1, sheets);
    expect(w.fall, 'склад кормит — город стоит').toBeUndefined();
    expect(w.camp?.startedAt, 'окно встало на опись').toBe(at);
    expect(breadAt(w.camp as SiegeWindow, phaseAt(since, 3))).toBeGreaterThan(0);
  });

  it('опись того же склада (в пределах допуска) окна не двигает: одна запись — не повод для пересчёта', () => {
    setPhaseDie(() => 7);
    const { file, sheets, w, camp } = camped();
    const since = siegeSince(camp);
    const at = phaseAt(since, 1) + 60_000;
    const same = Math.floor(breadAt(camp, at));
    sheets.set(B, { sheet: sheet({ food: same, stock: { food: same, wood: 5000 } }), at });
    advance(file, phaseAt(since, 1) + 120_000, sheets);
    expect(w.camp?.startedAt).toBe(camp.startedAt);
  });
});

describe('ОС-1: подделка — добыча хлеба выше потолка подтверждённых построек', () => {
  it('слепок называет поля, которых нет, — в осаду идёт потолок', () => {
    const s: SheetAt = { sheet: sheet({ yieldPerHour: 1e6 }), at: T0, yieldCap: 250 };
    expect(liveSheet(emptyWars() as WarFile, B, s, T0).yieldPerHour).toBe(250);
    const fair: SheetAt = { sheet: sheet({ yieldPerHour: 200 }), at: T0, yieldCap: 250 };
    expect(liveSheet(emptyWars() as WarFile, B, fair, T0).yieldPerHour, 'честная — как есть').toBe(200);
  });

  it('в окне лагеря — потолок: голод тот же, что у честного города с такими полями', () => {
    const { camp } = camped({ yieldPerHour: 1e6 }, undefined, { yieldCap: 250 });
    expect(camp.yieldPerHour).toBe(250);
  });
});
