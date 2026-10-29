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
import { ROAM_STUBS, type RoamStubId } from '../../src/game/roamstubs';
import type { TroopStack } from '../../src/game/battle/kinds';
import type { Origin } from './kinds';

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

/**
 * Заглушка игры (`game/roamstubs`, ПН-3): число, которое ходу и лагерю нужно сейчас, а вывести нечем. Число одно — прибор берёт
 * его оттуда, а не пишет второй раз; двери пути читают его там же (`roamStub`), и раздел, прочитавший заглушку дверью, обязан
 * объявить её здесь (сторож чтений — `run.ts`).
 */
const fromGame = <K extends RoamStubId>(id: K): Input<(typeof ROAM_STUBS)[K]['value']> => {
  const g = ROAM_STUBS[id];
  return stub(g.gdd, g.what, g.batch, g.value, g.orient);
};

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
  stageTier: stub('3.9.1', 'высший тир договоров по ступени: I до «Известного», II с него, III с «Грозного»', 'ПН-7', [1, 1, 2, 3, 3] as readonly number[]),
  board: stub('3.8.1', 'договоров на доске за заход', 'ПН-7', 5, false),
  contractK: stub('4.3', 'множитель вида договора K', 'ПН-7', 1.6),
  contractR: stub('3.8.3', 'доля риска R в плате договора', 'ПН-7', 1, false),
  contractTerm: stub('3.8.2', 'срок договора «сжечь логово» — путь × 2 + 4 игр. дн.', 'ПН-7', { roads: 2, days: 4 }),
  foodGold: stub('4.3', 'еда в содержании эталона — по 3 золота', 'ПН-7', 3),
  // До вольного замка — с ПН-3 дверями: место выхода (`world/roam.placeBand`) и путь отряда (`roamWalkMs`) до ближайшего замка пула.
  // До дела — точки НПС (ПН-5): их на карте ещё нет, и дорога до дела — путь отряда той же дверью на брошенное расстояние.
  reach: stub('3.6.2', 'клеток до дела — точки НПС на карте придут с ПН-5', 'ПН-5', { deed: [5, 25] as const }, false),
  foodMix: stub('3.3.4', 'откуда бродяга берёт еду сверх фуража: доля села, остальное — рынок города', 'ПН-5', 0.7, false),
  castleTiers: stub('3.11.1', 'ступени вольных замков: гарнизон — строка таблицы у ворот уровня 2, 4, 6; население; доступ по престижу', 'ПН-10', [
    { name: 'Усадьба с башней', level: 2, pop: 30, prestige: 150 },
    { name: 'Замок кастеляна', level: 4, pop: 45, prestige: 400 },
    { name: 'Баронская крепость', level: 6, pop: 70, prestige: 1000 },
  ] as const),
  seat: stub('3.11.1', 'посёлок вольного замка I при взятии: всё 1-го уровня, частокол и башня 2-го; склад — стартовый; казна — замка', 'ПН-11', {
    levels: { palisade: 2, tower: 2 } as const,
  }),
  valuePrices: stub('4.5', 'цены ценности города: работа строителя, мощь войска, очко правителя (золото)', 'ПН-11', { work: 1, power: 10, point: 5 }, false),
  // `world` — мир, на котором автопилот берёт дорогу до замка: бродяг и лордов на нём, пул — по правилу.
  pool: stub('6.4', 'пул вольных замков: max(базовый, ceil(бродяг × 0.5)); базовый; мир дороги автопилота — бродяг и лордов', 'ПН-10', {
    share: 0.5,
    base: 4,
    world: { bands: 20, lords: 20 },
  }),

  // ---------- заглушки игры (ПН-3): числа хода и лагеря, которые двери пути читают сейчас ----------
  spawnGap: fromGame('spawnGap'),
  forageHidden: fromGame('forageHidden'),
  forageRuin: fromGame('forageRuin'),
  campMorale: fromGame('campMorale'),
  coldCamp: fromGame('coldCamp'),
  healOpen: fromGame('healOpen'),
  tracker: fromGame('tracker'),

  // ---------- заглушки игры (ПН-5): точки мира и встречи с НПС — двери пути читают их сейчас ----------
  // Пороги ступеней, сила НПС, доли видов и спелость, престиж победы и поражения — двери `world/roamfoes`, `sim/roamfight`; автопилот
  // берёт их теми же числами (одно число на игру и прибор).
  stages: fromGame('stages'),
  foeTable: fromGame('foeTable'),
  foeShare: fromGame('foeShare'),
  foeRipe: fromGame('foeRipe'),
  prestigeS: fromGame('prestigeS'),
  defeatPurse: fromGame('defeatPurse'),
  defeatPrestige: fromGame('defeatPrestige'),
  heirPrestige: fromGame('heirPrestige'),
  heroFall: fromGame('heroFall'),
  bandWound: fromGame('bandWound'),
  ambushBase: fromGame('ambushBase'),
  ambushCap: fromGame('ambushCap'),
  townBlock: fromGame('townBlock'),
  townTier: fromGame('townTier'),
  villageBlock: fromGame('villageBlock'),
  vatagaBlock: fromGame('vatagaBlock'),
  // ПН-6: люди и город — заглушки игры тем же числом.
  askBase: fromGame('askBase'),
  askCamp: fromGame('askCamp'),
  askWinter: fromGame('askWinter'),
  askSpirit: fromGame('askSpirit'),
  askFeed: fromGame('askFeed'),
  captiveShare: fromGame('captiveShare'),
  boardFee: fromGame('boardFee'),
  townMarket: fromGame('townMarket'),
  townYard: fromGame('townYard'),
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
