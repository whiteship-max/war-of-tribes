// Обстрел перед штурмом в ролике TW (docs/battle_tw.md, раздел 15) — чистая режиссура пролога, без three.
//
// Обстрел у ядра — не бой, а число: пролом снимает долю ополчения со стены (`world/siegecraft.wallMen`), залп продвигает
// часы осады для духа гарнизона. Запись боя несёт, сколько залпов легло перед штурмом (`BattleRecord.shots`), а зовущий
// ролик переводит их в долю пробитой стены после каждого залпа дверью ядра (`siegecraft.breachOf`): мира ролик не читает
// (тест «показ не считает бой»), и второй таблицы пролома у него нет. Пролог идёт со своими часами — до первой секунды боя. Бой в прологе стоит на секунде 0 (строи построены), и
// ни одно число боя от пролога не зависит: кто где стоит и когда падает — по-прежнему `plan.ts` (тест `barrage.test.ts`).
//
// Что видно — выводится из того же, что считает ядро:
//  - машины у лагеря — по одной на залп (требушет и катапульты), расчёты заряжают и крутят ворот;
//  - камни летят дугой: пристрелочный круг (недолёт, перелёт в город, удар в кладку), потом по кругу на залп — последний
//    камень круга обрушивает кусок стены, и пролом растёт залпами теми же долями, что у ядра (`breachOf`);
//  - со стены падают те, кого пролом снял, — их доля к оставшимся на стене та же, что у `wallMen`: b / (1 − b);
//  - перелёт в город поджигает дом — дым над городом стоит и в бою.
// У логова стены нет (`craftGain(…, walls: false)`): пролом ему ничего не стоит, и камни ложатся меж шалашей — дух, а не
// стена; шалаш, куда легло, дымит.
import type { Side } from '@/battle/types';
import type { Quality } from '../quality';
import { PARAPET, outOf, type TwWall } from './site';
import { hash, heightAt } from '../reel/terrain';
import type { TwPlan, TwUnit } from './plan';

/** Куда лёг камень: в кладку, недолёт, перелёт в город, в шалаш логова. */
export type StoneHit = 'wall' | 'short' | 'over' | 'hut';

export interface TwEngine {
  kind: 'trebuchet' | 'mangonel';
  x: number;
  z: number;
  y: number;
  /** Куда смотрит (метание — вперёд): +Z при нуле, как у фигур. */
  yaw: number;
  /** Секунды пролога, когда рычаг срывается. */
  shots: number[];
  /**
   * Ролик осады (`render/siege`): машина встаёт в эту секунду (готова по очереди машин лагеря) и пропадает в `gone` (сожгли
   * вылазкой). Нет — стоит весь ролик, как в прологе обстрела.
   */
  from?: number;
  gone?: number;
}

/** Стоит ли машина на секунде `t` (ролик осады: встала готовой, ещё не сгорела). */
export const engineUp = (e: TwEngine, t: number): boolean => (e.from === undefined || t >= e.from) && (e.gone === undefined || t < e.gone);

export interface TwStone {
  engine: number;
  /** Срыв и сколько летит. */
  at: number;
  flight: number;
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
  /** Высота дуги над прямой. */
  lift: number;
  hit: StoneHit;
  /** Какой кусок стены рушит удар этого камня; −1 — никакой. */
  chunk: number;
  seed: number;
}

/** Кусок стены, обрушенный залпом: пролёты по X (метры) и секунда обвала. */
export interface TwChunk {
  spans: [number, number][];
  at: number;
  /**
   * Пролом заделан (ролик осады, починка — docs/siege_v2.md, раздел 5): с этой секунды кусок встаёт на место за
   * `MEND_TIME`. Нет — лежит до конца ролика, как в прологе обстрела.
   */
  back?: number;
  /** Заделанный кусок рухнул снова (и, может быть, снова заделан): те же пролёты, следующие обвалы по порядку. */
  again?: { at: number; back?: number }[];
}

export interface TwBreach {
  /** Середина пролома по X, ширина целиком (после всех залпов), глубина в середине от верха стены вниз (метры). */
  x: number;
  width: number;
  depth: number;
  chunks: TwChunk[];
}

/** Сбитый со стены: стоит на ходу до обвала своего куска, летит наружу и лежит у подножия. */
export interface TwFaller {
  x: number;
  y: number;
  z: number;
  x1: number;
  y1: number;
  z1: number;
  at: number;
  yaw: number;
}

/** Расчёт машины: где стоит и с какой своей фазой работает. */
export interface TwCrew {
  engine: number;
  x: number;
  z: number;
  yaw: number;
  phase: number;
}

/** Дым: столб над тем, куда лёг перелёт, — с секунды удара и до конца ролика. */
export interface TwSmoke {
  x: number;
  y: number;
  z: number;
  from: number;
  size: number;
  /** Догорело (ролик осады: погребальный костёр, сожжённая машина): огонь гаснет с этой секунды, клубы уходят. Нет — горит до конца. */
  to?: number;
}

/** Ключ камеры пролога: прямоугольник, который держать в кадре, азимут и наклон. */
export interface TwCamKey {
  at: number;
  box: { minX: number; maxX: number; minZ: number; maxZ: number };
  yaw: number;
  pitch: number;
  /**
   * Камера на месте (ролик осады глазами защитника, П-6: со стены на лагерь): цель — середина прямоугольника, расстояние —
   * это, а не «вписать прямоугольник в экран». Нет — вписать.
   */
  dist?: number;
}

export type BarrageCueKind = 'engine' | 'stone' | 'impact' | 'collapse' | 'wallcry';

export interface BarrageCue {
  at: number;
  kind: BarrageCueKind;
  x: number;
  z: number;
  x2: number;
  z2: number;
  dur: number;
  size: number;
  seed: number;
}

export interface TwBarrage {
  /** Залпов перед штурмом — по записи боя. */
  shots: number;
  /** Доля пробитой стены после каждого залпа, нарастающим итогом (`siegecraft.breachOf`, считает зовущий). */
  shares: readonly number[];
  /** Длина пролога, секунды ролика. */
  seconds: number;
  /** Есть ли стена: штурм города — да, логово — нет. */
  walls: boolean;
  /** Чья сторона стреляет. */
  besieger: Side;
  engines: TwEngine[];
  stones: TwStone[];
  breach: TwBreach | null;
  fallers: TwFaller[];
  crew: TwCrew[];
  smoke: TwSmoke[];
  cam: TwCamKey[];
  cues: BarrageCue[];
  /** Фигуры-образцы для вида: расчёт — боец стреляющей стороны, сбитый — со стены. −1 — некого. */
  look: { crew: number; faller: number };
  /** Пыль без камня (ролик осады: подкоп обрушил кусок стены, ворота рухнули): где, когда и какой ширины. Нет — нет. */
  bursts?: { x: number; y: number; z: number; at: number; size: number }[];
}

/**
 * Опущенная полоса стены над проломом — от наружной грани внутрь, метры. Передняя шеренга защитников стоит на ходу в
 * `CONTACT_HALF` (0.42 м) от грани, и план боя от пролога не меняется: полоса у́же, чтобы никто не стоял над пустотой.
 * Пролом поэтому — сбитые зубцы, парапет и облицовка с осыпью у подножия, а не дыра насквозь; у ядра он и есть не дыра,
 * а доля стены, на которой больше не стоят (`wallMen`).
 */
export const BREACH_BAND = 0.26;
/** Ключи камеры пролога — не ближе этого друг к другу: переход между ними (`player.CAM_MOVE`) не рвётся. */
const CAM_GAP = 1.3;

/** Залпов в прологе, не больше. */
const MAX_SHOTS = 3;
/** Пролог: показ машин до первого срыва, круг залпа, разнос машин в круге, хвост после последнего удара. */
export const BARRAGE_INTRO = 2.4;
export const BARRAGE_ROUND = 2.9;
const STAGGER = 0.5;
const OUTRO = 2.6;
/** Полёт камня: секунды на месте и на метр пути. */
const FLIGHT = { base: 1.5, perM: 1 / 50 };
/** Ширина пролома на долю пробитой стены (метры): 20 % — 4 м, 35 % — 7 м. */
const BREACH_PER_SHARE = 20;
/** Машины встают за тылом стреляющих на столько метров и друг от друга на столько. */
const ENGINE_BACK = 9;
const ENGINE_GAP = 10;
/** Рычаг: взлёт после срыва и сколько до следующего срыва он ещё стоит взведённым (ворот — между ними). */
export const ARM_SWING = 0.45;
const ARM_READY = 0.7;
/** Сбитых со стены — не больше, по уровню. */
const FALLERS_MAX: Record<Quality, number> = { low: 3, medium: 8, high: 12 };
/** Расчёт машины по уровню: требушет, катапульта. */
const CREW: Record<Quality, { trebuchet: number; mangonel: number }> = {
  low: { trebuchet: 2, mangonel: 1 },
  medium: { trebuchet: 4, mangonel: 3 },
  high: { trebuchet: 5, mangonel: 3 },
};
/** Сбитый летит со стены столько секунд. */
export const FALL_TIME = 0.8;

const mounted = (u: TwUnit): boolean => u.kind === 'cavalry' || u.kind === 'heavy';
const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);

/** Доля пробитой стены после `n` залпов: ноль до первого, дальше — доли зовущего (`siegecraft.breachOf`). */
export const breachShare = (shares: readonly number[], n: number): number => (n <= 0 ? 0 : Math.min(1, shares[Math.min(n, shares.length) - 1]));

/** Ширина пролома после первых `n` залпов, метры. */
export const breachWidth = (shares: readonly number[], n: number, k = 1): number => breachShare(shares, n) * BREACH_PER_SHARE * k;

/**
 * Насколько опущена наружная половина стены над `x` (метры от верха, 0 — цела): клин пролома, глубже к середине, с
 * неровным краем по метру. После обвала всех кусков; до — целые куски закрывают это место (`siegeworks.ts`).
 */
export function breachDrop(br: TwBreach, x: number, seed: number): number {
  const half = br.width / 2;
  const d = Math.abs(x - br.x);
  if (d >= half) return 0;
  const shape = Math.pow(1 - d / half, 0.55);
  // Рваный край: соседние столбцы обрываются на разной высоте, а не ступенькой.
  const rag = 0.6 + 0.4 * hash(seed, Math.floor(x * 1.3) + 997, 71);
  return br.depth * shape * rag;
}

/** Взведён ли рычаг машины на секунде `t`: 0 — взведён, 1 — сорван и поднят. Между выстрелами — ворот тянет вниз. */
export function armAt(e: TwEngine, t: number): number {
  let last = -Infinity;
  let next = Infinity;
  for (const s of e.shots) {
    if (s <= t) last = s;
    else if (s < next) next = s;
  }
  if (last === -Infinity) return 0;
  const since = t - last;
  if (since < ARM_SWING) {
    const u = since / ARM_SWING;
    return 1 - (1 - u) * (1 - u);
  }
  // Ворот: от поднятого к взведённому до следующего срыва; после последнего — опускают к концу пролога и оставляют.
  const end = next === Infinity ? last + ARM_SWING + 2.6 : next - ARM_READY;
  const start = last + ARM_SWING + 0.25;
  if (t <= start) return 1;
  if (t >= end) return 0;
  return 1 - (t - start) / Math.max(0.1, end - start);
}

/** Крутят ли ворот на секунде `t` (расчёт работает), — для позы расчёта. */
export function winching(e: TwEngine, t: number): boolean {
  const a = armAt(e, t);
  return a > 0.01 && a < 0.99 && !e.shots.some((s) => t >= s && t < s + ARM_SWING + 0.25);
}

/** Где камень на секунде `t`; null — ещё не сорвался или уже лёг. */
export function stoneAt(s: TwStone, t: number, out: { x: number; y: number; z: number }): boolean {
  const u = (t - s.at) / s.flight;
  if (u < 0 || u > 1) return false;
  out.x = s.x0 + (s.x1 - s.x0) * u;
  out.z = s.z0 + (s.z1 - s.z0) * u;
  out.y = s.y0 + (s.y1 - s.y0) * u + 4 * s.lift * u * (1 - u);
  return true;
}

/** Заделанный кусок встаёт на место за столько секунд (ролик осады — починка пролома). */
export const MEND_TIME = 1.6;

/** Куда лёг кусок: обвал за `FALL_TIME * 0.8` — наружу и вниз; 0 — стоит, 1 — лёг. Заделан — встаёт обратно. */
export function chunkFall(c: TwChunk, t: number): number {
  let cycle: { at: number; back?: number } = c;
  for (const a of c.again ?? []) if (t >= a.at) cycle = a;
  const u = (t - cycle.at) / (FALL_TIME * 0.8);
  const down = u <= 0 ? 0 : u >= 1 ? 1 : u * u;
  if (cycle.back === undefined || t <= cycle.back) return down;
  const k = Math.min(1, (t - cycle.back) / MEND_TIME);
  return down * (1 - k * k * (3 - 2 * k));
}

/**
 * Машины, метры: ось рычага над землёй, длина длинного плеча, угол рычага взведённым и сорванным (от «вперёд» к «вверх»,
 * радианы). Требушет: плечо лежит назад к земле и перелетает через верх вперёд; катапульта: ложка оттянута назад и бьёт в
 * перекладину стоймя. Камень срывается с конца плеча в сорванном положении.
 */
export const ENGINE = {
  trebuchet: { pivot: 5.3, arm: 7.5, cocked: Math.PI + 0.73, fired: 1.25 },
  mangonel: { pivot: 1.15, arm: 3.6, cocked: Math.PI + 0.18, fired: Math.PI / 2 + 0.2 },
} as const;

/** Угол рычага машины на секунде пролога. */
export const armAngle = (e: TwEngine, t: number): number => {
  const g = ENGINE[e.kind];
  return g.cocked + (g.fired - g.cocked) * armAt(e, t);
};

/** Столбцы пролома по X: от и до, насколько опущена наружная половина. Одни и те же у стены и у её обрушенных кусков. */
export function breachColumns(br: TwBreach, seed: number): { x0: number; x1: number; drop: number }[] {
  const out: { x0: number; x1: number; drop: number }[] = [];
  const a = br.x - br.width / 2;
  const n = Math.max(3, Math.round(br.width / 0.8));
  const step = br.width / n;
  for (let i = 0; i < n; i++) {
    const x0 = a + i * step;
    out.push({ x0, x1: x0 + step, drop: breachDrop(br, x0 + step / 2, seed) });
  }
  return out;
}

interface Ctx {
  plan: TwPlan;
  seed: number;
  n: number;
  shares: readonly number[];
  /** Пролом ужат под самый длинный пролёт стены, если целиком не влезает ни в один (1 — влезает). */
  fit: number;
}

/** Первая фигура отряда — образец вида. */
const firstOf = (units: TwUnit[]): number => (units.length > 0 ? units[0].first : -1);

/**
 * Пролог обстрела по записи боя. Нет залпов или нет места, где ему быть (поле, ворота, вылазка), — null: ролик идёт как
 * раньше, с первой секунды боя.
 */
export function barrageOf(plan: TwPlan, shares: readonly number[] | undefined): TwBarrage | null {
  // Залпов у ядра не больше трёх (`craftMax('bombard')`); запись с большим — чужая, и пролог её не растягивает.
  const n = Math.min(MAX_SHOTS, shares?.length ?? 0);
  const site = plan.site;
  if (n === 0 || !site || !shares) return null;
  const ctx: Ctx = { plan, seed: plan.cast.seed, n, shares, fit: 1 };
  if (site.kind === 'wall' && site.wall) return wallBarrage(ctx, site.wall);
  if (site.kind === 'lair' && site.camp) return lairBarrage(ctx);
  return null;
}

/** Место машин: за тылом стреляющих по оси `dir` (к цели), рядом друг с другом, лицом к цели. */
function placeEngines(ctx: Ctx, besieger: TwUnit[], dir: 1 | -1, aimX: number, aimZ: number): TwEngine[] {
  const { plan, n } = ctx;
  const f = plan.field;
  let rear = Infinity;
  for (const u of besieger) rear = Math.min(rear, (u.z - dir * u.depth) * dir);
  if (!Number.isFinite(rear)) rear = -20;
  const z = clamp((rear - ENGINE_BACK) * dir, f.minZ + 5, f.maxZ - 5);
  // Требушет — посередине (у трёх) или первым; катапульты — по бокам.
  const treb = n === 3 ? 1 : 0;
  const out: TwEngine[] = [];
  for (let e = 0; e < n; e++) {
    const x = clamp(aimX * 0.5 + (e - (n - 1) / 2) * ENGINE_GAP, -f.halfX + 6, f.halfX - 6);
    const ez = z + (hash(ctx.seed, e, 61) - 0.5) * 3;
    out.push({ kind: e === treb ? 'trebuchet' : 'mangonel', x, z: ez, y: heightAt(f, x, ez), yaw: Math.atan2(aimX - x, aimZ - ez), shots: [] });
  }
  return out;
}

/** Расчёты: у требушета — у ворота сзади и у пращи, у катапульты — по бокам рамы. */
function crewOf(ctx: Ctx, engines: TwEngine[]): TwCrew[] {
  const per = CREW[ctx.plan.quality];
  const out: TwCrew[] = [];
  engines.forEach((e, ei) => {
    const k = e.kind === 'trebuchet' ? per.trebuchet : per.mangonel;
    const s = Math.sin(e.yaw);
    const c = Math.cos(e.yaw);
    for (let j = 0; j < k; j++) {
      // Места в осях машины: поперёк (a) и вдоль (b, назад — минус).
      const a = (j % 2 === 0 ? 1 : -1) * (e.kind === 'trebuchet' ? 2.1 : 1.6) + (hash(ctx.seed, ei * 7 + j, 62) - 0.5) * 0.4;
      const b = -1.4 - Math.floor(j / 2) * 1.3 + (hash(ctx.seed, ei * 7 + j, 63) - 0.5) * 0.4;
      // Лицом к машине, чуть вбок: тянут ворот.
      out.push({ engine: ei, x: e.x + c * a + s * b, z: e.z - s * a + c * b, yaw: e.yaw + (a > 0 ? -0.9 : 0.9), phase: hash(ctx.seed, ei * 7 + j, 64) });
    }
  });
  return out;
}

/** Срыв, полёт и дуга камня от машины к точке. */
function stone(ctx: Ctx, engines: TwEngine[], e: number, at: number, x1: number, y1: number, z1: number, hit: StoneHit, chunk: number): TwStone {
  const en = engines[e];
  const g = ENGINE[en.kind];
  const fwd = g.arm * Math.cos(g.fired);
  const x0 = en.x + Math.sin(en.yaw) * fwd;
  const z0 = en.z + Math.cos(en.yaw) * fwd;
  const y0 = en.y + g.pivot + g.arm * Math.sin(g.fired);
  const dist = Math.hypot(x1 - x0, z1 - z0);
  en.shots.push(at);
  // Требушет кидает навесом, катапульта — положе.
  const lift = dist * (en.kind === 'trebuchet' ? 0.32 : 0.2);
  return { engine: e, at, flight: FLIGHT.base + dist * FLIGHT.perM, x0, y0, z0, x1, y1, z1, lift, hit, chunk, seed: ctx.seed + e * 131 + Math.round(at * 10) };
}

/**
 * Что делает камень машины `e` в круге `r` при `n` машинах (у стены): пристрелочный круг — удар в кладку, недолёт и
 * перелёт в город; круги залпов — последний камень круга рушит кусок, остальные — в кладку рядом или перелётом.
 */
function wallHit(n: number, r: number, e: number): StoneHit | 'collapse' {
  if (n === 1) return r === 0 ? 'over' : 'collapse';
  if (r === 0) return e === 0 ? 'wall' : e === 1 ? 'short' : 'over';
  if (e === n - 1) return 'collapse';
  // Второй перелёт — в первом круге залпов: дым над городом есть у всякого обстрела.
  return r === 1 && e === (n === 2 ? 0 : 1) ? 'over' : 'wall';
}

/** Середина пролома: пролёт стены без лестниц, подальше от ворот и башен, поближе к середине. */
function breachX(ctx: Ctx, w: TwWall, width: number, ladders: number[]): number {
  const stops: [number, number][] = [[w.gateX - 3.2, w.gateX + 3.2]];
  for (const t of w.towers) stops.push([t.x - t.size / 2, t.x + t.size / 2]);
  let best = NaN;
  let bestScore = -Infinity;
  const half = width / 2 + 1;
  for (let x = -w.halfX + half + 2; x <= w.halfX - half - 2; x += 0.5) {
    if (stops.some(([a, b]) => x + half > a && x - half < b)) continue;
    const ladderClear = ladders.every((l) => Math.abs(l - x) > half + 0.8);
    const score = (ladderClear ? 100 : 0) - Math.abs(x) * 0.5 + hash(ctx.seed, Math.round(x * 2), 65) * 0.3;
    if (score > bestScore) {
      bestScore = score;
      best = x;
    }
  }
  if (!Number.isNaN(best)) return best;
  // Ни один пролёт не вмещает пролом целиком (стена коротка): середина самого длинного пролёта, и пролом ужат под него.
  stops.sort((a, b) => a[0] - b[0]);
  let gap = { a: -w.halfX, b: w.halfX, len: -1 };
  let x = -w.halfX;
  for (const [a, b] of [...stops, [w.halfX, w.halfX] as [number, number]]) {
    if (a - x > gap.len) gap = { a: x, b: a, len: a - x };
    x = Math.max(x, b);
  }
  ctx.fit = Math.max(0.1, Math.min(1, (gap.len - 2.5) / Math.max(0.1, width)));
  return (gap.a + gap.b) / 2;
}

function wallBarrage(ctx: Ctx, w: TwWall): TwBarrage {
  const { plan, n, seed } = ctx;
  const f = plan.field;
  const besiegerSide: Side = w.side === 'attacker' ? 'defender' : 'attacker';
  const besieger = plan.units.filter((u) => u.side === besiegerSide);
  const bx = breachX(ctx, w, breachWidth(ctx.shares, n), plan.site!.ladders.map((l) => l.x));
  const width = breachWidth(ctx.shares, n, ctx.fit);
  const top = w.base + w.top;
  const outward = -w.inward;
  const engines = placeEngines(ctx, besieger, w.inward, bx, w.z);
  const stones: TwStone[] = [];
  const chunks: TwChunk[] = [];
  // Перелёт — в дом за стеной, поближе к пролому: его и дым над ним видно из того же кадра.
  const houses = [...plan.site!.houses].sort((a, b) => Math.abs(a.x - bx) + Math.abs(outOf(w, a.z)) * 0.6 - (Math.abs(b.x - bx) + Math.abs(outOf(w, b.z)) * 0.6));
  let over = 0;
  const smoke: TwSmoke[] = [];
  let lastImpact = 0;
  const faceZ = w.z + outward * 0.15;
  for (let r = 0; r <= n; r++) {
    for (let e = 0; e < n; e++) {
      const at = BARRAGE_INTRO + r * BARRAGE_ROUND + e * STAGGER + (hash(seed, r * 5 + e, 66) - 0.5) * 0.2;
      const what = wallHit(n, r, e);
      const jitter = (k: number): number => hash(seed, r * 11 + e, k) - 0.5;
      let st: TwStone;
      if (what === 'collapse') {
        const ci = r - 1;
        const prev = breachWidth(ctx.shares, ci, ctx.fit) / 2;
        const now = breachWidth(ctx.shares, ci + 1, ctx.fit) / 2;
        const spans: [number, number][] = ci === 0 ? [[bx - now, bx + now]] : [[bx - now, bx - prev], [bx + prev, bx + now]];
        const tx = ci === 0 ? bx + jitter(67) * 1.5 : bx + (r % 2 === 0 ? -1 : 1) * (prev + now) / 2;
        st = stone(ctx, engines, e, at, tx, w.base + w.top * 0.7, faceZ, 'wall', ci);
        chunks.push({ spans, at: st.at + st.flight });
      } else if (what === 'wall') {
        const side = jitter(68) < 0 ? -1 : 1;
        const tx = bx + side * (width / 2 + 0.8 + Math.abs(jitter(69)) * 3);
        st = stone(ctx, engines, e, at, tx, w.base + w.top * (0.4 + Math.abs(jitter(70)) * 0.4), faceZ, 'wall', -1);
      } else if (what === 'short') {
        const tx = bx + jitter(72) * 10;
        const tz = w.z + outward * (6 + Math.abs(jitter(73)) * 7);
        st = stone(ctx, engines, e, at, tx, heightAt(f, tx, tz), tz, 'short', -1);
      } else {
        const h = houses[over++ % Math.max(1, houses.length)];
        const tx = h ? h.x : bx + jitter(74) * 6;
        const tz = h ? h.z : w.z + w.inward * 10;
        const ty = heightAt(f, tx, tz) + (h ? 2.2 : 0);
        st = stone(ctx, engines, e, at, tx, ty, tz, 'over', -1);
        if (smoke.length < 3) smoke.push({ x: tx, y: ty, z: tz, from: st.at + st.flight, size: 1 - smoke.length * 0.2 });
      }
      stones.push(st);
      lastImpact = Math.max(lastImpact, st.at + st.flight);
    }
  }
  const share = breachShare(ctx.shares, n);
  const breach: TwBreach = { x: bx, width, depth: w.top * clamp(0.5 + share * 0.9, 0.5, 0.82), chunks };
  // Сбитые со стены: их доля к оставшимся на ходу — та же, что у `wallMen`: b / (1 − b).
  const wallUnits = plan.units.filter((u) => u.side === w.side && u.perch && !mounted(u));
  const onWall = wallUnits.reduce((s, u) => s + u.figures, 0);
  const fallN = Math.min(FALLERS_MAX[plan.quality], Math.round((onWall * share) / Math.max(0.05, 1 - share)));
  const fallers: TwFaller[] = [];
  const walkZ = w.z + w.inward * (PARAPET + (w.thick - PARAPET) * 0.35);
  for (let i = 0; i < fallN && chunks.length > 0; i++) {
    // Куски по очереди, первый — вдвое чаще: у первого залпа и пролом вдвое шире.
    const ci = i % (chunks.length + 1) === 0 ? 0 : Math.min(chunks.length - 1, i % (chunks.length + 1) - 1);
    const c = chunks[ci];
    const [a, b] = c.spans[i % c.spans.length];
    const x = a + (b - a) * (0.15 + 0.7 * hash(seed, i, 75));
    const z1 = w.z + outward * (1.4 + hash(seed, i, 76) * 3.2);
    const x1 = x + (hash(seed, i, 77) - 0.5) * 2.4;
    fallers.push({ x, y: top, z: walkZ, x1, y1: heightAt(f, x1, z1), z1, at: c.at + 0.04 + hash(seed, i, 78) * 0.3, yaw: w.inward > 0 ? Math.PI : 0 });
  }
  const seconds = lastImpact + OUTRO;
  const yawOut = w.inward > 0 ? 0 : Math.PI;
  const firstWall = stones.filter((s) => s.hit === 'wall').reduce((m, s) => Math.min(m, s.at + s.flight), Infinity);
  const lastCollapse = chunks.reduce((m, c) => Math.max(m, c.at), 0);
  // Общий план — из-за машин на стену: машины крупно, стена за ними в глубине (перспектива сама её уменьшит).
  const engZ = engines.reduce((s, e) => s + e.z, 0) / engines.length;
  const toward = w.z + (engZ - w.z) * 0.55;
  const engBox = boxOf(engines.map((e) => [e.x, e.z]), [[bx * 0.6, toward]], 4);
  const near = (half: number): TwCamKey['box'] => ({ minX: bx - half, maxX: bx + half, minZ: Math.min(w.z, w.z + outward * 6), maxZ: Math.max(w.z, w.z + outward * 6) });
  const cam = spaced([
    { at: 0, box: engBox, yaw: yawOut + 0.45, pitch: 0.46 },
    { at: Math.max(1.5, firstWall - 0.4), box: near(7), yaw: yawOut + 0.38, pitch: 0.42 },
    { at: Math.max(2.5, lastCollapse - 0.9), box: near(5), yaw: yawOut - 0.3, pitch: 0.4 },
  ]);
  return {
    shots: n,
    shares: ctx.shares,
    seconds,
    walls: true,
    besieger: besiegerSide,
    engines,
    stones,
    breach,
    fallers,
    crew: crewOf(ctx, engines),
    smoke,
    cam,
    cues: cuesOfBarrage(ctx, engines, stones, chunks, fallers, w.inward, w.z),
    look: { crew: firstOf(besieger.filter((u) => !mounted(u))), faller: firstOf(wallUnits) },
  };
}

function lairBarrage(ctx: Ctx): TwBarrage {
  const { plan, n, seed } = ctx;
  const f = plan.field;
  const camp = plan.site!.camp!;
  const huts = camp.tents.filter((t) => t.hide);
  const targets = (huts.length > 0 ? huts : camp.tents).slice();
  const besiegerSide: Side = 'attacker';
  const besieger = plan.units.filter((u) => u.side === besiegerSide);
  const cx = targets.reduce((s, t) => s + t.x, 0) / Math.max(1, targets.length);
  const cz = targets.reduce((s, t) => s + t.z, 0) / Math.max(1, targets.length);
  const bz = besieger.reduce((s, u) => s + u.z, 0) / Math.max(1, besieger.length);
  const dir: 1 | -1 = cz >= bz ? 1 : -1;
  // Шалаши — от ближних к середине: в них и метят.
  targets.sort((a, b) => Math.hypot(a.x - cx * 0.4, a.z - cz) - Math.hypot(b.x - cx * 0.4, b.z - cz));
  const engines = placeEngines(ctx, besieger, dir, cx * 0.4, cz);
  const stones: TwStone[] = [];
  const smoke: TwSmoke[] = [];
  let lastImpact = 0;
  let k = 0;
  for (let r = 0; r <= n; r++) {
    for (let e = 0; e < n; e++) {
      const at = BARRAGE_INTRO + r * BARRAGE_ROUND + e * STAGGER + (hash(seed, r * 5 + e, 66) - 0.5) * 0.2;
      let st: TwStone;
      if (r === 0 && e === 0) {
        // Пристрелка: недолёт у частокола.
        const tz = cz - dir * (Math.abs(cz - bz) * 0.3 + 6);
        const tx = cx * 0.4 + (hash(seed, e, 79) - 0.5) * 8;
        st = stone(ctx, engines, e, at, tx, heightAt(f, tx, tz), tz, 'short', -1);
      } else {
        const t = targets[k++ % Math.max(1, targets.length)];
        const tx = t ? t.x : cx;
        const tz = t ? t.z : cz;
        const ty = heightAt(f, tx, tz) + 0.6;
        st = stone(ctx, engines, e, at, tx, ty, tz, 'hut', -1);
        if (smoke.length < 3 && !smoke.some((s) => Math.hypot(s.x - tx, s.z - tz) < 3)) smoke.push({ x: tx, y: ty, z: tz, from: st.at + st.flight, size: 0.8 - smoke.length * 0.15 });
      }
      stones.push(st);
      lastImpact = Math.max(lastImpact, st.at + st.flight);
    }
  }
  const seconds = lastImpact + OUTRO;
  const yawIn = dir > 0 ? 0 : Math.PI;
  const firstHut = stones.filter((s) => s.hit === 'hut').reduce((m, s) => Math.min(m, s.at + s.flight), Infinity);
  const hit = stones.find((s) => s.hit === 'hut');
  const hx = hit ? hit.x1 : cx;
  const hz = hit ? hit.z1 : cz;
  const cam = spaced([
    { at: 0, box: boxOf(engines.map((e) => [e.x, e.z]), [[cx * 0.4, (engines[0].z + cz) / 2]], 4), yaw: yawIn + 0.45, pitch: 0.46 },
    { at: Math.max(1.5, firstHut - 0.4), box: { minX: hx - 6, maxX: hx + 6, minZ: hz - 5, maxZ: hz + 5 }, yaw: yawIn + 0.35, pitch: 0.44 },
  ]);
  return {
    shots: n,
    shares: ctx.shares,
    seconds,
    walls: false,
    besieger: besiegerSide,
    engines,
    stones,
    breach: null,
    fallers: [],
    crew: crewOf(ctx, engines),
    smoke,
    cam,
    cues: cuesOfBarrage(ctx, engines, stones, [], [], dir, cz),
    look: { crew: firstOf(besieger.filter((u) => !mounted(u))), faller: -1 },
  };
}

/** Ключи по времени и не ближе `CAM_GAP` друг к другу: близкий к прежнему выпадает (переход не рвётся на полпути). */
function spaced(keys: TwCamKey[]): TwCamKey[] {
  const out: TwCamKey[] = [];
  for (const k of keys) if (out.length === 0 || k.at >= out[out.length - 1].at + CAM_GAP) out.push(k);
  return out;
}

function boxOf(points: number[][], more: number[][], pad: number): TwCamKey['box'] {
  const all = [...points, ...more];
  return {
    minX: Math.min(...all.map((p) => p[0])) - pad,
    maxX: Math.max(...all.map((p) => p[0])) + pad,
    minZ: Math.min(...all.map((p) => p[1])) - pad,
    maxZ: Math.max(...all.map((p) => p[1])) + pad,
  };
}

/** Звук пролога: скрип рычага и удар перекладины, свист камня, удар, обвал, крик сбитых. */
function cuesOfBarrage(ctx: Ctx, engines: TwEngine[], stones: TwStone[], chunks: TwChunk[], fallers: TwFaller[], inward: number, wallZ: number): BarrageCue[] {
  const out: BarrageCue[] = [];
  const c = (at: number, kind: BarrageCueKind, x: number, z: number, size: number, seed: number, more: Partial<BarrageCue> = {}): BarrageCue => ({
    at,
    kind,
    x,
    z,
    x2: x,
    z2: z,
    dur: 0,
    size,
    seed,
    ...more,
  });
  for (const s of stones) {
    const e = engines[s.engine];
    out.push(c(Math.max(0, s.at - 0.15), 'engine', e.x, e.z, e.kind === 'trebuchet' ? 1 : 0.7, s.seed));
    out.push(c(s.at + 0.1, 'stone', s.x0, s.z0, 0.8, s.seed + 1, { x2: s.x1, z2: s.z1, dur: s.flight - 0.1 }));
    const size = s.hit === 'wall' ? 1 : s.hit === 'short' ? 0.5 : 0.75;
    out.push(c(s.at + s.flight, 'impact', s.x1, s.z1, size, s.seed + 2));
  }
  for (const ch of chunks) {
    const x = ch.spans.reduce((m, [a, b]) => m + (a + b) / 2, 0) / ch.spans.length;
    out.push(c(ch.at + 0.12, 'collapse', x, wallZ, 1, ctx.seed + Math.round(ch.at * 10)));
  }
  if (fallers.length > 0) {
    const f0 = fallers[0];
    out.push(c(f0.at, 'wallcry', f0.x, f0.z + inward * 2, Math.min(1, fallers.length / 6), ctx.seed + 991));
  }
  out.sort((a, b) => a.at - b.at);
  return out;
}
