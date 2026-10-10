// Осада и падение города на карте: рогатки вокруг осаждённого, знак участи под павшим.
//
// Устроено как поселения (`village.ts`) и отряды (`party.ts`), и по той же причине —
// **закон кадра**: во время перетаскивания не строится ни одного пути.
//   * чистая часть (`worksStep`, `stakeOrder`, `worksKey`, `FELL_WORDS`, `fitLabel`,
//     `fellShown`) — без canvas, её проверяет тест;
//   * выпечка (`bakeWorks`, `bakeFarRing`, `bakeFell`) — на смене ступени готовности,
//     корзины или участи;
//   * кадр (`drawWorks`, `drawFarRing`, `drawFell`) — только `drawImage`.
//
// **Земли всё это не касается.** Рогатки — спрайт поверх двора, а не часть тайла: тайл
// испечён по клеткам и перепекается только при смене мира (`ground.ts`), и если бы осада
// меняла, что лежит в тайле, её начало и каждый шаг рогаток стоили бы перепечки земли —
// ровно та ловушка, от которой `TREE_FREE_R` один на все стадии. Кольцо поэтому лежит
// внутри вырубки (`TREE_FREE_R`) и ни клеткой не просит земли сверх неё.
//
// Какая сторона лагеря укреплена, видно двумя рядами: ближний к городу ряд — фронт
// (колья наклонены к городу), дальний — тыл (колья смотрят в поле). Каждый ряд
// набирается кольями по мере готовности своей стороны (`works.sideWorks`), вразброс по
// кругу, а не дугой: дуга читалась бы «с одной стороны города», а сторона здесь не румб,
// а ряд. На дальнем виде рядов не разобрать — там одно зубчатое кольцо, «осада есть».
import type { Fate, FellMark } from '@/world/types';
import { FALL_MARK } from '@/world/data/tuning';
import { FELL_MARK, SIEGE_WORKS } from './palette';
import { SQUASH, TAU, pickBucket } from './village';

type C = CanvasRenderingContext2D;

const LINE = 0.024;

// ---------- Чистая часть ----------

/** Радиусы рядов в клетках: фронт ближе к городу, тыл дальше. Оба внутри `TREE_FREE_R`. */
export const FRONT_R = 1.16;
export const REAR_R = 1.38;
/**
 * Рогаток в ряду. Рогатка — два кола накрест, и крест шире кола, поэтому их меньше, чем
 * было бы кольев; у дальнего ряда больше, иначе при той же готовности он редел бы на глаз.
 */
export const FRONT_STAKES = 18;
export const REAR_STAKES = 22;
/**
 * Ступеней готовности. Рогатки дозревают за `CAMP_WORKS_RIPE`, и восемь ступеней — это
 * перепечка спрайта не чаще раза в `CAMP_WORKS_RIPE / WORKS_STEPS` на город, а не каждый кадр.
 */
export const WORKS_STEPS = 8;

/** Готовность стороны (0..1) → ступень, по которой печётся спрайт. */
export const worksStep = (works: number): number =>
  Math.max(0, Math.min(WORKS_STEPS, Math.floor(Math.max(0, works) * WORKS_STEPS + 1e-9)));

/**
 * Порядок, в котором колья встают: бит-реверс номера. Первые полкруга ставят каждый
 * второй кол, четверть — каждый четвёртый: недостроенный ряд редкий по всему кругу, и
 * «достроено наполовину» видно как «вдвое реже», а не как «полкольца».
 */
export function stakeOrder(n: number): number[] {
  const bits = Math.ceil(Math.log2(Math.max(2, n)));
  const rev = (i: number): number => {
    let r = 0;
    for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
    return r;
  };
  const ranks = Array.from({ length: n }, (_, i) => i).sort((a, b) => rev(a) - rev(b));
  const out = new Array<number>(n);
  ranks.forEach((pos, rank) => (out[pos] = rank));
  return out;
}

/** Сколько кольев стоит в ряду на ступени. */
export const stakesAt = (n: number, step: number): number => Math.round((n * step) / WORKS_STEPS);

/** Задняя половина кольца ложится под двор, передняя — поверх: кольцо обнимает город. */
export type Half = 'back' | 'front';

export const worksKey = (front: number, rear: number, half: Half, bucket: number, dpr: number): string =>
  `${front}|${rear}|${half}|${bucket}|${dpr}`;

/**
 * Рогатки ещё на карте? Со срока голода — нет: город доеден, лагерь снят. Срок есть только
 * у участника осады (`MapSiege.starvesAt`); со стороны рогатки сходят с куском карты.
 */
export const worksStand = (starvesAt: number | undefined, now: number): boolean =>
  starvesAt === undefined || now < starvesAt;

/**
 * Знак участи ещё держится? Сходит мир (`LocalWorld.fellOf`), но кусок карты живёт своим
 * сроком, и без этой проверки знак пережил бы свой срок на время куска. Мерка та же —
 * `FALL_MARK`, второго срока здесь нет.
 */
export const fellShown = (fell: FellMark | null, now: number): fell is FellMark =>
  fell !== null && now >= fell.at && now < fell.at + FALL_MARK;

/** Слова знака участи. Короткие: плашка стоит под именем на 375 px. */
export const FELL_WORDS: Record<Fate, string> = {
  plunder: 'ограблен',
  captives: 'уведены люди',
  burn: 'сожжён',
};

/**
 * Имя под поселением, вписанное в ширину. Длинное имя режется с многоточием, а не
 * разъезжает подпись на соседей: имя города пишет игрок, и длину его никто не обещал.
 * `measure` — ширина строки в пикселях (в кадре это `measureText`), поэтому правило
 * проверяется без холста.
 */
export function fitLabel(text: string, maxPx: number, measure: (s: string) => number): string {
  if (measure(text) <= maxPx) return text;
  const chars = Array.from(text);
  let lo = 0;
  let hi = chars.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(`${chars.slice(0, mid).join('').trimEnd()}…`) <= maxPx) lo = mid;
    else hi = mid - 1;
  }
  return `${chars.slice(0, lo).join('').trimEnd()}…`;
}

/** Потолок ширины подписи поселения на карте, CSS px. */
export const LABEL_MAX_PX = 150;

// ---------- Кэш ----------

/** Один кэш на все спрайты модуля: осаждённых и павших городов на экране единицы. */
const cache = new Map<string, HTMLCanvasElement>();
const CACHE_MAX = 12;

function remember(key: string, make: () => HTMLCanvasElement): HTMLCanvasElement {
  const have = cache.get(key);
  if (have) {
    cache.delete(key);
    cache.set(key, have);
    return have;
  }
  const made = make();
  cache.set(key, made);
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return made;
}

export function dropSiegeMarks(): void {
  cache.clear();
  fells.clear();
  labels.clear();
}

function canvasOf(w: number, h: number): [HTMLCanvasElement, C | null] {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  return [canvas, canvas.getContext('2d')];
}

// ---------- Рогатки вблизи ----------

/** Спрайт 3.2×2.4 клетки, привязка — центр клетки города. */
const SPAN_W = 3.2;
const SPAN_H = 2.4;
const ANCHOR_X = 1.6;
const ANCHOR_Y = 1.3;

// Корзины — те же, что у дворов (`village.BUCKETS`, `pickBucket`): рогатки растягиваются вместе с ними.

/** Одна жердь: тёмный контур и тело. Контур держит её на нижней корзине. */
function pole(ctx: C, x0: number, y0: number, x1: number, y1: number, body: string): void {
  ctx.strokeStyle = SIEGE_WORKS.line;
  ctx.lineWidth = LINE * 3.4;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.strokeStyle = body;
  ctx.lineWidth = LINE * 1.8;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

/**
 * Рогатка: два кола накрест поперёк кольца, верхушки клонятся `lean` (плюс — в поле,
 * минус — к городу). Крест, а не кол: одиночная жердь на карте читается сучком, крест —
 * заграждением, и именно по кресту осаду узнают издалека.
 */
function cross(ctx: C, x: number, y: number, a: number, lean: number, body: string): void {
  // Касательная к кольцу в этой точке: крест стоит поперёк кольца, а не вдоль радиуса.
  const tx = -Math.sin(a);
  const ty = Math.cos(a) * SQUASH;
  const tl = Math.hypot(tx, ty) || 1;
  const ux = (tx / tl) * 0.1;
  const uy = (ty / tl) * 0.1;
  const rx = Math.cos(a) * lean;
  const ry = Math.sin(a) * lean * SQUASH;
  const h = 0.3;
  pole(ctx, x - ux, y - uy, x + ux * 1.3 + rx, y + uy * 1.3 - h + ry, body);
  pole(ctx, x + ux, y + uy, x - ux * 1.3 + rx, y - uy * 1.3 - h + ry, body);
}

/**
 * Ров с валом: тёмная полоса под обоими рядами и светлая насыпь по её краю. Он виден с
 * первой минуты осады, когда не срублено ещё ни одной рогатки, — и потому именно ров,
 * а не колья, говорит издалека «город обложен». Под двором лежит целиком.
 */
function ditch(ctx: C): void {
  const inner = FRONT_R - 0.1;
  const outer = REAR_R + 0.1;
  ctx.beginPath();
  ctx.ellipse(0, 0, outer, outer * SQUASH, 0, 0, TAU);
  ctx.ellipse(0, 0, inner, inner * SQUASH, 0, 0, TAU, true);
  ctx.fillStyle = SIEGE_WORKS.ditch;
  ctx.fill('evenodd');
  ctx.lineWidth = LINE * 1.6;
  ctx.strokeStyle = SIEGE_WORKS.ditchEdge;
  ctx.beginPath();
  ctx.ellipse(0, 0, inner, inner * SQUASH, 0, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = SIEGE_WORKS.bank;
  ctx.lineWidth = LINE * 2.2;
  ctx.beginPath();
  ctx.ellipse(0, 0, outer + 0.03, (outer + 0.03) * SQUASH, 0, 0, TAU);
  ctx.stroke();
}

function row(ctx: C, radius: number, n: number, step: number, lean: number, half: Half, body: string): void {
  const order = stakeOrder(n);
  const shown = stakesAt(n, step);
  const spots: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    if (order[i] >= shown) continue;
    const a = (i / n) * TAU + (radius === FRONT_R ? 0 : Math.PI / n);
    const y = Math.sin(a) * radius * SQUASH;
    if ((half === 'back') !== y < 0) continue;
    spots.push([Math.cos(a) * radius, y, a]);
  }
  // Дальние раньше ближних: порядок художника, как у построек двора.
  spots.sort((p, q) => p[1] - q[1]);
  for (const [x, y, a] of spots) cross(ctx, x, y, a, lean, body);
}

export function bakeWorks(front: number, rear: number, half: Half, cell: number, dpr: number): HTMLCanvasElement {
  const [canvas, ctx] = canvasOf(SPAN_W * cell * dpr, SPAN_H * cell * dpr);
  if (!ctx) return canvas;
  const u = cell * dpr;
  ctx.setTransform(u, 0, 0, u, ANCHOR_X * u, ANCHOR_Y * u);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (half === 'back') ditch(ctx);
  // Тыл дальше, рисуется первым; фронт ближе к городу. Колья фронта клонятся к городу
  // (минус), тыла — в поле (плюс): по наклону ряд и узнаётся вблизи.
  // Тона у рядов разные: фронт — свежее светлое дерево, тыл — потемнее. Вблизи ряды
  // различаются и местом, и наклоном, а тон держит разницу там, где наклона уже не видно.
  if (half === 'back') {
    row(ctx, REAR_R, REAR_STAKES, rear, 0.09, half, SIEGE_WORKS.stakeRear);
    row(ctx, FRONT_R, FRONT_STAKES, front, -0.09, half, SIEGE_WORKS.stake);
  } else {
    row(ctx, FRONT_R, FRONT_STAKES, front, -0.09, half, SIEGE_WORKS.stake);
    row(ctx, REAR_R, REAR_STAKES, rear, 0.09, half, SIEGE_WORKS.stakeRear);
  }
  return canvas;
}

/** Кадр: одно копирование. cx, cy — центр клетки города, px — пикселей на клетку. */
export function drawWorks(
  ctx: C,
  front: number,
  rear: number,
  half: Half,
  px: number,
  dpr: number,
  cx: number,
  cy: number,
): void {
  const bucket = pickBucket(px);
  const sprite = remember(worksKey(front, rear, half, bucket, dpr), () => bakeWorks(front, rear, half, bucket, dpr));
  const k = px / bucket;
  ctx.drawImage(sprite, cx - ANCHOR_X * bucket * k, cy - ANCHOR_Y * bucket * k, SPAN_W * bucket * k, SPAN_H * bucket * k);
}

// ---------- Рогатки издалека ----------

/** Размер спрайта дальнего кольца в CSS px: печётся один раз и масштабируется копированием. */
const FAR = 44;

export function bakeFarRing(dpr: number): HTMLCanvasElement {
  const [canvas, ctx] = canvasOf(FAR * dpr, FAR * dpr);
  if (!ctx) return canvas;
  const u = (FAR * dpr) / 2;
  ctx.setTransform(u, 0, 0, u, u, u);
  ctx.lineJoin = 'round';
  // Зубчатое кольцо: двенадцать зубьев наружу. Круг читался бы выделением клетки, а
  // зубья — частоколом, то есть осадой.
  const teeth = 12;
  ctx.beginPath();
  for (let i = 0; i <= teeth * 2; i++) {
    const a = (i / (teeth * 2)) * TAU;
    const r = i % 2 === 0 ? 0.92 : 0.7;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.lineWidth = 0.22;
  ctx.strokeStyle = SIEGE_WORKS.farEdge;
  ctx.stroke();
  ctx.lineWidth = 0.1;
  ctx.strokeStyle = SIEGE_WORKS.far;
  ctx.stroke();
  return canvas;
}

/**
 * Кадр дальнего вида: кольцо вокруг точки поселения. Мерка экранная — на обзоре клетка
 * в несколько пикселей, и кольцо в клетку было бы не видно ровно там, где его ищут
 * издалека. Растёт вместе с масштабом, но не меньше `r`.
 */
export function drawFarRing(ctx: C, dpr: number, cx: number, cy: number, r: number): void {
  const sprite = remember(`far|${dpr}`, () => bakeFarRing(dpr));
  ctx.drawImage(sprite, cx - r, cy - r, r * 2, r * 2);
}

// ---------- Знак участи ----------

const FELL_H = 16;
const FELL_FONT = '600 10.5px system-ui, sans-serif';

/** Рисунок участи в квадрате 1×1 с центром в нуле. */
function fateGlyph(ctx: C, fate: Fate): void {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (fate === 'burn') {
    ctx.fillStyle = FELL_MARK.flame;
    ctx.beginPath();
    ctx.moveTo(-0.34, 0.42);
    ctx.quadraticCurveTo(-0.46, -0.05, -0.08, -0.46);
    ctx.quadraticCurveTo(-0.02, -0.12, 0.14, -0.2);
    ctx.quadraticCurveTo(0.46, 0.05, 0.34, 0.42);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = FELL_MARK.flameCore;
    ctx.beginPath();
    ctx.moveTo(-0.14, 0.42);
    ctx.quadraticCurveTo(-0.2, 0.1, 0.0, -0.08);
    ctx.quadraticCurveTo(0.22, 0.14, 0.14, 0.42);
    ctx.closePath();
    ctx.fill();
    return;
  }
  if (fate === 'captives') {
    // Два звена цепи: связанные, а не рядом.
    ctx.lineWidth = 0.13;
    ctx.strokeStyle = FELL_MARK.glyph;
    for (const [x, y, rot] of [
      [-0.16, 0.12, -0.7],
      [0.16, -0.12, -0.7],
    ] as [number, number, number][]) {
      ctx.beginPath();
      ctx.ellipse(x, y, 0.3, 0.15, rot, 0, TAU);
      ctx.stroke();
    }
    return;
  }
  // Грабёж: пустой сундук с откинутой крышкой.
  ctx.fillStyle = FELL_MARK.glyphDark;
  ctx.fillRect(-0.4, -0.02, 0.8, 0.42);
  ctx.strokeStyle = FELL_MARK.glyph;
  ctx.lineWidth = 0.09;
  ctx.strokeRect(-0.4, -0.02, 0.8, 0.42);
  ctx.beginPath();
  ctx.moveTo(-0.4, -0.02);
  ctx.lineTo(-0.2, -0.44);
  ctx.lineTo(0.5, -0.3);
  ctx.lineTo(0.4, -0.02);
  ctx.stroke();
}

export function bakeFell(fate: Fate, dpr: number): { canvas: HTMLCanvasElement; w: number; h: number } {
  const probe = document.createElement('canvas').getContext('2d');
  let textW = 60;
  if (probe) {
    probe.font = FELL_FONT;
    textW = Math.ceil(probe.measureText(FELL_WORDS[fate]).width);
  }
  const w = 4 + 3 + 12 + 4 + textW + 6;
  const h = FELL_H;
  const [canvas, ctx] = canvasOf(w * dpr, h * dpr);
  if (!ctx) return { canvas, w, h };
  ctx.scale(dpr, dpr);
  const r = h / 2;
  ctx.fillStyle = FELL_MARK.plate;
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(w - r, 0);
  ctx.arc(w - r, r, r, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(r, h);
  ctx.arc(r, r, r, Math.PI / 2, (Math.PI * 3) / 2);
  ctx.closePath();
  ctx.fill();
  // Полоса «взят»: цвет врага у левого края плашки.
  ctx.fillStyle = FELL_MARK.stripe;
  ctx.fillRect(4, 3, 3, h - 6);
  ctx.save();
  ctx.translate(4 + 3 + 3 + 6, h / 2);
  ctx.scale(12, 12);
  fateGlyph(ctx, fate);
  ctx.restore();
  ctx.font = FELL_FONT;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = FELL_MARK.text;
  ctx.fillText(FELL_WORDS[fate], 4 + 3 + 3 + 12 + 3, h / 2 + 0.5);
  return { canvas, w, h };
}

const fells = new Map<string, { canvas: HTMLCanvasElement; w: number; h: number }>();

/** Кадр: плашка участи серединой на `cx`, верхом на `top`. Возвращает её коробку. */
export function drawFell(
  ctx: C,
  fate: Fate,
  dpr: number,
  cx: number,
  top: number,
): { x: number; y: number; w: number; h: number } {
  const key = `${fate}|${dpr}`;
  let sp = fells.get(key);
  if (!sp) {
    sp = bakeFell(fate, dpr);
    fells.set(key, sp);
  }
  const x = Math.round(cx - sp.w / 2);
  const y = Math.round(top);
  ctx.drawImage(sp.canvas, x, y, sp.w, sp.h);
  return { x, y, w: sp.w, h: sp.h };
}

/**
 * Картинки для легенды. Кэш свой, мимо экранного: легенда перерисовывается с каждым пульсом,
 * и печь картинку в строку на каждый — лишняя работа, а вытеснять ею живые спрайты полотна
 * нельзя (та же причина, что у значков легенды, `tw/marks.markUrl`).
 */
const legend = new Map<string, string>();

/** Картинка знака для легенды. */
export function fellUrl(fate: Fate, dpr = 2): string {
  const key = `fell|${fate}|${dpr}`;
  const have = legend.get(key);
  if (have) return have;
  const url = bakeFell(fate, dpr).canvas.toDataURL('image/png');
  legend.set(key, url);
  return url;
}

/** Картинка рогаток для легенды: вся окружность, обе половины одним рисунком. */
export function worksUrl(front: number, rear: number, cell = 20, dpr = 2): string {
  const key = `works|${front}|${rear}|${cell}|${dpr}`;
  const have = legend.get(key);
  if (have) return have;
  const back = bakeWorks(front, rear, 'back', cell, dpr);
  const face = bakeWorks(front, rear, 'front', cell, dpr);
  const ctx = back.getContext('2d');
  if (ctx) ctx.drawImage(face, 0, 0);
  const url = back.toDataURL('image/png');
  legend.set(key, url);
  return url;
}

// ---------- Подписи ----------

/** Вписанные имена: мерить длинное имя каждый кадр незачем, оно не меняется. */
const labels = new Map<string, string>();

/** Имя, вписанное в `LABEL_MAX_PX` шрифтом кадра. Кэш по строке: мерится один раз. */
export function fittedLabel(ctx: C, name: string): string {
  const have = labels.get(name);
  if (have !== undefined) return have;
  const fit = fitLabel(name, LABEL_MAX_PX, (s) => ctx.measureText(s).width);
  if (labels.size > 64) labels.clear();
  labels.set(name, fit);
  return fit;
}
