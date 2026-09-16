// Отряды на карте: колонна людей, знамя и пыль — вместо цветного треугольника.
//
// Устроено ровно как поселения (`village.ts`), и не по подражанию, а по той же
// причине: **закон кадра** запрещает считать что-либо во время перетаскивания.
// Поэтому здесь строго разделено:
//   * чистая часть (`sizeOf`, `lookOf`, `partyKey`, `PARTY_STEPS`) — без canvas,
//     её проверяет тест;
//   * выпечка (`bakeParty`) — на смене стороны, размера, вида или корзины;
//   * кадр (`drawParty`, `drawHeading`) — только `drawImage`.
//
// Движение при этом не стоит ни одной перепечки: положение отряда — чистая
// функция от времени выхода и прибытия (`marchPosition`), а спрайт от положения
// не зависит вовсе. Отряд, идущий полчаса, печётся один раз.
//
// ---------------------------------------------------------------------------
// Размер отряда — это разведданные, и правило здесь то же, что у всей карты.
//
// Свой отряд игрок видит целиком: он его и собрал. Чужой — только если тот в
// **живом обзоре** (круг у деревни или стоящий лазутчик, `world/sight.ts`).
// Отряд, о котором донёс Дозор, но которого никто не видит глазами, рисуется
// видом `rumor`: пыль да две неразличимые тени. Это не украшение и не заглушка,
// а единственная честная картинка донесения — «идут», без «сколько».
//
// Проверить это можно и на глаз: набег из дальнего двора появляется пыльным
// облаком, а войдя в круг у деревни, обретает людей и знамя. Ровно так же
// работает и весь остальной второй слой.
import { PARTY_FOE, PARTY_OWN, type PartyPalette } from './palette';
import { SQUASH, TAU } from './village';

type C = CanvasRenderingContext2D;

/** Толщина контуров в долях клетки — она и держит силуэт на мелком масштабе. */
const LINE = 0.022;

// ---------- Чистая часть ----------

/**
 * Сколько их. `rumor` — «сколько, неизвестно»: не ступень лестницы, а её
 * отсутствие, поэтому и стоит отдельно от четырёх остальных.
 */
export type PartySize = 'rumor' | 'small' | 'band' | 'host' | 'horde';

/** Идёт колонной или стоит лагерем. Лагерь — это осада, а не поход. */
export type PartyShape = 'column' | 'camp';

export type PartySide = 'own' | 'foe';

/**
 * Пороги лестницы, бойцов. Числа меряные, а не назначенные — их печатает
 * `npm run map:report`, раздел «сколько людей ходит по карте».
 *
 * По карте ходят две разные величины, и лестница обязана держать обе. Чужой
 * набег — это `min(мощь двора × AI_POWER_SHARE, оборона × AI_POWER_VS_DEFENSE)`,
 * переведённое в воинов (`LocalWorld`); наименьший, наибольший и самый частый размер
 * печатает тот же раздел. Своё войско при полководце — это уже
 * сотни: его потолок задаёт Статуя, а не чужой двор. Поэтому шесть и двадцать
 * режут настоящий разброс набегов на три внятные ступени, а восемьдесят
 * отделяет от них своё войско, которого у соседей не бывает.
 *
 * Круглых чисел тут быть и не должно: круглое число здесь означало бы, что его
 * не с чем было сверять.
 */
export const PARTY_STEPS: [number, number, number] = [6, 20, 80];

/**
 * Сколько всего людей в отряде. Без разбора видов и намеренно шире `UnitStack`:
 * тем же счётом меряется войско при полководце (`FigureView.troops`), а это уже
 * `TroopStack`. Карте нужна масса, а не роспись по родам.
 */
export const partyMen = (units: Partial<Record<string, number>>): number =>
  Object.values(units).reduce((n: number, v) => n + (v ?? 0), 0);

/** Ступень лестницы по числу людей. `rumor` отсюда выйти не может — он не про число. */
export function sizeOf(men: number): Exclude<PartySize, 'rumor'> {
  if (men >= PARTY_STEPS[2]) return 'horde';
  if (men >= PARTY_STEPS[1]) return 'host';
  if (men >= PARTY_STEPS[0]) return 'band';
  return 'small';
}

export interface PartyLook {
  side: PartySide;
  size: PartySize;
  shape: PartyShape;
  /** Идут влево. У лагеря значения не имеет и в ключ не входит. */
  west: boolean;
}

/**
 * Чей отряд и как он выглядит. Единственная дверь из правил в картинку, и
 * поэтому единственное место, где решается «показывать ли, сколько их».
 *
 * `seen` — отряд **в живом обзоре прямо сейчас**. Считает это не карта своим
 * умом, а общий модуль `world/sight.ts` через `world/store.sightDiscs`: второй
 * правды о том, кто наблюдает, между картой и миром быть не должно.
 */
export function lookOf(o: {
  own: boolean;
  units: Partial<Record<string, number>>;
  standing: boolean;
  seen: boolean;
  west: boolean;
}): PartyLook {
  const side: PartySide = o.own ? 'own' : 'foe';
  // Своих считать не надо: игрок сам их и послал. Чужих — только глазами.
  const size: PartySize = o.own || o.seen ? sizeOf(partyMen(o.units)) : 'rumor';
  return { side, size, shape: o.standing ? 'camp' : 'column', west: o.west };
}

/**
 * Ключ кэша. Направление в него входит потому, что колонна печётся зеркально, а
 * у лагеря его нет вовсе — иначе стоящий лагерь занимал бы в кэше две ячейки
 * под одну и ту же картинку.
 */
export const partyKey = (l: PartyLook, bucket: number, dpr: number): string =>
  `${l.side}|${l.size}|${l.shape}|${l.shape === 'camp' ? 0 : l.west ? 1 : 0}|${bucket}|${dpr}`;

/** Сколько людей рисуется на ступени. `rumor` — не люди, а пыль: людей ноль. */
export const MEN_SHOWN: Record<PartySize, number> = {
  rumor: 0,
  small: 1,
  band: 3,
  host: 5,
  horde: 5,
};

/** У орды за спинами колонны стоит тёмная масса: пять фигур сотни не показывают. */
export const hasRear = (size: PartySize): boolean => size === 'horde';

// ---------- Габариты ----------

/**
 * Спрайт занимает 1.7×1.5 клетки, точка привязки — та, где отряд стоит на
 * земле. Вверх места больше: там древки и знамя.
 */
const SPAN_W = 1.7;
const SPAN_H = 1.5;
const ANCHOR_X = 0.85;
const ANCHOR_Y = 1.05;

export interface PartySprite {
  canvas: HTMLCanvasElement;
  /** Размеры в CSS-пикселях при своей корзине. */
  w: number;
  h: number;
  /** Точка спрайта, которая ложится на положение отряда. */
  ax: number;
  ay: number;
  /** Клетка, под которую он выпечен. */
  cell: number;
}

/**
 * Корзины размера — те же, что у поселений, и по той же причине: щипок меняет
 * масштаб непрерывно, а перепекать спрайт за кадр нельзя. Своей лестницы тут
 * заводить незачем — отряды ходят по той же карте.
 */
export const PARTY_BUCKETS: number[] = [22, 30, 40, 52, 64];

export function partyBucket(px: number): number {
  for (const b of PARTY_BUCKETS) if (b >= px) return b;
  return PARTY_BUCKETS[PARTY_BUCKETS.length - 1];
}

// ---------- Кисти ----------

const palOf = (side: PartySide): PartyPalette => (side === 'own' ? PARTY_OWN : PARTY_FOE);

/** Пятно на земле: без него фигуры висят в воздухе. */
function footShadow(ctx: C, x: number, y: number, r: number, p: PartyPalette): void {
  ctx.fillStyle = p.shade;
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * SQUASH * 0.55, 0, 0, TAU);
  ctx.fill();
}

/**
 * Боец: ноги, плащ стороны, шлем и копьё за плечом. Ростом он 0.4 клетки — на
 * сорока пикселях это шестнадцать, и деталей больше туда не влезает: всё, что
 * рисуется мельче, сливается в кляксу и стоит впустую.
 *
 * Копьё смотрит назад-вверх, против хода. Это не поза, а признак направления:
 * древки, наклонённые в одну сторону, читаются быстрее самой фигуры.
 */
function man(ctx: C, x: number, y: number, p: PartyPalette, west: boolean, scale = 1): void {
  const dir = west ? -1 : 1;
  const h = 0.4 * scale;
  const w = 0.15 * scale;
  footShadow(ctx, x, y, w * 0.9, p);

  // Древко раньше тела: оно уходит за плечо, а не лежит на груди. Остриё —
  // короткий отрезок другим цветом, а не кружок на конце: кружок читался
  // набалдашником, и ряд таких набалдашников перебивал головы бойцов.
  const sx = x - dir * w * 0.5;
  const sy = y - h * 0.35;
  const ex = x - dir * w * 1.5;
  const ey = y - h * 1.5;
  ctx.strokeStyle = p.shaft;
  ctx.lineWidth = LINE * 1.5;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  ctx.strokeStyle = p.tip;
  ctx.lineWidth = LINE * 1.2;
  ctx.beginPath();
  ctx.moveTo(ex + (sx - ex) * 0.22, ey + (sy - ey) * 0.22);
  ctx.lineTo(ex, ey);
  ctx.stroke();

  // Ноги — две чёрточки: на этом размере они и есть вся походка.
  ctx.strokeStyle = p.line;
  ctx.lineWidth = LINE * 1.6;
  ctx.beginPath();
  ctx.moveTo(x - w * 0.28, y - h * 0.3);
  ctx.lineTo(x - w * 0.42, y);
  ctx.moveTo(x + w * 0.28, y - h * 0.3);
  ctx.lineTo(x + w * 0.42, y);
  ctx.stroke();

  // Плащ: сторона видна на самой большой плоскости бойца.
  ctx.beginPath();
  ctx.moveTo(x - w * 0.55, y - h * 0.28);
  ctx.lineTo(x - w * 0.45, y - h * 0.82);
  ctx.lineTo(x + w * 0.45, y - h * 0.82);
  ctx.lineTo(x + w * 0.55, y - h * 0.28);
  ctx.closePath();
  ctx.fillStyle = p.cloth;
  ctx.fill();
  ctx.strokeStyle = p.line;
  ctx.lineWidth = LINE;
  ctx.stroke();

  // Теневая половина плаща: объём без градиента — градиент дорог и при выпечке.
  ctx.beginPath();
  ctx.moveTo(x + dir * w * 0.12, y - h * 0.28);
  ctx.lineTo(x + dir * w * 0.1, y - h * 0.82);
  ctx.lineTo(x + dir * w * 0.45, y - h * 0.82);
  ctx.lineTo(x + dir * w * 0.55, y - h * 0.28);
  ctx.closePath();
  ctx.fillStyle = p.clothDark;
  ctx.fill();

  // Шлем.
  ctx.beginPath();
  ctx.arc(x, y - h * 0.92, w * 0.36, 0, TAU);
  ctx.fillStyle = p.steel;
  ctx.fill();
  ctx.strokeStyle = p.line;
  ctx.lineWidth = LINE;
  ctx.stroke();
}

/**
 * Знамя: шест и вымпел, и больше ничего. Навершия у него нет нарочно — светлый
 * шарик на верхушке оказывался самой яркой точкой всей картинки и перетягивал
 * взгляд с вымпела, ради которого знамя и стоит.
 *
 * Вымпел смотрит назад, против хода: он и есть самый заметный признак
 * направления — треугольник в четверть клетки виден там, где фигуру уже не
 * разобрать.
 */
function banner(ctx: C, x: number, y: number, h: number, p: PartyPalette, west: boolean): void {
  const dir = west ? -1 : 1;
  ctx.strokeStyle = p.shaft;
  ctx.lineWidth = LINE * 1.8;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y - h);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x, y - h);
  ctx.lineTo(x - dir * h * 0.52, y - h * 0.86);
  ctx.lineTo(x, y - h * 0.66);
  ctx.closePath();
  ctx.fillStyle = p.cloth;
  ctx.fill();
  ctx.strokeStyle = p.line;
  ctx.lineWidth = LINE;
  ctx.stroke();
}

/** Пыль за колонной. Плоскими пятнами, без градиента: он дорог даже при выпечке. */
function dust(ctx: C, x: number, y: number, w: number, p: PartyPalette, west: boolean): void {
  const dir = west ? -1 : 1;
  for (let i = 0; i < 3; i++) {
    const t = (i + 1) / 3;
    ctx.fillStyle = i === 0 ? p.dust : p.dustThin;
    ctx.beginPath();
    ctx.ellipse(x + dir * w * t * 0.85, y - 0.05 * t, w * (0.34 + t * 0.2), w * (0.2 + t * 0.14), 0, 0, TAU);
    ctx.fill();
  }
}

/**
 * Задние ряды орды: тёмная полоса и лес древков над ней.
 *
 * Поштучно столько людей не нарисовать — на сорока пикселях пять фигур и сотня
 * фигур выглядят одинаково, — поэтому число показывается **массой**, тем же
 * приёмом, каким его показывает ролик о бое (см. docs/battle-replay.md). Одной
 * тёмной полосы мало: она сливается с тенью под ногами. Древки над ней и есть
 * то, по чему войско отличается от орды с одного взгляда.
 */
function rear(ctx: C, x: number, y: number, w: number, p: PartyPalette, west: boolean): void {
  const dir = west ? -1 : 1;
  // Древки первыми: они уходят за полосу, а не растут из её середины.
  ctx.strokeStyle = p.shaft;
  ctx.lineWidth = LINE * 1.2;
  ctx.beginPath();
  for (let i = 0; i < 7; i++) {
    const bx = x + dir * (w * 0.5 + (i % 4) * w * 0.22);
    const by = y - 0.1 - (i > 3 ? 0.05 : 0);
    ctx.moveTo(bx, by);
    ctx.lineTo(bx - dir * 0.09, by - 0.44);
  }
  ctx.stroke();

  ctx.fillStyle = p.mass;
  for (let i = 0; i < 8; i++) {
    const row = i < 4 ? 0 : 1;
    const k = i % 4;
    ctx.beginPath();
    ctx.ellipse(
      x + dir * (w * 0.4 + row * w * 0.26) + k * dir * w * 0.18,
      y - 0.08 - row * 0.05,
      w * 0.22,
      w * 0.24,
      0,
      0,
      TAU,
    );
    ctx.fill();
  }
}

/**
 * Донесение: пыль да две неразличимые тени. Ни лиц, ни древков, ни счёта — так
 * оно и приходит от Дозора. Знамя стороны при этом на месте: чей отряд идёт,
 * донесение говорит, а вот сколько их — нет.
 */
function rumour(ctx: C, p: PartyPalette, west: boolean): void {
  const dir = west ? -1 : 1;
  // Облако шире и гуще, чем у идущей колонны: от донесения только оно и
  // остаётся. Тени сидят внутри него, а не перед ним.
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    ctx.fillStyle = i % 2 === 0 ? p.dust : p.dustThin;
    ctx.beginPath();
    ctx.ellipse(dir * (0.16 - t * 0.5), -0.12 - t * 0.06, 0.2 + t * 0.1, 0.15 + t * 0.07, 0, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = p.mass;
  for (let i = 0; i < 2; i++) {
    ctx.beginPath();
    ctx.ellipse(dir * (0.12 - i * 0.2), -0.13 + i * 0.02, 0.1, 0.17, 0, 0, TAU);
    ctx.fill();
  }
  // Ещё слой пыли — поверх теней. Без него они выходят чёткими, а вся мысль
  // донесения ровно в том, что разобрать их нельзя.
  ctx.fillStyle = p.dust;
  for (let i = 0; i < 2; i++) {
    ctx.beginPath();
    ctx.ellipse(dir * (0.14 - i * 0.24), -0.11, 0.19, 0.15, 0, 0, TAU);
    ctx.fill();
  }
  banner(ctx, dir * 0.4, 0.02, 0.46, p, west);
}

/** Шатры лагеря: он стоит, а не идёт, и по силуэту это должно быть видно сразу. */
function camp(ctx: C, p: PartyPalette, size: PartySize): void {
  const tents = size === 'small' ? 2 : 3;
  for (let i = 0; i < tents; i++) {
    const x = (i - (tents - 1) / 2) * 0.36;
    const y = (i % 2) * 0.07;
    const w = 0.19;
    const h = 0.3;
    footShadow(ctx, x, y, w, p);
    ctx.beginPath();
    ctx.moveTo(x - w, y);
    ctx.lineTo(x, y - h);
    ctx.lineTo(x + w, y);
    ctx.closePath();
    ctx.fillStyle = p.tent;
    ctx.fill();
    ctx.strokeStyle = p.line;
    ctx.lineWidth = LINE;
    ctx.stroke();
    // Тёмный скат: без него шатёр читается плоским треугольником.
    ctx.beginPath();
    ctx.moveTo(x, y - h);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w * 0.3, y);
    ctx.closePath();
    ctx.fillStyle = p.tentDark;
    ctx.fill();
  }
  // Костёр посреди лагеря: единственное тёплое пятно, по нему его и находят.
  ctx.fillStyle = p.fire;
  ctx.beginPath();
  ctx.ellipse(0, 0.16, 0.055, 0.035, 0, 0, TAU);
  ctx.fill();
  banner(ctx, -0.46, 0.03, 0.5, p, false);
}

// ---------- Выпечка ----------

export function bakeParty(look: PartyLook, cell: number, dpr: number): PartySprite {
  const w = SPAN_W * cell;
  const h = SPAN_H * cell;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * dpr));
  canvas.height = Math.max(1, Math.round(h * dpr));
  const ctx = canvas.getContext('2d');
  const sprite: PartySprite = { canvas, w, h, ax: ANCHOR_X * cell, ay: ANCHOR_Y * cell, cell };
  if (!ctx) return sprite;

  // Дальше всё в долях клетки: формы не зависят ни от корзины, ни от dpr.
  const u = cell * dpr;
  ctx.setTransform(u, 0, 0, u, ANCHOR_X * u, ANCHOR_Y * u);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const p = palOf(look.side);
  if (look.shape === 'camp') {
    camp(ctx, p, look.size);
    return sprite;
  }
  if (look.size === 'rumor') {
    rumour(ctx, p, look.west);
    return sprite;
  }

  const dir = look.west ? -1 : 1;
  const men = MEN_SHOWN[look.size];
  dust(ctx, 0, 0, men >= 5 ? 0.4 : 0.28, p, look.west);
  if (hasRear(look.size)) rear(ctx, 0, 0, 0.42, p, look.west);

  // Знамя впереди колонны: знаменосец её ведёт, а не плетётся сзади. Крупнее у
  // большого отряда — это второй признак массы после числа фигур. Отступ мал
  // нарочно: пустое место между знаменем и людьми читается двумя предметами, а
  // не одним отрядом.
  banner(ctx, dir * (men === 1 ? 0.3 : 0.46), 0.03, men >= 5 ? 0.6 : 0.46, p, look.west);

  // Фигуры от дальних к ближним: задние не перекрывают передних.
  const spots: [number, number][] =
    men === 1
      ? [[0, 0]]
      : men === 3
        ? [
            [0.16, -0.07],
            [-0.16, -0.03],
            [0.02, 0.06],
          ]
        : [
            [0.3, -0.1],
            [0.02, -0.06],
            [-0.24, -0.02],
            [0.16, 0.06],
            [-0.1, 0.09],
          ];
  const ordered = [...spots].sort((a, b) => a[1] - b[1]);
  // Колонна сдвинута назад от знамени: точка привязки остаётся серединой отряда,
  // а не серединой пустого холста.
  for (const [ox, oy] of ordered) man(ctx, dir * (ox - 0.16), oy, p, look.west, men === 1 ? 1.1 : 1);
  return sprite;
}

// ---------- Кэш ----------

const cache = new Map<string, PartySprite>();
/**
 * Больше на экране всё равно не бывает: мир держит один чужой отряд на деревню,
 * один мимо неё и по одному на выручку осаждённым — с фигурами и своими это
 * немного движущихся вещей на весь кадр (худший случай мира — `npm run map:report`,
 * раздел «сколько людей ходит по карте»).
 */
const CACHE_MAX = 16;

export function partySprite(look: PartyLook, px: number, dpr: number): PartySprite {
  const bucket = partyBucket(px);
  const key = partyKey(look, bucket, dpr);
  const have = cache.get(key);
  if (have) {
    cache.delete(key);
    cache.set(key, have);
    return have;
  }
  const sprite = bakeParty(look, bucket, dpr);
  cache.set(key, sprite);
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return sprite;
}

export function dropParties(): void {
  cache.clear();
  noses.clear();
}

/** Кадр: одно копирование. cx, cy — где отряд стоит на земле, в CSS-пикселях. */
export function drawParty(ctx: C, look: PartyLook, px: number, dpr: number, cx: number, cy: number): void {
  const sp = partySprite(look, px, dpr);
  const k = px / sp.cell;
  ctx.drawImage(sp.canvas, cx - sp.ax * k, cy - sp.ay * k, sp.w * k, sp.h * k);
}

// ---------- Наконечник хода ----------

/**
 * Куда идёт — острым углом. Это единственное, что рисуется на **любом** масштабе:
 * пиксельный обзор отвечает на вопрос «где чьи силы», и отряд обязан быть на нём
 * виден так же, как поселение видно точкой. Колонна поверх него проявляется по
 * приближению — тем же переливом, что и вся нарисованная земля.
 *
 * Печётся раз на сторону и поворачивается при копировании: путь в кадре не
 * строится, а поворот `drawImage` не считает ни одной вершины.
 */
const NOSE = 24;
const noses = new Map<string, HTMLCanvasElement>();

export function headingSprite(side: PartySide, dpr: number): HTMLCanvasElement {
  const key = `${side}|${dpr}`;
  const have = noses.get(key);
  if (have) return have;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = Math.max(1, Math.round(NOSE * dpr));
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const p = palOf(side);
    const u = (NOSE * dpr) / 2;
    ctx.setTransform(u, 0, 0, u, u, u);
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(0.9, 0);
    ctx.lineTo(-0.6, 0.64);
    ctx.lineTo(-0.28, 0);
    ctx.lineTo(-0.6, -0.64);
    ctx.closePath();
    ctx.fillStyle = p.cloth;
    ctx.fill();
    ctx.strokeStyle = p.line;
    ctx.lineWidth = 0.11;
    ctx.stroke();
  }
  noses.set(key, canvas);
  return canvas;
}

export function drawHeading(
  ctx: C,
  side: PartySide,
  dpr: number,
  cx: number,
  cy: number,
  angle: number,
  size: number,
): void {
  const sprite = headingSprite(side, dpr);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.drawImage(sprite, -size, -size, size * 2, size * 2);
  ctx.restore();
}
