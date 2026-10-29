// Входы прибора `roam:report` (ПН-0ч, docs/gdd/path_of_sword.md, раздел 11): всё, чего у Пути меча ещё нет в коде игры.
//
// Режима в коде нет, а мерить его надо уже сейчас (ГДД 7.1, ПН-0). Поэтому числа, которых нет в коде, приходят в прибор
// **входами** двух родов, и у каждого входа названо, откуда он и какая пачка заменит его дверью кода:
//   — **правило** (`rule`): формула или условие ГДД, не помеченное как ориентир (цена повышения 3.4.2, эталоны тира 4.3,
//     «3–5 заходов в день» 2.4). Число из него — следствие правила на числах кода, но не замер игры: двери ещё нет;
//   — **заглушка** (`stub`): ориентир ГДД (`[ориентир]`) или число прибора, которого в ГДД нет вовсе (`orient: false`).
//     Раздел, прочитавший хоть одну заглушку, печатается «НЕ ИЗМЕРЕНО», и выдать его за выведенный нельзя: читать вход раздел
//     может только тем, что объявил (`Section.uses`, проверка — `run.ts`), а сам этот модуль читает только исполнитель
//     (`run.ts`) — разделы и модель берут отсюда одни типы (держит тест по исходникам, `roam.test.ts`).
//
// Ни одно число отсюда не идёт в код игры (ГДД, «Как читать числа»): `src/` этот модуль не читает, и это тоже тест.
// Двери кода — то, что уже есть (жалованье, бой, путь, расселение, рынок), — входами не бывают: разделы зовут их прямо.
import { GOOD_BY_ID, MIN_MARKUP } from '../../src/game/data/market';
import { TROOP_BY_ID } from '../../src/game/data/troops';
import { selfCost } from '../../src/game/selfcost';
import type { EquipmentId, ResourceId, TroopId } from '../../src/game/types';
import type { TroopStack } from '../../src/game/battle/kinds';
import type { Gait } from '../../src/world/data/gait';
import type { Terrain } from '../../src/world/types';
import type { Camp, Mark, Origin } from './kinds';

export type InputKind = 'rule' | 'stub';

export interface Input<T = unknown> {
  kind: InputKind;
  /** Раздел ГДД, откуда вход. */
  gdd: string;
  /** Что это — словами, для шапки раздела. */
  what: string;
  /** Пачка, которая заменит вход дверью кода (ГДД 7.1). */
  batch: string;
  /** У заглушки: `true` — число — ориентир ГДД; `false` — число прибора, ориентира в ГДД нет. */
  orient?: boolean;
  value: T;
}

const rule = <T>(gdd: string, what: string, batch: string, value: T): Input<T> => ({ kind: 'rule', gdd, what, batch, value });
const stub = <T>(gdd: string, what: string, batch: string, value: T, orient = true): Input<T> => ({ kind: 'stub', gdd, what, batch, orient, value });

/** Цена повышения А → Б по правилу ГДД 3.4.2: разница снаряжения и припаса найма по основе цен рынка, без нажима. */
export function upgradePrice(from: TroopId, to: TroopId): number {
  const a = TROOP_BY_ID[from];
  const b = TROOP_BY_ID[to];
  let gold = 0;
  for (const [id, n] of Object.entries(b.gear) as [EquipmentId, number][]) {
    const more = Math.max(0, n - (a.gear[id] ?? 0));
    if (more > 0) gold += more * GOOD_BY_ID[`eq:${id}`].price;
  }
  for (const [id, n] of Object.entries(b.cost) as [ResourceId, number][]) {
    const more = Math.max(0, n - (a.cost[id] ?? 0));
    if (more > 0) gold += more * GOOD_BY_ID[id].price;
  }
  return gold;
}

/** Найм вида в городе по правилу ГДД 3.4.3: припас найма и снаряжение по основе цен рынка (у лорда — из своего склада). */
export function hirePrice(id: TroopId): number {
  const t = TROOP_BY_ID[id];
  let gold = 0;
  for (const [e, n] of Object.entries(t.gear) as [EquipmentId, number][]) gold += n * GOOD_BY_ID[`eq:${e}`].price;
  for (const [r, n] of Object.entries(t.cost) as [ResourceId, number][]) gold += n * GOOD_BY_ID[r].price;
  return gold;
}

/** Деревенская цена товара по правилу ГДД 3.3.4: своим трудом с наценкой рынка (`selfCost × MIN_MARKUP`), без нажима. */
export const villagePrice = (r: ResourceId): number => selfCost(GOOD_BY_ID[r]) * MIN_MARKUP;

export const INPUTS = {
  // ---------- правила ГДД (кода ещё нет) ----------
  // Заходы — поведение игрока, а не правило игры: двери у них не будет (ПН-1, «Решения ПН-1»). Между заходами отряд живёт
  // дверями ПН-1 — пайком, фуражом, содержанием и уходом.
  sessions: rule('2.4', 'заходов игрока в сутки — условие цели «медиана до замка»; двери не будет — это игрок', 'цель 2.4', {
    per: [3, 5] as const,
    wake: [8, 23] as const,
  }),
  etalons: rule(
    '4.3',
    'эталонные отряды тира: I — 8 копейщиков и 4 дубинщика, II — 12 копейщиков, 8 лучников, 6 топорников, 4 мечника, III — 70 человек составом автопилота',
    'ПН-7',
    {
      tiers: [
        { spearman: 8, clubman: 4 },
        { spearman: 12, archer: 8, axeman: 6, swordsman: 4 },
        { spearman: 28, archer: 21, legionary: 14, rider: 7 },
      ] as readonly TroopStack[],
    },
  ),
  contracts: rule('3.8.4', 'договоров разом — до 3', 'ПН-7', 3),
  upgrade: rule('3.4.2', 'цена повышения — разница снаряжения и припаса по основе цен рынка', 'ПН-6', upgradePrice),
  hire: rule('3.4.3', 'найм в городе — припас найма и снаряжение по ценам рынка; время учений не считается', 'ПН-6', hirePrice),
  village: rule('3.3.4', 'еда в селе — своим трудом с наценкой рынка (selfCost × MIN_MARKUP)', 'ПН-5', villagePrice),
  contractRule: rule('3.8.3', 'плата = содержание эталона × дни × K + мощь × LAIR_GOLD_PER_POWER × R; престиж = мощь / S + тир × 10', 'ПН-7', true),
  npcRule: rule(
    '3.6.2',
    'сила НПС = ровный бой эталонного отряда ступени / 1.1, неподвижной точкой; эталон ступени — отряд автопилота в минуту входа в ступень',
    'ПН-5',
    { edge: 1.1 },
  ),
  valueRule: rule(
    '4.5',
    'ценность = постройки (припас по selfCost + работа) + склад по selfCost + казна + мощь войска × цена мощи + очки × цена очка',
    'ПН-11',
    true,
  ),

  // ---------- заглушки: ориентиры ГДД и числа прибора ----------
  origins: stub('3.1', 'происхождения: отряд, золото, провиант, наём, добыча, торговля, ремесло, Военное дело героя', 'ПН-17', [
    {
      id: 'warrior',
      name: 'Воин',
      band: { spearman: 4, clubman: 2 },
      gold: 120,
      foodDays: 4,
      hire: 0.85,
      loot: 1.15,
      gear: 1,
      food: 1.05,
      war: 2,
    },
    {
      id: 'merchant',
      name: 'Купец',
      band: { spearman: 2, archer: 1 },
      gold: 260,
      foodDays: 6,
      hire: 1,
      loot: 1,
      gear: 1,
      food: 0.9,
      war: 1,
    },
    {
      id: 'craftsman',
      name: 'Мастер',
      band: { axeman: 3 },
      gold: 150,
      foodDays: 4,
      hire: 1,
      loot: 1,
      gear: 0.8,
      food: 1,
      war: 1,
    },
    {
      id: 'taken',
      name: 'Уведённый',
      band: { clubman: 5, archer: 1 },
      gold: 60,
      foodDays: 3,
      hire: 0.75,
      loot: 1.15,
      gear: 1,
      food: 1,
      war: 2,
    },
  ] as readonly Origin[]),
  stages: stub('3.9.1', 'ступени престижа: 0, 50, 150, 400, 1000', 'ПН-2', [0, 50, 150, 400, 1000] as readonly number[]),
  stageTier: stub('3.9.1', 'высший тир договоров по ступени: I до «Известного», II с него, III с «Грозного»', 'ПН-2', [1, 1, 2, 3, 3] as readonly number[]),
  board: stub('3.8.1', 'договоров на доске за заход', 'ПН-7', 5, false),
  prestigeS: stub('3.8.3', 'делитель мощи в престиже договора S', 'ПН-7', 4, false),
  contractK: stub('4.3', 'множитель вида договора K', 'ПН-7', 1.6),
  contractR: stub('3.8.3', 'доля риска R в плате договора', 'ПН-7', 1, false),
  contractTerm: stub('3.8.2', 'срок договора «сжечь логово» — путь × 2 + 4 игр. дн.', 'ПН-7', { roads: 2, days: 4 }),
  foodGold: stub('4.3', 'еда в содержании эталона — по 3 золота', 'ПН-7', 3),
  marks: stub(
    '3.6.2',
    'доля вида цели в силе противника и спелость',
    'ПН-5',
    {
      share: { lair: 1, band: 0.7, militia: 0.5 } as Record<Mark, number>,
      ripe: [0.6, 1] as const,
    },
    false,
  ),
  reach: stub('3.5.6', 'клеток до дела и до вольного замка', 'ПН-3', { deed: [5, 25] as const, castle: [15, 40] as const }, false),
  recruits: stub('3.4.1', 'весть «Просятся в отряд»: сколько по ступени престижа, как часто, множитель лагеря', 'ПН-6', {
    per: [
      [2, 4],
      [4, 7],
      [6, 10],
      [9, 15],
      [12, 20],
    ] as readonly (readonly [number, number])[],
    every: [6, 10] as const,
    camp: { open: 1.5, hidden: 0.5, ruin: 0.8 } as Record<Camp, number>,
  }),
  // Фураж сезона — дверь ПН-1 (`roamrules.forageShare`: поле сезона из `SEASON_MODIFIERS`); вид лагеря — ориентир ПН-3.
  forage: stub('3.5.3', 'фураж по виду лагеря: открытый — полный, скрытый ×0.5, в руинах ×0.8 (сезон — дверь ПН-1)', 'ПН-3', {
    open: 1,
    hidden: 0.5,
    ruin: 0.8,
  } as Record<Camp, number>),
  foodMix: stub('3.3.4', 'откуда бродяга берёт еду сверх фуража: доля села, остальное — рынок города', 'ПН-5', 0.7, false),
  defeat: stub('3.6.4', 'поражение: кошель перебитого — 50 % победителю; престиж проигравшего −10 %', 'ПН-5', { purse: 0.5, prestige: 0.1 }),
  castleTiers: stub('3.11.1', 'ступени вольных замков: гарнизон — строка таблицы у ворот уровня 2, 4, 6; население; доступ по престижу', 'ПН-10', [
    { name: 'Усадьба с башней', level: 2, pop: 30, prestige: 150 },
    { name: 'Замок кастеляна', level: 4, pop: 45, prestige: 400 },
    { name: 'Баронская крепость', level: 6, pop: 70, prestige: 1000 },
  ] as const),
  seat: stub('3.11.1', 'посёлок вольного замка I при взятии: всё 1-го уровня, частокол и башня 2-го; склад — стартовый; казна — замка', 'ПН-11', {
    levels: { palisade: 2, tower: 2 } as const,
  }),
  valuePrices: stub('4.5', 'цены ценности города: работа строителя, мощь войска, очко правителя (золото)', 'ПН-11', { work: 1, power: 10, point: 5 }, false),
  pool: stub('6.4', 'пул вольных замков: max(базовый, ceil(бродяг × 0.5)); базовый', 'ПН-10', { share: 0.5, base: 4 }),
  spawnGap: stub('3.5.6', 'место выхода бродяги — не ближе 25 клеток к замкам игроков', 'ПН-17', 25),
  camps: stub('3.5.3', 'заметность лагеря: открытый ×1.3, скрытый ×0.7, в руинах ×0.3', 'ПН-4у', { open: 1.3, hidden: 0.7, ruin: 0.3 } as Record<Camp, number>),
  sight: stub('3.5.4', 'заметность: местность, в пути ×1.5, размер (люди/20)^0.5 не ниже 0.5, ночь 0.7, режим марша; обзор отряда 8, следопыт ×1.5', 'ПН-4у', {
    terrain: {
      forest: 0.5,
      hills: 0.7,
      mountains: 0.7,
      plain: 1,
      steppe: 1,
      desert: 1.2,
      water: 1,
    } as Record<Terrain, number>,
    size: { per: 20, pow: 0.5, floor: 0.5 },
    night: 0.7,
    gait: { light: 0.8, normal: 1, train: 1.3 } as Record<Gait, number>,
    march: 1.5,
    band: 8,
    tracker: 1.5,
  }),
  passing: stub('3.5.4', 'на каком расстоянии от лагеря проходит чужой отряд, клеток', 'ПН-4у', [0, 12] as const, false),
} satisfies Record<string, Input>;

export type InputId = keyof typeof INPUTS;
export type InputValue<K extends InputId> = (typeof INPUTS)[K]['value'];

/** Цели ГДД, с которыми прибор сравнивает выведенное. Сами в счёт не идут: раздел получает их только строкой (`Ctx.target`). */
export interface Target {
  gdd: string;
  what: string;
  lo?: number;
  hi?: number;
  unit: string;
}

export const TARGETS = {
  castleMedian: {
    gdd: '2.4',
    what: 'медиана до первого замка',
    lo: 4,
    hi: 6,
    unit: ' сут',
  },
  castleFastest: {
    gdd: '2.4',
    what: 'быстрейший разумный путь',
    lo: 2,
    unit: ' сут',
  },
  castleShare: {
    gdd: '2.4',
    what: 'доля дошедших за 14 суток (цель — телеметрия)',
    lo: 0.55,
    unit: '',
  },
  parity: {
    gdd: '4.5',
    what: 'паритет с НФТ-стартом',
    lo: -0.15,
    hi: 0.15,
    unit: '',
  },
  foodGold: {
    gdd: '4.3',
    what: 'еда в содержании эталона',
    lo: 3,
    hi: 3,
    unit: ' золота',
  },
} satisfies Record<string, Target>;

export type TargetId = keyof typeof TARGETS;
