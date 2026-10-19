// Значки карты нового вида (docs/map_tw.md, раздел 14): места, отряды, лагеря и метки боя — значками нового
// интерфейса, а не прежними миниатюрами. Вид один с тревогами верха (`.nx-ring`, docs/ui_audit.md, 12.2): тёмный
// диск, кольцо цвета стороны, внутри — рисунок листа значков (`tw/glyph.ts`). Под диском — плашка размера: четыре
// гнезда, занятые по стадии («Стоянка · Деревня · Острог · Крепость») или по размеру отряда; размер так читается на
// любом масштабе и не только глазом на рисунок. Свой город — крупнее, кольцо двойное золотое, над ним корона.
//
// Закон кадра тот же (docs/world-map.md): значок печётся один раз на вид и размер, в кадре — одно копирование.
// Геометрия значка (`markGeo`) — чистая: по ней печётся холст и считается тело — цель пальца и место, которое
// подписи обходят (`tw/scene.ts`). Две правды о том, где кончается значок, разошлись бы ровно там, где палец
// промахивается.
import { SIDE_COLOR } from '@/side';
import { anyArms } from '@/heraldry/arms';
import { ARMS_ASPECT, canPaintArms, paintArms } from '@/heraldry/paint';
import { makeCanvas } from '../paint';
import type { Mini } from './mini';
import { drawGlyph, glyphShapes, glyphStamp } from './glyph';

type C = CanvasRenderingContext2D;
const TAU = Math.PI * 2;

/** Вид значка: всё, что меняет картинку, — и только оно (ключ спрайта называет каждое поле). */
export interface MarkLook {
  /** Рисунок листа значков (`assets-src/icons`, имя без расширения). */
  glyph: string;
  /** Цвет кольца: сторона (`side.ts`) или отношение (`RELATION_META`). */
  ring: string;
  /** Плашка размера: 0 — нет её, 1..4 — занятых гнёзд из четырёх. */
  pips: number;
  /** Своё: кольцо двойное золотое, корона. */
  own: boolean;
  /** Приглушённый рисунок: пепелище, слух об отряде. */
  dim: boolean;
  /** Малый рисунок в углу (разорено — огонь). null — нет. */
  corner: string | null;
  /**
   * Герб места строкой (`ui/map/arms.placeArms`, docs/polish.md, П-2): щит в диске вместо рисунка. Нет — рисунок `glyph`
   * (пепелище, отряд); рисовать нечем (тест в узле) — тоже рисунок.
   */
  arms?: string | null;
}

/** Ключ спрайта: каждое поле вида, размер диска, плотность и есть ли уже лист. */
export function markKey(l: MarkLook, d: number, dpr: number): string {
  return `mark:${l.glyph}:${l.arms ?? '-'}:${l.ring}:${l.pips}:${l.own ? 1 : 0}:${l.dim ? 1 : 0}:${l.corner ?? '-'}:${d}:${dpr}:${glyphStamp()}`;
}

/** Гнёзд на плашке размера: четыре стадии места и четыре размера отряда — одна мерка на оба. */
export const PIPS = 4;

/** Сколько гнёзд занято у места по стадии. */
export const STAGE_PIPS: Record<'camp' | 'village' | 'stronghold' | 'town', number> = { camp: 1, village: 2, stronghold: 3, town: 4 };

// ---------- Размер на экране ----------

/**
 * Диаметр диска на масштабе, CSS px, без поправки вида: 22 на дальнем (7 px на клетку — соседи Сицилии в 5,8–6
 * клетках, 40.6–42 px друг от друга) до 42 на ближнем (44 px на клетку — диск с клетку). Растёт плавно: значок не
 * прыгает на щипке.
 */
export function markBase(scale: number): number {
  return Math.max(22, Math.min(42, 22 + (scale - 7) * 0.54));
}

/** Поправка размера по виду: больше гнёзд — крупнее диск; свой город — крупнее всех, какой бы ни был. */
export function markFactor(pips: number, own: boolean): number {
  if (own) return 1.26;
  return [0.84, 0.86, 0.94, 1.02, 1.12][Math.max(0, Math.min(PIPS, pips))];
}

/** Диск ступенями по 2 px: на щипке печётся считанное число спрайтов, а не новый на каждый кадр. */
export const markPx = (scale: number, pips: number, own: boolean): number => Math.round((markBase(scale) * markFactor(pips, own)) / 2) * 2;

// ---------- Геометрия ----------

/** Где что лежит у значка диаметра `d`, CSS px, от середины диска. */
export interface MarkGeo {
  r: number;
  /** Толщина кольца. */
  ring: number;
  /** Сторона квадрата рисунка внутри диска. */
  glyph: number;
  /** Корона своего: сторона квадрата и середина по y. */
  crown: number;
  crownY: number;
  /** Плашка размера: гнездо, зазор, ширина, высота, верх. */
  pip: number;
  gap: number;
  pillW: number;
  pillH: number;
  pillTop: number;
  /** Тело: насколько значок поднимается над серединой, уходит ниже и вбок. */
  up: number;
  down: number;
  rx: number;
}

export function markGeo(l: Pick<MarkLook, 'own' | 'pips'>, d: number): MarkGeo {
  const r = d / 2;
  const ring = Math.max(1.6, d * 0.07) * (l.own ? 1.4 : 1);
  const crown = l.own ? d * 0.46 : 0;
  const crownY = -r - crown * 0.08;
  const pip = Math.max(3, d * 0.11);
  const gap = pip * 0.5;
  const pillW = PIPS * pip + (PIPS + 1) * gap;
  const pillH = pip + gap * 2;
  const pillTop = r - pillH * 0.45;
  const up = l.own ? -crownY + crown * 0.5 : r + ring / 2;
  const down = l.pips > 0 ? pillTop + pillH : r + ring / 2;
  return { r, ring, glyph: d * 0.66, crown, crownY, pip, gap, pillW, pillH, pillTop, up, down, rx: r + ring / 2 };
}

/** Поля холста вокруг тела: тень вниз-вправо и сглаживание. */
const PAD = 3;

// ---------- Кисть ----------

/** Середина диска — как у тревог верха (`.nx-ring`): тёплый тёмный круг. */
const DISC_IN = '#3a2c1f';
const DISC_OUT = '#1a140f';
/** Пустое гнездо плашки — тёплая кромка панелей нового вида (`--line`, гуще). */
const PIP_EMPTY = 'rgba(255, 220, 170, 0.2)';
const GOLD_LIGHT = '#f7e6bd';

function drawMark(ctx: C, l: MarkLook, d: number): void {
  const g = markGeo(l, d);
  // Тень — значок стоит над землёй, а не нарисован на ней.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.38)';
  ctx.beginPath();
  ctx.arc(1, 1.6, g.r + g.ring / 2, 0, TAU);
  ctx.fill();
  const grad = ctx.createRadialGradient(0, -g.r * 0.2, g.r * 0.05, 0, 0, g.r);
  grad.addColorStop(0, DISC_IN);
  grad.addColorStop(1, DISC_OUT);
  ctx.beginPath();
  ctx.arc(0, 0, g.r, 0, TAU);
  ctx.fillStyle = grad;
  ctx.fill();
  if (l.arms && canPaintArms()) {
    // Щит герба — чуть выше рисунка (герб узкий): высота — 1.1 рисунка, ширина — по пропорции щита.
    const h = g.glyph * 1.1;
    const w = h / ARMS_ASPECT;
    ctx.save();
    if (l.dim) ctx.globalAlpha = 0.5;
    paintArms(ctx, anyArms(l.arms), -w / 2, -h / 2, w, { gloss: d >= 30 });
    ctx.restore();
  } else {
    const shapes = glyphShapes(l.glyph);
    if (shapes) drawGlyph(ctx, shapes, -g.glyph / 2, -g.glyph / 2, g.glyph, l.dim ? 0.5 : 1);
  }
  ctx.lineWidth = g.ring;
  ctx.strokeStyle = l.dim ? mute(l.ring) : l.ring;
  ctx.beginPath();
  ctx.arc(0, 0, g.r, 0, TAU);
  ctx.stroke();
  if (l.own) {
    // Двойное кольцо своего: светлая нить внутри золота — свой город видно первым и издали.
    ctx.lineWidth = Math.max(0.8, g.ring * 0.28);
    ctx.strokeStyle = GOLD_LIGHT;
    ctx.beginPath();
    ctx.arc(0, 0, g.r - g.ring * 0.62, 0, TAU);
    ctx.stroke();
    const crown = glyphShapes('ui-crown');
    if (crown) drawGlyph(ctx, crown, -g.crown / 2, g.crownY - g.crown / 2, g.crown);
  }
  if (l.corner) {
    const cs = d * 0.4;
    const cx = g.r * 0.72;
    const cy = g.r * 0.5;
    ctx.beginPath();
    ctx.arc(cx, cy, cs * 0.55, 0, TAU);
    ctx.fillStyle = DISC_OUT;
    ctx.fill();
    ctx.lineWidth = Math.max(1, g.ring * 0.6);
    ctx.strokeStyle = SIDE_COLOR.foe;
    ctx.stroke();
    const cg = glyphShapes(l.corner);
    if (cg) drawGlyph(ctx, cg, cx - cs * 0.36, cy - cs * 0.36, cs * 0.72);
  }
  if (l.pips > 0) {
    const x0 = -g.pillW / 2;
    roundRect(ctx, x0, g.pillTop, g.pillW, g.pillH, g.pillH / 2);
    ctx.fillStyle = DISC_OUT;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = l.dim ? mute(l.ring) : l.ring;
    ctx.stroke();
    for (let i = 0; i < PIPS; i++) {
      const x = x0 + g.gap + i * (g.pip + g.gap);
      roundRect(ctx, x, g.pillTop + g.gap, g.pip, g.pip, g.pip * 0.3);
      ctx.fillStyle = i < l.pips ? (l.own ? SIDE_COLOR.ours : l.ring) : PIP_EMPTY;
      ctx.fill();
    }
  }
}

/** Приглушённое кольцо: цвет наполовину к пеплу. */
function mute(c: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(c);
  if (!m) return c;
  const v = parseInt(m[1], 16);
  const ch = (s: number): number => Math.round(((v >> s) & 255) * 0.5 + 120 * 0.5);
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}

/** Путь плашки со скруглёнными углами (без `roundRect`: он есть не во всех вебвью). */
function roundRect(ctx: C, x: number, y: number, w: number, h: number, r: number): void {
  const k = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + k, y);
  ctx.lineTo(x + w - k, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + k);
  ctx.lineTo(x + w, y + h - k);
  ctx.quadraticCurveTo(x + w, y + h, x + w - k, y + h);
  ctx.lineTo(x + k, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - k);
  ctx.lineTo(x, y + k);
  ctx.quadraticCurveTo(x, y, x + k, y);
  ctx.closePath();
}

// ---------- Спрайты ----------

const cache = new Map<string, Mini>();
/** Потолок памяти значков — по байтам, как у миниатюр (`mini.CACHE_BYTES`): вытесняется давно не нужный. */
const CACHE_BYTES = 6 * 1024 * 1024;
let cacheBytes = 0;
const bytesOf = (m: Mini): number => m.canvas.width * m.canvas.height * 4;
/** Испечённые диаметры каждого вида (ключ вида без диаметра, `markKey(l, 0, dpr)`) — для значка на ходу (`markAt`). */
const sizes = new Map<string, Set<number>>();
/** Ключ спрайта → вид и диаметр: вытесненный спрайт уходит и из `sizes`. */
const owner = new Map<string, { look: string; d: number }>();

/** Значок места, отряда или метки. Точка привязки (`ax`, `ay`) — середина диска. */
export function markSprite(l: MarkLook, d: number, dpr: number): Mini {
  const key = markKey(l, d, dpr);
  const have = cache.get(key);
  if (have) {
    cache.delete(key);
    cache.set(key, have);
    return have;
  }
  const g = markGeo(l, d);
  const rx = Math.max(g.rx, g.pillW / 2) + PAD;
  const w = Math.ceil(rx * 2);
  const h = Math.ceil(g.up + g.down + PAD * 2);
  const ax = w / 2;
  const ay = g.up + PAD;
  const canvas = makeCanvas(Math.ceil(w * dpr), Math.ceil(h * dpr));
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.setTransform(dpr, 0, 0, dpr, ax * dpr, ay * dpr);
    ctx.lineJoin = 'round';
    drawMark(ctx, l, d);
  }
  const m: Mini = { canvas, ax, ay, w, h };
  cache.set(key, m);
  cacheBytes += bytesOf(m);
  const look = markKey(l, 0, dpr);
  owner.set(key, { look, d });
  const have2 = sizes.get(look);
  if (have2) have2.add(d);
  else sizes.set(look, new Set([d]));
  markBakes++;
  while (cacheBytes > CACHE_BYTES && cache.size > 1) {
    const first = cache.keys().next().value as string;
    const gone = cache.get(first);
    cache.delete(first);
    const who = owner.get(first);
    owner.delete(first);
    if (who) sizes.get(who.look)?.delete(who.d);
    if (gone) {
      cacheBytes -= bytesOf(gone);
      gone.canvas.width = 0;
    }
  }
  return m;
}

/** Сколько значков пеклось — тесту «на ходу не печётся». */
let markBakes = 0;
export const markBakesCount = (): number => markBakes;

/**
 * Сколько точных значков кадр ещё может испечь (`markFrame`): на ходу — ни одного, стоя — по нескольку за кадр. Значок
 * несёт свой герб, и на щипке каждый новый диаметр (шаг 2 px) пёкся заново у каждого места — пачкой в один кадр (К-1).
 */
let allowance = Infinity;
/** В этом кадре значок лёг не своим размером: карте — нарисовать ещё кадр, когда испечётся точный. */
let pending = false;

/** Сколько точных значков печь стоя за кадр: каждый — доли миллисекунды, пачка в два десятка — уже рывок. */
export const MARK_BAKES_STILL = 4;

/** Начало кадра: на ходу (`moving`) значки новых размеров не печётся, стоя — не больше `MARK_BAKES_STILL`. */
export function markFrame(moving: boolean): void {
  allowance = moving ? 0 : MARK_BAKES_STILL;
  pending = false;
}

/** Лёг ли в этом кадре значок не своим размером. */
export const markPending = (): boolean => pending;

/**
 * Значок вида `l` диаметра `d` для кадра и во сколько раз его растянуть (`k`). Испечён — он сам. Нет, и печь в этом кадре
 * нельзя, — ближайший испечённый того же вида, растянутый до `d`: на ходу разницы в пиксель кольца не видно, а точный
 * испечётся, когда камера встанет. Того же вида нет ни одного — печётся сразу: значку не из чего взяться.
 */
export function markAt(l: MarkLook, d: number, dpr: number): { m: Mini; k: number } {
  if (cache.has(markKey(l, d, dpr)) || allowance > 0) {
    if (!cache.has(markKey(l, d, dpr))) allowance--;
    return { m: markSprite(l, d, dpr), k: 1 };
  }
  let near = -1;
  for (const s of sizes.get(markKey(l, 0, dpr)) ?? []) if (near < 0 || Math.abs(s - d) < Math.abs(near - d) || (Math.abs(s - d) === Math.abs(near - d) && s > near)) near = s;
  if (near < 0) return { m: markSprite(l, d, dpr), k: 1 };
  pending = true;
  return { m: markSprite(l, near, dpr), k: d / near };
}

/** Сколько байт держат значки — бюджету (docs/map_tw.md, раздел 8). */
export const markBytes = (): number => cacheBytes;

export function dropMarks(): void {
  for (const m of cache.values()) m.canvas.width = 0;
  cache.clear();
  sizes.clear();
  owner.clear();
  cacheBytes = 0;
}

// ---------- Метки у места: бой, свои войска, осада, гости у ворот ----------

/** Метка у места: под ударом, свои войска стоят, в осаде, волки или разбойники у ворот. */
export type BadgeKind = 'attack' | 'troops' | 'siege' | 'wolves' | 'raiders';

/** Метка — тот же значок, малый и без плашки размера: рисунок листа и кольцо смысла. */
export const BADGE_D = 20;

const BADGE: Record<BadgeKind, { glyph: string; ring: string }> = {
  attack: { glyph: 'alert-raid', ring: SIDE_COLOR.foe },
  troops: { glyph: 'troop-legionary', ring: SIDE_COLOR.ours },
  siege: { glyph: 'ui-target', ring: '#d9a441' },
  wolves: { glyph: 'evt-wolves', ring: SIDE_COLOR.foe },
  raiders: { glyph: 'evt-raiders', ring: SIDE_COLOR.foe },
};

export const badgeLook = (k: BadgeKind): MarkLook => ({ glyph: BADGE[k].glyph, ring: BADGE[k].ring, pips: 0, own: false, dim: false, corner: null });

export const badgeSprite = (k: BadgeKind, dpr: number): Mini => markSprite(badgeLook(k), BADGE_D, dpr);

// ---------- Легенда ----------

/** Картинки легенды — свой кэш, мимо экранного: строки легенды не вытесняют живые значки карты. */
const legendCache = new Map<string, string>();

/**
 * Значок картинкой для легенды (`tw/legend.ts`): тот же рисунок, что на карте, диаметром `d` CSS px, вдвое плотнее.
 * Лист значков ещё не пришёл — ключ другой (`glyphStamp`), и легенда перерисует строку, когда он придёт.
 */
export function markUrl(l: MarkLook, d: number): string {
  const key = markKey(l, d, 2);
  const have = legendCache.get(key);
  if (have) return have;
  const g = markGeo(l, d);
  const rx = Math.max(g.rx, g.pillW / 2) + PAD;
  const w = Math.ceil(rx * 2);
  const h = Math.ceil(g.up + g.down + PAD * 2);
  const canvas = makeCanvas(w * 2, h * 2);
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.setTransform(2, 0, 0, 2, w, (g.up + PAD) * 2);
  ctx.lineJoin = 'round';
  drawMark(ctx, l, d);
  const url = canvas.toDataURL();
  legendCache.set(key, url);
  return url;
}
