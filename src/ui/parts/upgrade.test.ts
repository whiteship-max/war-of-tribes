// Кнопка улучшения говорит то, что даст уровень, — и не больше.
//
// Проверяется правило, а не случаи. Сначала по исходнику: в модуле кнопки нет ни
// одного чтения поля здания, значит числа ей неоткуда взять, кроме настоящего
// расчёта. Потом прогоном: на каждом уровне каждого здания в нескольких посёлках
// каждое число на кнопке совпадает с замером, сделанным здесь своими дверями
// (слепок, который уезжает в мир, назначение рабочих настоящим `assignWorker`,
// строки разборов, поход с потерями, отказ мира), а каждая величина, которая
// изменилась, на кнопке стоит. Новое улучшение после этого соврать не сможет:
// число без замера не пройдёт первую проверку, забытая величина — вторую.
import { describe, expect, it } from 'vitest';
import { asGame, realSeconds } from '@/game/pace';
import { waitDays, waitSpan } from './wait';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Building, BuildingTypeId, FaithId, GameState } from '@/game/types';
import { createInitialState } from '@/game/state';
import { DAY_LENGTH, RESOURCE_IDS, SIEGE_YIELD } from '@/game/constants';
import { BUILDINGS, jobsOf } from '@/game/data/buildings';
import { GOOD_BY_ID, offerSlots } from '@/game/data/market';
import { PURSE, depthOf } from '@/game/marketrules';
import { SEASON_SECONDS } from '@/game/data/seasons';
import { SURVEY_MAX } from '@/game/data/survey';
import {
  buildingOfType,
  caravanSeconds,
  crafterBuildRate,
  feastInfo,
  forgeInfo,
  healShare,
  infirmaryBeds,
  housingCapacity,
  jobMultiplier,
  marketLevel,
  maxLevelFor,
  moraleBreakdown,
  payGraceDays,
  pietyBreakdown,
  productionPerDay,
  recruitRate,
  stalls,
  storageCap,
  taxIncomePerDay,
  towerSeats,
  townHallBuildMult,
  workerCount,
} from '@/game/derived';
import { woundsOfBattle } from '@/game/sim/infirmary';
import { tick } from '@/game/sim/tick';
import { popGrowth } from '@/game/sim/population';
import { surveyInfo } from '@/game/sim/survey';
import { assignWorker } from '@/game/sim/workers';
import { playerProfile } from '@/world/bridge';
import { spiritView } from '@/game/sim/spirit';

/** Строки стойкости в морали духа (ДР-1). */
const RESOLVE_LINES = new Set(['rite', 'marshal', 'knights', 'merchants']);
import { NOTHING_GAINED, gainText, readVillage, shown, upgradeGain, upgradeGains } from './upgrade';

const stripComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Ставит зданию уровень так, как его ставит конец стройки: число и пустые леса. */
function place(s: GameState, type: BuildingTypeId, level: number): Building {
  const b = buildingOfType(s, type)!;
  b.level = level;
  b.work = 0;
  b.workRequired = 0;
  return b;
}

const clone = (s: GameState): GameState => JSON.parse(JSON.stringify(s)) as GameState;

/** Посёлок середины партии: уровни вразнобой, люди на половине мест, дружина, склад. */
function village(faith: FaithId | null, tweak: (s: GameState) => void = () => {}): GameState {
  const s = createInitialState();
  s.pop = 420;
  s.faith.id = faith;
  s.faith.observance = 'strict';
  s.buildings.forEach((b, i) => {
    b.level = Math.min(maxLevelFor(b.type), 1 + ((i * 3) % 10));
  });
  s.workers = {};
  for (const b of s.buildings) {
    const def = BUILDINGS.find((d) => d.id === b.type)!;
    for (const job of def.jobs ?? []) s.workers[job] = Math.floor((b.level * (def.slotsPerLevel ?? 12)) / 2);
  }
  s.army = { ...s.army, clubman: 40, spearman: 20, legionary: 6, rider: 12 };
  for (const r of RESOURCE_IDS) s.resources[r] = 2500;
  s.gold = 600;
  tweak(s);
  return s;
}

/**
 * Посёлки, на которых сверяется кнопка. Весна: выработка рабочего меряется без
 * сезона, а здесь её меряют настоящей выработкой — в весну она у всех профессий
 * ненулевая. Зима и осада проверены отдельно.
 */
const FIXTURES: [string, () => GameState][] = [
  ['новая партия', () => createInitialState()],
  ['католики', () => village('catholic')],
  ['православные', () => village('orthodox')],
  ['ислам', () => village('islam')],
  ['язычники в обряд', () => village('pagan', (s) => (s.faith.riteUntil = s.time + 60))],
  ['теснота', () => village(null, (s) => (s.pop = 1400))],
  ['раскол в приходе', () => village('catholic', (s) => ((s.faith.strain = 60), (s.faith.observance = 'worldly')))],
];

// ---------- Замер со стороны игры ----------

type Kind = 'more' | 'grow' | 'share' | 'count' | 'plusAfter' | 'upto' | 'days' | 'graceDays' | 'seconds' | 'wait' | 'opens';

/** Числа, которые обязаны стоять на кнопке при такой разнице; null — разницы не видно. */
function expectedNumbers(kind: Kind, before: number, after: number): number[] | null {
  switch (kind) {
    case 'more': {
      const d = shown(after - before);
      return d === 0 ? null : [Math.abs(d)];
    }
    case 'grow': {
      const p = Math.round((after / before - 1) * 100);
      return p === 0 ? null : [Math.abs(p)];
    }
    case 'share': {
      const pa = Math.round(after * 100);
      const pb = Math.round(before * 100);
      return pa === pb ? null : [pa, pb];
    }
    case 'count':
      return after - before <= 0 ? null : [after - before];
    case 'plusAfter':
      return after - before <= 0 ? null : [after - before, after];
    case 'upto':
      return after <= before ? null : [after];
    // Срок в игровых днях, которого игрок ждёт: на кнопке — настоящее время из модуля сроков.
    case 'days': {
      const d = shown((before - after) / DAY_LENGTH);
      return d === 0 ? null : numbersIn(waitDays(Math.abs(d)));
    }
    // Прибавка в игровых днях, которой игрок ждёт своими часами: на кнопке — настоящее время из модуля сроков.
    case 'graceDays':
      return after - before <= 0 ? null : numbersIn(waitDays(after - before));
    // Открытие — не число: на кнопке слова без чисел, и только на уровне, где оно наступает.
    case 'opens':
      return after > before ? [] : null;
    // Дорога каравана — настоящие секунды: на кнопке они, а величина племени лежит игровыми.
    case 'seconds': {
      const d = shown(realSeconds(before - after));
      return d === 0 ? null : [Math.abs(d)];
    }
    // Срок племени, который игрок ждёт своими часами: на кнопке — настоящее время из модуля сроков.
    case 'wait': {
      const d = shown(after - before);
      return d === 0 ? null : numbersIn(waitSpan(asGame(Math.abs(d))));
    }
  }
}

/** Обряд идёт: стойкость в обряд меряется тем, что уезжает в мир во время обряда. */
const inRite = (s: GameState): GameState => ({ ...s, faith: { ...s.faith, riteUntil: s.time + 1 } });

/**
 * Каждая величина, которую двигает уровень хоть одного здания, — и где её читает
 * игра. Там, где число уезжает в мир, оно берётся из слепка деревни (`playerProfile`):
 * ровно его мир и получает.
 */
const SPEC: Record<string, { kind: Kind; read: (s: GameState) => number }> = {
  build: { kind: 'grow', read: townHallBuildMult },
  housing: { kind: 'more', read: housingCapacity },
  storage: { kind: 'more', read: storageCap },
  recruit: { kind: 'grow', read: (s) => recruitRate(s, 'legionary') },
  cavalry: { kind: 'grow', read: (s) => recruitRate(s, 'rider') },
  stalls: { kind: 'count', read: (s) => stalls(s) },
  defense: { kind: 'more', read: (s) => playerProfile(s).defense },
  archers: { kind: 'more', read: (s) => playerProfile(s).militiaArchers ?? 0 },
  seats: { kind: 'more', read: towerSeats },
  loyalty: { kind: 'graceDays', read: payGraceDays },
  // Воинская традиция Статуи (П4): кружки полководца — замером того, что уезжает в мир: отметок у полководца первого уровня
  // столько, сколько кружков дала традиция (в посёлках замера полководец свежий). На кнопке — прибавка навыков.
  tradition: { kind: 'count', read: (s) => Object.values(playerProfile(s).pips ?? {}).reduce((n, x) => n + (x ?? 0), 0) },
  heal: { kind: 'share', read: healShare },
  beds: { kind: 'plusAfter', read: infirmaryBeds },
  warning: { kind: 'wait', read: (s) => playerProfile(s).warning ?? 0 },
  survey: { kind: 'upto', read: (s) => Math.min(SURVEY_MAX, surveyInfo(s).level) },
  intel: { kind: 'grow', read: (s) => playerProfile(s).intelKeen ?? 1 },
  stash: { kind: 'plusAfter', read: (s) => playerProfile(s).stash },
  feast: { kind: 'more', read: (s) => feastInfo(s).bonus },
  feastWait: { kind: 'days', read: (s) => feastInfo(s).wait },
  goods: { kind: 'count', read: (s) => offerSlots(marketLevel(s)) },
  stock: { kind: 'more', read: (s) => depthOf(GOOD_BY_ID.food, marketLevel(s)) },
  purse: { kind: 'more', read: (s) => PURSE[marketLevel(s)] ?? 0 },
  caravan: { kind: 'seconds', read: caravanSeconds },
  morale: { kind: 'more', read: (s) => moraleBreakdown(s).raw },
  piety: { kind: 'more', read: (s) => pietyBreakdown(s).raw },
  gold: { kind: 'more', read: taxIncomePerDay },
  output: { kind: 'grow', read: (s) => jobMultiplier(s, 'hunter') },
  learning: { kind: 'grow', read: (s) => surveyInfo(s).learning },
  growth: { kind: 'grow', read: (s) => popGrowth(s).faith },
  // Стойкость обряда, Воеводы и сословий — строки морали духа (ДР-1): сумма строк стойкости, той же двери, что едет в мир.
  fervour: { kind: 'more', read: (s) => spiritView(inRite(s)).morale.lines.filter((l) => RESOLVE_LINES.has(l.id)).reduce((n, l) => n + l.value, 0) },
};

const lineOf = (lines: { id: string; value: number }[], id: string): number =>
  lines.find((l) => l.id === id)?.value ?? 0;

/**
 * Труд здания со стороны игры: выработка всего посёлка, скорость мастерской,
 * работа горна и строки служителей в разборах. Люди ставятся настоящим
 * `assignWorker` — сколько он пустит, столько и мест.
 */
function staffedWork(s: GameState, type: BuildingTypeId, level: number, want: number): { work: number[]; hands: number } {
  const t = clone(s);
  const b = place(t, type, level);
  t.siege = null;
  t.pop = 100_000;
  for (const job of jobsOf(b.type)) t.workers[job] = 0;
  t.bondedWork = {};
  // По `want` на каждое дело (ЗД-1): у двора с двумя делами «один рабочий» — по одному на каждом, «полные места» — у каждого
  // свои.
  if (want > 0) for (const job of jobsOf(b.type)) assignWorker(t, b.id, want, job);
  const made = productionPerDay(t);
  return {
    hands: workerCount(t, b.id),
    work: [
      ...RESOURCE_IDS.map((r) => made[r]),
      crafterBuildRate(t),
      forgeInfo(t).rate,
      lineOf(moraleBreakdown(t).lines, 'priests'),
      lineOf(pietyBreakdown(t).lines, 'priests'),
    ],
  };
}

function handsWork(s: GameState, type: BuildingTypeId, level: number, want: number): { work: number[]; hands: number } {
  const on = staffedWork(s, type, level, want);
  const off = staffedWork(s, type, level, 0);
  return { hands: on.hands, work: on.work.map((v, i) => v - off.work[i]) };
}

/** Что про места и рабочих обязано стоять на кнопке: id прибавки и её числа. */
function expectedWork(s: GameState, type: BuildingTypeId, level: number): Map<string, number[]> {
  const out = new Map<string, number[]>();
  const capNow = staffedWork(s, type, level, 100_000).hands;
  const capNext = staffedWork(s, type, level + 1, 100_000).hands;
  if (capNext <= 0) return out;
  const one = handsWork(s, type, level, 1).work;
  const oneNext = handsWork(s, type, level + 1, 1).work;
  const lift = one.map((v, i) => (v > 1e-9 ? Math.round((oneNext[i] / v - 1) * 100) : 0));
  if (capNext > capNow) {
    // `staffedWork` ставит руки на каждое дело — нынешние места одного дела: все места поровну на дела.
    const deals = Math.max(1, jobsOf(type).length);
    const full = handsWork(s, type, level + 1, capNext).work;
    const old = handsWork(s, type, level + 1, capNow / deals).work;
    const gain = full.map((v, i) => v - old[i]);
    if (gain.some((g) => g > 1e-9)) {
      const flat = gain.map((g, i) => (lift[i] !== 0 ? 0 : shown(g))).filter((g) => g !== 0).map(Math.abs);
      out.set('slots', [capNext - capNow, ...flat]);
    } else {
      out.set('idleSlots', []);
    }
  }
  const main = lift.reduce((best, p) => (Math.abs(p) > Math.abs(best) ? p : best), 0);
  if (main !== 0) out.set('hand', [Math.abs(main)]);
  return out;
}

/** Все числа, стоящие в словах, — чтобы в подписи не оказалось числа без замера. Дробь на кнопке — запятой («2,5»). */
const numbersIn = (text: string): number[] => (text.match(/\d+(?:[.,]\d+)?/g) ?? []).map((x) => Number(x.replace(',', '.')));

// ---------- Тесты ----------

describe('кнопка улучшения не пишет чисел от себя', () => {
  it('в модуле кнопки нет ни одного чтения поля здания', () => {
    const src = stripComments(readFileSync(join(__dirname, 'upgrade.ts'), 'utf8'));
    // Всё, откуда можно взять число «по полю», а не у расчёта игры: само поле
    // здания, его прибавка за уровень и константы, из которых игра потом строит
    // величину. Появится здесь такое чтение — вернётся ровно та поломка, из-за
    // которой лазарет обещал прибавку сверх потолка.
    const fields = [
      'buildingStat', 'statOf', 'levelOutputMult', 'stashAt', 'perLevel', 'slotsPerLevel',
      'buildingHousing', 'BUILDING_BY_ID', 'BUILDINGS', 'stockPerLevel', 'RECRUIT_WORK',
      'LEVEL_OUTPUT_STEP', 'SLOTS_PER_LEVEL', 'TOWN_HALL_BUILD_STEP', 'INFIRMARY_HEAL_CAP',
      'OFFER_BASE', 'OFFER_PER_LEVEL', 'CARAVAN_BASE', 'CARAVAN_PER_LEVEL', 'tiltAt', 'tiltShare',
    ];
    for (const name of fields) expect(src, name).not.toMatch(new RegExp(`\\b${name}\\b`));
    // Семейства констант — целиком: потолки служителей, набожность, откат пира.
    expect(src).not.toMatch(/\bPRIEST_MORALE|\bPIETY_|\bFEAST_COOLDOWN|data\/buildings/);
  });
});

describe('каждое число на кнопке — замер, и каждая перемена — на кнопке', () => {
  for (const [name, make] of FIXTURES) {
    it(name, () => {
      const base = make();
      for (const def of BUILDINGS) {
        const max = maxLevelFor(def.id);
        for (let level = 1; level < max; level++) {
          const s = clone(base);
          const b = place(s, def.id, level);
          const next = clone(s);
          place(next, def.id, level + 1);
          const where = `${name}: ${def.id} ${level}→${level + 1}`;
          const gains = upgradeGains(s, b, level + 1);
          const byId = new Map(gains.map((g) => [g.id, g]));

          // Числа в словах — ровно числа прибавки, и ничего сверх.
          for (const g of gains) {
            expect(numbersIn(g.text), `${where}: ${g.text}`).toEqual(g.numbers);
          }

          // Каждая величина посёлка: изменилась — стоит на кнопке с теми же числами;
          // не изменилась — не стоит.
          for (const [id, spec] of Object.entries(SPEC)) {
            const want = expectedNumbers(spec.kind, spec.read(s), spec.read(next));
            const got = byId.get(id);
            if (want === null) expect(got, `${where}: ${id} на кнопке без перемены — «${got?.text}»`).toBeUndefined();
            else expect(got?.numbers, `${where}: ${id}`).toEqual(want);
          }

          // Места и рабочие — тем же правилом, но своими дверями.
          const work = expectedWork(s, def.id, level);
          for (const id of ['slots', 'idleSlots', 'hand']) {
            expect(byId.get(id)?.numbers, `${where}: ${id} — «${byId.get(id)?.text}»`).toEqual(work.get(id));
          }

          // Прибавок сверх замеренных на кнопке не бывает.
          for (const g of gains) {
            expect(g.id in SPEC || ['slots', 'idleSlots', 'hand'].includes(g.id), `${where}: ${g.id} без замера`).toBe(true);
          }

          // Ничего не изменилось — это сказано словами, а не пустой строкой.
          expect(upgradeGain(s, b, level + 1)).toBe(gains.length > 0 ? gainText(gains) : NOTHING_GAINED);
          // Общие показания посёлка дают то же, что замер с нуля.
          expect(upgradeGains(s, b, level + 1, readVillage(s))).toEqual(gains);
        }
      }
    });
  }
});

describe('кнопка видит каждое число здания, растущее с уровнем', () => {
  it('удвоенное поле здания меняет кнопку хоть на одном уровне: поля без замера на кнопке не бывает', () => {
    // Поле, которого кнопка не видит, — это уровень, о котором она сказала бы
    // «ничего не прибавит», хотя игра его читает. Удваивается каждое число, от
    // которого что-то растёт с уровнем, и кнопка обязана это заметить.
    const STATS = [
      'housing', 'storage', 'defense', 'morale', 'archers', 'heal', 'intel', 'warn',
      'train', 'stalls', 'hidden', 'feast', 'loyalty',
    ] as const;
    const labels = (type: BuildingTypeId): string => {
      const out: string[] = [];
      for (const make of [() => createInitialState(), () => village('orthodox')]) {
        for (let level = 1; level < maxLevelFor(type); level++) {
          const s = make();
          const b = place(s, type, level);
          out.push(upgradeGain(s, b, level + 1));
        }
      }
      return out.join(' | ');
    };
    let checked = 0;
    for (const def of BUILDINGS) {
      if (maxLevelFor(def.id) <= 1) continue;
      const fields: [string, () => () => void][] = [];
      for (const key of STATS) {
        if (def[key] === undefined && def.perLevel?.[key] === undefined) continue;
        fields.push([
          key,
          () => {
            const base = def[key];
            const per = def.perLevel?.[key];
            if (base !== undefined) def[key] = base * 2;
            if (per !== undefined) def.perLevel![key] = per * 2;
            return () => {
              def[key] = base;
              if (per !== undefined) def.perLevel![key] = per;
            };
          },
        ]);
      }
      if (def.slotsPerLevel !== undefined) {
        fields.push([
          'slotsPerLevel',
          () => {
            const was = def.slotsPerLevel;
            def.slotsPerLevel = (was ?? 0) * 2;
            return () => (def.slotsPerLevel = was);
          },
        ]);
      }
      const plain = labels(def.id);
      for (const [key, bend] of fields) {
        const undo = bend();
        try {
          expect(labels(def.id), `${def.id}.${key}: кнопка не заметила удвоенного поля`).not.toBe(plain);
        } finally {
          undo();
        }
        checked++;
      }
      expect(labels(def.id), `${def.id}: поле вернулось на место`).toBe(plain);
    }
    expect(checked).toBeGreaterThan(20);
  });
});

describe('лазарет', () => {
  it('прибавка на кнопке — это раненые из настоящего боя; каждый уровень что-то прибавляет', () => {
    /**
     * Какая доля из тысячи павших ранена при лазарете этого уровня — настоящей дверью раненых. Мест на
     * тысячу не хватит: ранены и легшие, и не выжившие сверх мест.
     */
    const healed = (level: number): number => {
      const s = createInitialState();
      place(s, 'infirmary', level);
      const c = woundsOfBattle(s, { clubman: 1000 }, undefined, false);
      expect(c.noBed, `${level}: точка внутри области — мест меньше, чем раненых`).toBeGreaterThan(0);
      return (c.laid + c.noBed) / 1000;
    };
    let nothing = 0;
    for (let level = 1; level < maxLevelFor('infirmary'); level++) {
      const s = createInitialState();
      const b = place(s, 'infirmary', level);
      const gain = upgradeGains(s, b, level + 1).find((g) => g.id === 'heal');
      const before = Math.round(healed(level) * 100);
      const after = Math.round(healed(level + 1) * 100);
      if (after === before) {
        expect(gain, `${level}→${level + 1}`).toBeUndefined();
        expect(upgradeGain(s, b, level + 1)).toBe(NOTHING_GAINED);
        nothing++;
      } else {
        expect(gain?.numbers, `${level}→${level + 1}`).toEqual([after, before]);
      }
    }
    // Решение владельца (docs/infirmary.md, 9.5): доля доходит до потолка ровно на десятом, пустых уровней нет.
    expect(nothing).toBe(0);
  });
});

describe('конюшня и казармы', () => {
  it('скорость найма конницы обещает только конюшня: казармы конницу не учат', () => {
    let stable = 0;
    for (let level = 1; level < maxLevelFor('barracks'); level++) {
      const s = createInitialState();
      place(s, 'stable', 3);
      const b = place(s, 'barracks', level);
      // Точка внутри области: уровень казарм двигает найм пехоты — иначе молчание о коннице было бы даром.
      expect(upgradeGains(s, b, level + 1).find((g) => g.id === 'recruit'), `казармы ${level}: найм пехоты`).toBeDefined();
      expect(upgradeGains(s, b, level + 1).find((g) => g.id === 'cavalry'), `казармы ${level}: конница`).toBeUndefined();
    }
    for (let level = 1; level < maxLevelFor('stable'); level++) {
      const s = createInitialState();
      const b = place(s, 'stable', level);
      if (upgradeGains(s, b, level + 1).find((g) => g.id === 'cavalry')) stable++;
    }
    expect(stable, 'уровни конюшни, ускоряющие конницу').toBeGreaterThan(0);
  });
});

describe('Статуя', () => {
  it('«+срок к терпению» — после улучшения войско без платы начинает уходить ровно через замеренное терпение', () => {
    /** Через сколько игровых дней неуплаты ушёл первый боец при Статуе этого уровня. */
    const firstLeave = (level: number): number => {
      const s = createInitialState();
      place(s, 'statue', level);
      s.tutorialDone = true;
      s.nextEventAt = Infinity;
      s.tax = 'none';
      s.gold = 0;
      s.army.spearman = 100;
      for (const r of RESOURCE_IDS) s.resources[r] = 5000;
      const start = s.time;
      for (let i = 0; i < 20 * DAY_LENGTH * 2; i++) {
        tick(s, 0.5);
        if (s.army.spearman < 100) return (s.time - start) / DAY_LENGTH;
      }
      return Infinity;
    };
    for (let level = 1; level < maxLevelFor('statue'); level++) {
      const s = createInitialState();
      const b = place(s, 'statue', level);
      const gain = upgradeGains(s, b, level + 1).find((g) => g.id === 'loyalty');
      const after = firstLeave(level + 1);
      const promised = gain!.after;
      // Первый уходит чуть позже срока: сотне копейщиков нужно несколько секунд, чтобы
      // доля ухода набрала целого бойца. Позже на десятую дня — уже неправда.
      expect(after, `${level}→${level + 1}: уходить начали не раньше обещанного`).toBeGreaterThanOrEqual(promised);
      expect(after, `${level}→${level + 1}: и не позже`).toBeLessThan(promised + 0.1);
      // Числа Статуи — терпение войска и воинская традиция (П4, 14.35; прибавка героя ушла с поставкой 1 боя, docs/battle_eu4.md,
      // 14.19.6). Терпения игрок ждёт своими часами: на кнопке прибавка настоящим временем, словами модуля сроков.
      expect(gain!.text, `${level}→${level + 1}`).toBe(`+${waitDays(promised - payGraceDays(s))} к терпению дружины`);
      expect(upgradeGain(s, b, level + 1)).not.toMatch(/героем/);
    }
  });
});

describe('рабочие и места', () => {
  /** Что кнопка обещает рабочему — так, как это прочтёт игрок. Процента нет — ноль. */
  const promisedLift = (text: string): number => {
    const m = text.match(/каждый рабочий ([+−])(\d+)%/) ?? text.match(/([+−])(\d+)% к выработке(?! всех)/);
    return m ? (m[1] === '−' ? -1 : 1) * Number(m[2]) : 0;
  };
  const promisedSlots = (text: string): number => Number(text.match(/\+(\d+) рабоч\S+ мест/)?.[1] ?? 0);

  it('вклад рабочего на L и L+1, замеренный игрой, — тот самый процент на кнопке; у служителей храма процента нет', () => {
    for (const [name, make] of [FIXTURES[0], FIXTURES[1]]) {
      for (const def of BUILDINGS.filter((d) => d.jobs?.length)) {
        for (let level = 1; level < maxLevelFor(def.id); level++) {
          const s = make();
          const b = place(s, def.id, level);
          const one = handsWork(s, def.id, level, 1).work;
          const oneNext = handsWork(s, def.id, level + 1, 1).work;
          const measured = one.reduce((best, v, i) => {
            if (v <= 1e-9) return best;
            const p = Math.round((oneNext[i] / v - 1) * 100);
            return Math.abs(p) > Math.abs(best) ? p : best;
          }, 0);
          const text = upgradeGain(s, b, level + 1);
          expect(promisedLift(text), `${name}: ${def.id} ${level}→${level + 1} — «${text}»`).toBe(measured);
          if (def.id === 'church') expect(measured).toBe(0);
        }
      }
    }
  });

  it('места, которым нечего дать, кнопка не обещает: храм с седьмого уровня', () => {
    const s = village('orthodox');
    let empty = 0;
    for (let level = 1; level < maxLevelFor('church'); level++) {
      const b = place(s, 'church', level);
      const full = handsWork(s, 'church', level + 1, 100_000).work;
      const old = handsWork(s, 'church', level + 1, staffedWork(s, 'church', level, 100_000).hands).work;
      const useful = full.some((v, i) => v - old[i] > 1e-9);
      const text = upgradeGain(s, b, level + 1);
      expect(promisedSlots(text) > 0, `${level}→${level + 1} — «${text}»`).toBe(useful);
      if (!useful) {
        expect(text).toMatch(/новые места ничего не дадут/);
        empty++;
      }
    }
    expect(empty, 'потолок служителей упирается раньше последнего уровня').toBeGreaterThan(0);
  });

  it('зима и осада кнопку не меняют: уровень переживает и то, и другое', () => {
    const spring = village('catholic');
    const winter = clone(spring);
    winter.time = SEASON_SECONDS * 3 + 1;
    const siege = clone(spring);
    siege.siege = { byName: 'Логово', until: siege.time + 600 };
    expect(SIEGE_YIELD).toBeLessThan(1);
    for (const def of BUILDINGS.filter((d) => d.jobs?.length && d.outside)) {
      if (buildingOfType(spring, def.id)!.level >= maxLevelFor(def.id)) continue;
      const at = (st: GameState): string => {
        const b = buildingOfType(st, def.id)!;
        return upgradeGain(st, b, b.level + 1);
      };
      // Ферма зимой не родит вовсе, но уровень, взятый в декабре, в мае даст больше.
      expect(at(winter), `${def.id} зимой`).toBe(at(spring));
      expect(at(siege), `${def.id} в осаду`).toBe(at(spring));
    }
  });
});
