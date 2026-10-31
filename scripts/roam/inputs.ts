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
  // До вольного замка — с ПН-3 дверями: место выхода (`world/roam.placeBand`) и путь отряда (`roamWalkMs`) до ближайшего замка пула.
  // До дела — с ПН-7 доской договоров (`world/dealboard`): дорога от города заказчика к цели.
  foodMix: stub('3.3.4', 'откуда бродяга берёт еду сверх фуража: доля села, остальное — рынок города', 'ПН-5', 0.7, false),
  seat: stub('3.11.1', 'посёлок вольного замка I при взятии: всё 1-го уровня, частокол и башня 2-го; склад — стартовый; казна — замка', 'ПН-11', {
    levels: { palisade: 2, tower: 2 } as const,
  }),
  valuePrices: stub('4.5', 'цены ценности города: работа строителя, мощь войска, очко правителя (золото)', 'ПН-11', { work: 1, power: 10, point: 5 }, false),
  // `world` — мир, на котором автопилот берёт дорогу до замка: бродяг и лордов на нём, пул — по правилу.
  // Пул — правилом игры (`freecastle.freePoolSize`, заглушка `castlePool`); здесь — только мир дороги автопилота.
  pool: stub('6.4', 'мир дороги автопилота — бродяг и лордов (пул на нём — правилом игры `freePoolSize`)', 'ПН-17', {
    world: { bands: 20, lords: 20 },
  }, false),

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
  // ПН-7: договоры НПС — доска, дальность, сроки, груз; плата и K, R — двери игры (`contractrules`, `data/contracts`).
  boardSize: fromGame('boardSize'),
  dealReach: fromGame('dealReach'),
  dealRoads: fromGame('dealRoads'),
  dealDays: fromGame('dealDays'),
  dealStand: fromGame('dealStand'),
  dealCargo: fromGame('dealCargo'),
  // ---------- заглушки игры ПН-10: вольные замки ----------
  castleLevel: fromGame('castleLevel'),
  castlePrestige: fromGame('castlePrestige'),
  castlePop: fromGame('castlePop'),
  castleWall: fromGame('castleWall'),
  castleTower: fromGame('castleTower'),
  castleHall: fromGame('castleHall'),
  castleShare: fromGame('castleShare'),
  castlePool: fromGame('castlePool'),
  // ---------- ПН-Э1: торговля между городами — размах специализации, заглушка игры ----------
  townSpec: fromGame('townSpec'),

  // ---------- ПН-Э1: пути 2.0 (ГДД 3.7.0, 4.4, 4.8) ----------
  // Масштаб — по мощи отряда (4.4): пороги тати, ватаги и отряда; выше — войско.
  scales: stub('4.4', 'масштабы пути по мощи отряда: тать ≤ 60, ватага ≤ 300, отряд ≤ 900, войско выше', 'ПН-Э2', [60, 300, 900] as readonly number[]),
  // Дела путей, которых в коде нет: раздел, что на них стоит, печатает «не измерено» с пачкой — до её кода. Значения нет — числа нет.
  theftDeeds: stub('3.7.8', 'дела кражи (стадо, двор, дом, кошель), шанс, поимка, скупщик — кода нет', 'ПН-В', null, false),
  raidDeeds: stub('3.7.2', 'набег на село, грабёж каравана, набег на земли лорда — кода нет', 'ПН-8в, ПН-Н', null, false),
  fortDeeds: stub('3.16.2', 'форт: стройка, содержание, тайник, выработка, осада форта — кода нет', 'ПН-Ф', null, false),
  mercDeeds: stub('3.17', 'наёмники и стража за алмазы: найм, предел, лимит, отдача — кода нет', 'ПН-М', null, false),
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
  // ---------- ГДД 2.0, 2.4 и 4.8 (ПН-Э1); прежние цели коридора (медиана 4–6 сут, ≥ 55 % за 14 сут, ВП3) сняты ----------
  pathPay: {
    gdd: '2.4',
    what: 'доход пути к содержанию на своём масштабе',
    lo: 1.2,
    unit: '×',
  },
  pathAlive: {
    gdd: '2.4',
    what: 'доля партий без разорения',
    lo: 0.8,
    unit: '',
  },
  tradeMatch: {
    gdd: '3.7.1',
    what: 'доход торговца к доходу договоров того же масштаба',
    lo: 0.8,
    hi: 1.25,
    unit: '×',
  },
  castleMedian: {
    gdd: '2.4',
    what: 'медиана до первого замка у стиля «к замку»',
    lo: 21,
    hi: 42,
    unit: ' сут',
  },
  castleShare14: {
    gdd: '2.4',
    what: 'доля дошедших за 14 суток',
    hi: 0.15,
    unit: '',
  },
  castleShare42: {
    gdd: '2.4',
    what: 'доля дошедших за 42 суток у стиля «к замку»',
    lo: 0.3,
    hi: 0.5,
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
