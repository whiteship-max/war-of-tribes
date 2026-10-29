// Ход и лагерь отряда бродяги (ПН-3, docs/gdd/path_of_sword.md, 3.5.1–3.5.3, 3.5.6 и «Решения ПН-3») — одна дверь на клиент
// (мир бродяги `world/local/RoamWorld`, окно хода карты) и на сервер (реестр, `netlify/lib/roster.ts`): правило, по которому
// клиент показал ход, и правило, по которому сервер его принял, — одна функция, и разойтись им нечем.
//
// ХОД. У отряда бродяги свободная ходьба (решение П1): «Идти сюда» — в любую клетку суши; вода, русло, гребень хребта и
// клетка за краем региона (П3: все играют в одном) — отказ словами (`roamPlan`). Путь — та же дорога, что у похода войны
// (`pvp.warWalkMs`: `geo.travelTime` по общей земле, скорость полководца в режиме марша `generalSpeed`), энергия — дверь
// `world/energy` (дорога уходит по дням пути в темпе режима, стоянка даром, в лагере копится, как в осадном).
//
// ПОЛОЖЕНИЕ — ЧИСТАЯ ФУНКЦИЯ «откуда, куда, когда вышел» (`roamWhere`): тика нет, офлайн равен онлайну, и сервер выводит
// положение сам, без опроса. Ход лежит записью `RoamMove` — в партии (`GameState.roam`: `way`, `camp`, `energy`) и строкой
// отряда в реестре сервера (`BandRow`); пишет её одна дверь партии (`sim/roam.setMove`) и обработчик реестра.
//
// РЕЖИМ МАРША — ОДНО МЕСТО ПРАВДЫ: поле хода `RoamWay.gait` (решение ПН-3). Стоящий отряд выбирает режим нового хода даром — его
// стоянка и есть «дом», где обоз разгружают и собирают; идущий меняет его, как полководец в поле: стоянкой и ценой
// (`gait.gaitHaltMs`, `ENERGY_PRICE.gait`).
//
// ЛАГЕРЬ трёх видов — где угодно на суше (`roamCamp`); в руинах — только у руин на карте и не больше их вместимости
// (`world/ruins`). Рогатки — та же формула прохода, что у осадного лагеря (`works.throughWorks`), древесина лагеря игрока целиком
// в поле (`BAND_WOOD`): города у лагеря бродяги нет, и с какой стороны придут, не знает никто. Что вид лагеря даёт (фураж, дух,
// раненые), считают двери партии (`roamrules.forageShare`, `sim/spirit`, `sim/infirmary`); заметность — ПН-4у, не здесь.
//
// МЕСТО ВЫХОДА нового отряда (`placeBand`) считает сервер: у руин или опушки, не ближе заглушки `spawnGap` к замкам игроков и к
// другим новичкам; мир бродяги не строится, пока сервер не назвал клетку (`net/roster`).
//
// Модуль чистый: часов не читает, время приходит доводом. Читают его только двери пути — за `ROAM_ON`.
import type { Coord } from './types';
import type { Stack } from '../battle/types';
import { warWalkMs } from './pvp';
import { MEET_SLACK_MS } from './pvpmeet';
import { gaitField, gaitHaltMs, gaitSpeed, readGait, GAITS, type Gait } from './gait';
import { ENERGY_PRICE } from './data/energy';
import { energyAt, freshMark, onRoad, remark, roadCost, spend, walkBlock } from './energy';
import { terrainAt } from './geography';
import { hasRidge, hasRiver, inWorldCell, isWaterAt, type Spot } from './land';
import { fitToSettle, placeCastle } from './settle';
import { beyondNote, inTheatre, theatreAt } from './theatre/theatre';
import { ruinAt } from './ruins';
import { sideWorks, throughWorks, type Through, type WoodPlan } from './works';
import { PLAYER_CAMP_WOOD, SETTLE_GAP, SETTLE_REACH, SETTLE_TRIES } from './data/tuning';
import { realTime } from '../game/pace';
import { roamStub } from '../game/roamstubs';
import { CAMP_KINDS, wayGait, type CampKind, type RoamCampRec, type RoamMove, type RoamWay } from './roammove';

export { CAMP_KINDS, wayGait, readMove, type CampKind, type RoamCampRec, type RoamMove, type RoamWay } from './roammove';

/** Вид лагеря словами — для окна, отказов и летописи. */
export const CAMP_NAME: Readonly<Record<CampKind, string>> = {
  open: 'Открытый лагерь',
  hidden: 'Скрытый лагерь',
  ruin: 'Лагерь в руинах',
};

/**
 * Сколько идти отряду из `from` в `to` в режиме `g`, мс мира: та же дорога, что у похода войны (`pvp.warWalkMs`: общая земля
 * `WAR_GROUND_SEED`, `geo.travelTime`, скорость полководца в режиме марша). Своей формулы пути у бродяги нет.
 */
export const roamWalkMs = (from: Spot, to: Spot, g?: Gait): number => warWalkMs(from, to, g);

/** Где отряд в минуту `now`: доля пройденного между `from` и `to`; до выхода (стоянка смены режима) — в `from`. */
export function roamWhere(way: RoamWay, now: number): Coord {
  const span = Math.max(1, way.until - way.at);
  const t = Math.min(1, Math.max(0, (now - way.at) / span));
  return { x: way.from.x + (way.to.x - way.from.x) * t, y: way.from.y + (way.to.y - way.from.y) * t };
}

/** Клетка отряда в минуту `now`. */
export const roamCell = (way: RoamWay, now: number): Spot => {
  const at = roamWhere(way, now);
  return { x: Math.round(at.x), y: Math.round(at.y) };
};

const sameCell = (a: Spot, b: Spot): boolean => a.x === b.x && a.y === b.y;

/** Идёт ли отряд в минуту `now`. */
export const roamMoving = (way: RoamWay, now: number): boolean => now < way.until && !sameCell(way.from, way.to);

/** Что под ногами не даёт встать: край мира, вода, русло, гребень. Суша — `null`. */
function groundWhy(at: Spot): 'edge' | 'water' | 'river' | 'ridge' | null {
  if (!inWorldCell(at.x, at.y)) return 'edge';
  if (isWaterAt(at.x, at.y)) return 'water';
  if (hasRiver(at.x, at.y)) return 'river';
  if (hasRidge(at.x, at.y)) return 'ridge';
  return null;
}

const GO_WORDS: Readonly<Record<'edge' | 'water' | 'river' | 'ridge', string>> = {
  edge: 'За краем мира земли нет.',
  water: 'Туда не пройти: там вода. Идут в клетку суши.',
  river: 'В русле реки не встать — выбери берег.',
  ridge: 'На гребне хребта не встать — выбери склон.',
};

const CAMP_WORDS: Readonly<Record<'edge' | 'water' | 'river' | 'ridge', string>> = {
  edge: 'За краем мира лагерь не поставить.',
  water: 'Здесь лагерь не поставить: вода под ногами. Дойди до суши.',
  river: 'В русле реки лагерь не поставить — дойди до берега.',
  ridge: 'На гребне хребта лагерь не поставить — спустись на склон.',
};

/** Можно ли идти в клетку: суша — `null`, иначе отказ словами. */
export function roamCellBlock(to: Spot): string | null {
  const why = groundWhy(to);
  return why ? GO_WORDS[why] : null;
}

/** Цель в том же регионе, что отряд (П3: все играют в одном; переход края — позже), иначе — слова мира о крае. */
export const roamRegionBlock = (from: Spot, to: Spot): string | null => (inTheatre(theatreAt(from.x, from.y), to.x, to.y) ? null : beyondNote(from));

/** Один режим марша в окне хода: срок, стоянка смены режима, что съест дорога и что останется. */
export interface RoamLeg {
  gait: Gait;
  /** Дорога, мс мира. */
  walkMs: number;
  /** Когда выйдет: идущий, сменив режим, сначала стоит (`gait.gaitHaltMs`). */
  start: number;
  until: number;
  /** Цена смены режима в пути; стоящему — ноль. */
  price: number;
  /** Энергия дороги. */
  road: number;
  /** Сколько энергии останется к приходу, дробью (может быть ниже нуля — тогда `block`). */
  left: number;
  block: string | null;
}

/** Окно хода: откуда, куда, отказ клетки и три режима марша. */
export interface RoamPlan {
  from: Spot;
  to: Spot;
  block: string | null;
  legs: RoamLeg[];
}

/** Стоянка перед ходом в режиме `g`: идущий меняет режим стоянкой, стоящий — даром. */
const haltFor = (m: RoamMove, g: Gait, now: number): number => (roamMoving(m.way, now) && wayGait(m.way) !== g ? gaitHaltMs() : 0);

/** Ход в `to` до приказа — теми же функциями, что исполнят приказ (`roamGo`). */
export function roamPlan(m: RoamMove, to: Spot, now: number): RoamPlan {
  const from = roamCell(m.way, now);
  const target = { x: Math.round(to.x), y: Math.round(to.y) };
  const here = sameCell(from, target) && !roamMoving(m.way, now);
  const block = roamCellBlock(target) ?? roamRegionBlock(from, target) ?? (here ? 'Отряд уже здесь.' : null);
  const have = energyAt(m.energy, now);
  const legs = GAITS.map((g): RoamLeg => {
    const halt = haltFor(m, g, now);
    const price = halt > 0 ? ENERGY_PRICE.gait.price : 0;
    const walkMs = roamWalkMs(from, target, g);
    const rate = gaitSpeed(g);
    const road = roadCost(walkMs, rate);
    const start = now + halt;
    return { gait: g, walkMs, start, until: start + walkMs, price, road, left: have - road - price, block: walkBlock(have, price, walkMs, rate) };
  });
  return { from, to: target, block, legs };
}

/** Приказ «Идти сюда»: новая запись хода или отказ словами. Лагерь снимается, энергия уходит дорогой в темпе режима. */
export function roamGo(m: RoamMove, to: Spot, gait: Gait, now: number): RoamMove | string {
  const plan = roamPlan(m, to, now);
  if (plan.block) return plan.block;
  const g = readGait(gait);
  const leg = plan.legs.find((l) => l.gait === g) as RoamLeg;
  if (leg.block) return leg.block;
  const paid = leg.price > 0 ? spend(m.energy, now, leg.price) : m.energy;
  // Стоянка смены режима: до выхода энергия стоит.
  const held = leg.start > now ? remark(paid, now, 'hold') : paid;
  return {
    way: { from: plan.from, to: plan.to, at: leg.start, until: leg.until, ...gaitField(g) },
    camp: null,
    energy: onRoad(held, leg.start, leg.until, false, gaitSpeed(g)),
  };
}

/**
 * «Встать лагерем» вида `kind` (или снять лагерь — `null`) в минуту `now`: идущий встаёт там, где застал приказ. `men` — бойцов
 * строя: они ставят рогатки и должны поместиться в руинах. Сменить вид на той же стоянке — погасить или развести костры, уйти
 * в руины той же клетки: рогатки стоят, кто их ставил — те же. В лагере энергия копится, как в осадном (`ENERGY_CAMP`).
 */
export function roamCamp(m: RoamMove, kind: CampKind | null, men: number, now: number): RoamMove | string {
  if (kind === null) {
    if (!m.camp) return 'Лагеря нет: отряд и так стоит в поле.';
    return { way: m.way, camp: null, energy: remark(m.energy, now, 'hold') };
  }
  if (!CAMP_KINDS.includes(kind)) return 'Такого лагеря нет.';
  const here = roamCell(m.way, now);
  const why = groundWhy(here);
  if (why) return CAMP_WORDS[why];
  if (kind === 'ruin') {
    const ruin = ruinAt(here.x, here.y);
    if (!ruin) return 'Здесь нет руин: в руинах встают у руин на карте.';
    if (men > ruin.cap) return `В руинах помещается до ${ruin.cap} человек, а в отряде ${men}.`;
  }
  if (m.camp?.kind === kind) return 'Отряд уже стоит этим лагерем.';
  const moving = roamMoving(m.way, now);
  const way: RoamWay = moving ? { from: here, to: here, at: now, until: now, ...gaitField(wayGait(m.way)) } : m.way;
  const camp: RoamCampRec = m.camp && !moving ? { ...m.camp, kind } : { kind, since: now, builders: Math.max(0, Math.floor(men)) };
  return { way, camp, energy: remark(m.energy, now, 'camp') };
}

/**
 * Древесина лагеря бродяги: вся — в поле. Рубят тем же темпом, что лагерь игрока под городом (`PLAYER_CAMP_WOOD`), — те же
 * люди и тот же лес; фронта к городу нет, и рогатки ставят на одну сторону.
 */
export const BAND_WOOD: WoodPlan = { front: 0, rear: PLAYER_CAMP_WOOD };

/** Насколько достроены рогатки лагеря к минуте `at`, 0..1 — той же `works.sideWorks`, что у осадного. */
export const campWorks = (c: RoamCampRec, at: number): number => sideWorks(c.since, at, 'rear', BAND_WOOD);

/**
 * Кто из нападающих `going` пробьётся к рогаткам лагеря в минуту `at` — той же `works.throughWorks`, что у осадного лагеря
 * (бой у лагеря бродяги — ПН-5; у охоты игроков — ПН-13). `gateAt` — отметка прохода, её пишет бой.
 */
export const campThrough = (c: RoamCampRec, at: number, going: Stack, gateAt?: number): Through =>
  throughWorks('rear', c.builders, c.since, at, going, gateAt, BAND_WOOD);

/** Запись хода нового отряда: стоит на клетке выхода, полный запас энергии, лагеря нет. */
export const roamSeat = (at: Spot, now: number): RoamMove => ({
  way: { from: { x: at.x, y: at.y }, to: { x: at.x, y: at.y }, at: now, until: now },
  camp: null,
  energy: freshMark(now, 'hold'),
});

/**
 * Новичок — отряд, чьё место выхода сервер назвал меньше 48 настоящих часов назад (решение С5, ГДД 3.5.8): от него держит
 * расстояние место выхода следующего.
 */
export const NEWCOMER_MS = realTime(48 * 3_600_000);

export const isNewcomer = (born: number, now: number): boolean => now - born < NEWCOMER_MS;

/**
 * Насколько запаздывает приказ отряда (сеть и палец между окном и сервером) — то же запаздывание, что у встречи ПЛ-1
 * (`pvpmeet.MEET_SLACK_MS`): срок прихода, названный клиентом, раньше выведенного сервером на большее — невозможное.
 */
export const ROAM_SLACK_MS = MEET_SLACK_MS;

/** Срок прихода, названный приказом, раньше выведенного дальше запаздывания приказа: так честный клиент не считает. */
export const untilForged = (claimed: number, until: number): boolean => Number.isFinite(claimed) && claimed + ROAM_SLACK_MS < until;

/**
 * Отказ по энергии, которого честный клиент не получил бы: сил не хватает даже на минуту раньше приказа (дорога тает, лагерь
 * копит — берётся больший запас из двух минут). Иначе отказ — от запаздывания приказа, а не подделка.
 */
export function energyForged(m: RoamMove, to: Spot, gait: Gait, now: number): boolean {
  const best = Math.max(energyAt(m.energy, now), energyAt(m.energy, now - ROAM_SLACK_MS));
  const plan = roamPlan({ ...m, energy: { value: best, at: now, mode: 'hold' } }, to, now);
  return plan.block === null && plan.legs.some((l) => l.gait === readGait(gait) && l.block !== null);
}

/** Опушка — клетка леса, у которой сбоку земля без леса (не вода): лес прикрывает, поле кормит. */
export function forestEdge(x: number, y: number): boolean {
  if (terrainAt(0, x, y) !== 'forest') return false;
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    const t = terrainAt(0, x + dx, y + dy);
    if (t !== 'forest' && t !== 'water') return true;
  }
  return false;
}

/** Укрытие для места выхода: руины или опушка (ГДД 3.5.6). */
export const shelterAt = (at: Spot): boolean => ruinAt(at.x, at.y) !== null || forestEdge(at.x, at.y);

/**
 * Как далеко от брошенной точки искать укрытие: половина зазора замков — тот же шаг, которым обходит землю расселение
 * (`settle.spiral`): мельче незачем, крупнее — точка уходит от рамки, в которой её бросили.
 */
const SHELTER_LOOK = Math.max(2, Math.round(SETTLE_GAP / 2));

/** Клетки вокруг точки по возрастанию расстояния — один раз на радиус. */
const ringOrder = (r: number): [number, number][] => {
  const out: [number, number][] = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) out.push([dx, dy]);
  return out.sort((a, b) => a[0] * a[0] + a[1] * a[1] - (b[0] * b[0] + b[1] * b[1]) || a[1] - b[1] || a[0] - b[0]);
};

/**
 * Место выхода нового отряда бродяги (ГДД 3.5.6): у руин или опушки, на земле, где может стоять замок (`settle.fitToSettle`:
 * не пустыня, не клочок суши), не ближе заглушки `spawnGap` к замкам игроков и к другим новичкам. Точку бросают так же, как
 * расселение замка: вокруг стоящего замка (а нет замков — вокруг новичка) между зазором и дальней границей (`SETTLE_REACH`) —
 * отряд обязан мочь дойти до соседей; укрытие ищут рядом с точкой. Не нашлось — правило замка (`settle.placeCastle`) с теми же
 * соседями: место без укрытия лучше, чем никакого. `rng` — из ключа игрока (`settle.settleRandom`): повтор ищет теми же бросками.
 */
export function placeBand(rng: () => number, castles: readonly Spot[], newcomers: readonly Spot[], within?: (at: Spot) => boolean): Spot {
  const gap = roamStub('spawnGap');
  const others = [...castles, ...newcomers];
  const far = (at: Spot): boolean => others.every((o) => Math.hypot(o.x - at.x, o.y - at.y) >= gap);
  const ok = (at: Spot): boolean => shelterAt(at) && far(at) && (!within || within(at)) && fitToSettle(at);
  // Порядок списка — не факт о мире (`settle.placeCastle`): якоря сортируются по клеткам.
  const byCell = (a: Spot, b: Spot): number => a.x - b.x || a.y - b.y;
  const anchors = castles.length > 0 ? [...castles].sort(byCell) : [...newcomers].sort(byCell);
  const look = ringOrder(SHELTER_LOOK);
  for (let tries = 0; tries < SETTLE_TRIES; tries++) {
    let at: Spot;
    if (anchors.length === 0) {
      at = placeCastle(rng, [], within);
    } else {
      const anchor = anchors[Math.min(anchors.length - 1, Math.floor(rng() * anchors.length))];
      const a = rng() * Math.PI * 2;
      const r = gap + rng() * Math.max(0, SETTLE_REACH - gap);
      at = { x: Math.round(anchor.x + Math.cos(a) * r), y: Math.round(anchor.y + Math.sin(a) * r) };
    }
    for (const [dx, dy] of look) {
      const c = { x: at.x + dx, y: at.y + dy };
      if (ok(c)) return c;
    }
  }
  return placeCastle(rng, others, within);
}
