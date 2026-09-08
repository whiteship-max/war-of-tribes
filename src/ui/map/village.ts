// Поселения на близкой карте: силуэт по стадии, флаг по отношению, метки состояния.
//
// Правило кадра: во время перетаскивания поселение стоит ровно один drawImage.
// Все пути (дома, стена, флаг, площадка) рисуются один раз в свой холст и дальше
// только копируются, поэтому здесь строго разделено:
//   * чистая часть (STAGE_SHAPE, layout, pickBucket, spriteKey) — без canvas, её проверяет тест;
//   * выпечка (bakeSettlement) — вызывается на смене стадии, отношения или корзины размера;
//   * кадр (drawSettlement, drawMarkers) — только drawImage и три точки состояния.
//
// Принадлежность показывает флаг, а не цвет домов: цвет крыш — это материал
// (жерди, солома, камень), по нему читается стадия. Перекрасить дома в цвет
// племени значит стереть стадию, а стадия — главный вопрос игрока к чужой точке.
import { RELATION_META } from '@/world/data/meta';
import type { Relation, Stage } from '@/world/types';
import { ASH, EARTH, OWN, PAL_HIDE, PAL_STONE, PAL_WOOD, PROPS, RAMPART, type BuildPalette } from './palette';

type C = CanvasRenderingContext2D;

const TAU = Math.PI * 2;
/** Сплющивание по вертикали: карта смотрит на землю почти сверху, но не строго. */
const SQUASH = 0.62;
/** Толщина контуров в долях клетки. Контур держит силуэт на мелком масштабе. */
const LINE = 0.024;

// ---------- Чистая часть: её можно считать без canvas ----------

export type PlaceKind = 'lean' | 'hut' | 'hall' | 'tent' | 'keep';
export type RingKind = 'none' | 'palisade' | 'stone' | 'thorn';

/** Постройка внутри поселения: середина основания и габариты, всё в долях клетки. */
export interface Place {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: PlaceKind;
}

export interface StageShape {
  /** Радиус расчищенной земли в клетках: поселение растёт вширь, а не только вверх. */
  clear: number;
  /** Сколько построек в кучке. */
  count: number;
  /** Ограда — главный признак силуэта на 48 px. */
  ring: RingKind;
}

/**
 * Стадия читается силуэтом, а не иконкой: редкие навесы → кучка домов →
 * кучка в зубчатом кольце частокола → плотная застройка в толстой стене с башнями.
 */
export const STAGE_SHAPE: Record<Stage, StageShape> = {
  camp: { clear: 0.62, count: 3, ring: 'none' },
  village: { clear: 0.84, count: 5, ring: 'none' },
  stronghold: { clear: 1.02, count: 7, ring: 'palisade' },
  town: { clear: 1.22, count: 10, ring: 'stone' },
};

/**
 * Замок — не пятая стадия, а вторая ось: крепость с казной бывает при любой
 * стадии, и мир задаёт её отдельным полем (`SettlementView.castle`). Поэтому в
 * `STAGE_SHAPE` его нет, а силуэт он меняет двумя правками поверх стадии —
 * донжоном в середине и каменной стеной, чем бы стадия ни была.
 *
 * Это не украшение. Замок вдвое сильнее обычного соседа и держит гарнизон у
 * стены (`CASTLE_POWER`, `styleOf`), а стадию мир считает по мощи и населению —
 * так что замок на стадии деревни выглядел бы кучкой хижин без ограды, и
 * картинка обещала бы лёгкую цель там, где стоит крепость.
 */
export function ringOf(stage: Stage, barbarian: boolean, castle = false): RingKind {
  // Варвары живут в шалашах, замков у них не бывает (`gen.ts`), но случись
  // такой — стены он всё равно не получит: терновая дуга у них вместо неё.
  if (barbarian) return stage === 'camp' ? 'none' : 'thorn';
  if (castle) return 'stone';
  return STAGE_SHAPE[stage].ring;
}

/**
 * Радиус двора. Замку нужно место под кольцо стены с башнями, поэтому меньше
 * укреплённого поселения его двор не бывает. Верх не растёт: город с замком
 * остаётся городом по размеру, иначе двор перерос бы вырубку (`TREE_FREE_R`).
 */
export const clearRadius = (stage: Stage, castle = false): number =>
  castle ? Math.max(STAGE_SHAPE[stage].clear, STAGE_SHAPE.stronghold.clear) : STAGE_SHAPE[stage].clear;

/** Детерминированный генератор: один и тот же вариант всегда даёт ту же расстановку. */
function rng(seed: number): () => number {
  let s = (seed | 0) || 1;
  return () => {
    s = Math.imul(s ^ (s >>> 15), 0x2c1b3c6d);
    s ^= s >>> 13;
    s = Math.imul(s, 0x297a2d39);
    s ^= s >>> 16;
    return (s >>> 0) / 4294967296;
  };
}

/** Вариант силуэта по идентификатору поселения: соседние деревни не должны быть близнецами. */
export function variantOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 3;
}

/**
 * Расстановка построек. Кольцо вокруг главного дома, углы с разбросом — кучка
 * должна выглядеть выросшей, а не расставленной по циркулю. Сортировка по y —
 * порядок художника: дальние дома рисуются раньше ближних.
 */
export function layout(stage: Stage, barbarian: boolean, variant: number, castle = false): Place[] {
  const sh = STAGE_SHAPE[stage];
  const rnd = rng(variant * 7919 + sh.count * 31 + (barbarian ? 101 : 7) + (castle ? 613 : 0));
  const ring = ringOf(stage, barbarian, castle);
  const walled = ring === 'palisade' || ring === 'stone';
  const inner = clearRadius(stage, castle) * (walled ? 0.56 : 0.70);
  const kind: PlaceKind = barbarian ? 'tent' : stage === 'camp' ? 'lean' : 'hut';
  const out: Place[] = [];

  // В середине — главный дом, а у замка донжон: он вдвое выше хижины и торчит
  // над стеной, поэтому замок читается даже там, где стадия ещё лагерь.
  const center: PlaceKind | null = castle && !barbarian ? 'keep' : !barbarian && (stage === 'stronghold' || stage === 'town') ? 'hall' : null;
  if (center === 'keep') out.push({ x: 0, y: -inner * 0.1, w: 0.4, h: 0.98, kind: 'keep' });
  else if (center === 'hall') out.push({ x: 0, y: -inner * 0.12, w: 0.42, h: 0.62, kind: 'hall' });

  const hall = center !== null;
  const n = sh.count - (hall ? 1 : 0);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + variant * 0.7 + (rnd() - 0.5) * 0.6;
    const rad = inner * (hall ? 0.74 + rnd() * 0.2 : 0.5 + rnd() * 0.5);
    const w = (kind === 'lean' ? 0.30 : 0.25) + rnd() * 0.08;
    out.push({
      x: Math.cos(a) * rad,
      y: Math.sin(a) * rad * SQUASH,
      w,
      h: w * (kind === 'lean' ? 0.66 : kind === 'tent' ? 1.18 : 1.24),
      kind,
    });
  }
  out.sort((a, b) => a.y - b.y);
  return out;
}

/**
 * Корзины размера. Щипок меняет масштаб непрерывно, а выпечка дорогая, поэтому
 * спрайт печётся на ближайшей корзине сверху и растягивается копированием:
 * разница до 30 % на рисованной картинке незаметна, а перепечёк за кадр — нет.
 */
export const BUCKETS: number[] = [22, 30, 40, 52, 64];

export function pickBucket(px: number): number {
  for (const b of BUCKETS) if (b >= px) return b;
  return BUCKETS[BUCKETS.length - 1];
}

export interface Look {
  stage: Stage;
  relation: Relation;
  mine: boolean;
  variant: number;
  /** Крепость с казной. Не стадия: бывает при любой (см. `ringOf`). */
  castle: boolean;
  /**
   * Пепелище на месте сожжённого логова. Не стадия и не отношение: это след, и
   * рисуется он вместо поселения целиком — ни домов, ни ограды, ни флага.
   * Победа игрока обязана быть видна на карте, а не только в отчёте.
   */
  ruin: boolean;
}

/**
 * Ключ кэша. Отношение входит в него потому, что от него зависит флаг, `mine` —
 * потому что своё поселение выпекается с подсветкой и вторым вымпелом, а замок —
 * потому что меняет и кольцо, и середину двора. Забыть здесь поле значит выдать
 * замку спрайт обычного соседа той же стадии, и молча.
 */
export const spriteKey = (look: Look, bucket: number, dpr: number): string =>
  `${look.stage}|${look.relation}|${look.mine ? 1 : 0}|${look.castle ? 1 : 0}|${look.ruin ? 1 : 0}|${look.variant}|${bucket}|${dpr}`;

// ---------- Габариты спрайта ----------

/**
 * Спрайт занимает 3×2.6 клетки, точка привязки — центр клетки (единственное, что
 * на этой карте выровнено по сетке). Вверх места больше: там крыши и флаг.
 */
const SPAN_W = 3.0;
const SPAN_H = 2.6;
const ANCHOR_X = 1.5;
const ANCHOR_Y = 1.62;

export interface Sprite {
  canvas: HTMLCanvasElement;
  /** Размеры в CSS-пикселях при своей корзине. */
  w: number;
  h: number;
  /** Точка спрайта, которая ложится ровно на центр клетки. */
  ax: number;
  ay: number;
  /** Клетка, под которую он выпечен. */
  cell: number;
}

// ---------- Кисти ----------

function outline(ctx: C, p: BuildPalette): void {
  ctx.strokeStyle = p.line;
  ctx.lineWidth = LINE;
  ctx.stroke();
}

/** Тень на земле: пятно под постройкой, без него дома «висят». */
function shadow(ctx: C, x: number, y: number, w: number): void {
  ctx.fillStyle = EARTH.shadow;
  ctx.beginPath();
  ctx.ellipse(x + w * 0.08, y + w * 0.05, w * 0.62, w * 0.2, 0, 0, TAU);
  ctx.fill();
}

/** Хижина: стена и двускатная крыша. y — линия земли, h — полная высота. */
function hut(ctx: C, x: number, y: number, w: number, h: number, p: BuildPalette): void {
  const bh = h * 0.42;
  const eave = w * 0.14;
  shadow(ctx, x, y, w);

  ctx.beginPath();
  ctx.rect(x - w / 2, y - bh, w, bh);
  ctx.fillStyle = p.wall;
  ctx.fill();
  outline(ctx, p);
  ctx.fillStyle = p.wallDark;
  ctx.fillRect(x + w * 0.12, y - bh, w * 0.38, bh);

  ctx.beginPath();
  ctx.moveTo(x - w / 2 - eave, y - bh);
  ctx.lineTo(x, y - h);
  ctx.lineTo(x + w / 2 + eave, y - bh);
  ctx.closePath();
  ctx.fillStyle = p.roof;
  ctx.fill();
  outline(ctx, p);

  // Дальний скат: объём одной заливкой, без градиента.
  ctx.beginPath();
  ctx.moveTo(x, y - h);
  ctx.lineTo(x + w / 2 + eave, y - bh);
  ctx.lineTo(x + w * 0.1, y - bh);
  ctx.closePath();
  ctx.fillStyle = p.roofDark;
  ctx.fill();
}

/** Навес лагеря: один скат на двух жердях. Низкий — этим лагерь и отличается. */
function lean(ctx: C, x: number, y: number, w: number, h: number, p: BuildPalette): void {
  shadow(ctx, x, y, w);
  ctx.beginPath();
  ctx.moveTo(x - w / 2, y);
  ctx.lineTo(x - w * 0.18, y - h);
  ctx.lineTo(x + w / 2, y - h * 0.28);
  ctx.lineTo(x + w / 2, y);
  ctx.closePath();
  ctx.fillStyle = p.roof;
  ctx.fill();
  outline(ctx, p);

  ctx.strokeStyle = PROPS.pole;
  ctx.lineWidth = LINE * 1.4;
  ctx.beginPath();
  ctx.moveTo(x - w * 0.18, y - h);
  ctx.lineTo(x - w * 0.18, y);
  ctx.stroke();
}

/** Главный дом: длинный сруб с коньком. Один на поселение — он и делает «центр». */
function hall(ctx: C, x: number, y: number, w: number, h: number, p: BuildPalette): void {
  const bh = h * 0.46;
  shadow(ctx, x, y, w);

  ctx.beginPath();
  ctx.rect(x - w / 2, y - bh, w, bh);
  ctx.fillStyle = p.wall;
  ctx.fill();
  outline(ctx, p);
  ctx.fillStyle = p.wallDark;
  ctx.fillRect(x + w * 0.1, y - bh, w * 0.4, bh);

  ctx.beginPath();
  ctx.moveTo(x - w * 0.62, y - bh);
  ctx.lineTo(x - w * 0.22, y - h);
  ctx.lineTo(x + w * 0.22, y - h);
  ctx.lineTo(x + w * 0.62, y - bh);
  ctx.closePath();
  ctx.fillStyle = p.roof;
  ctx.fill();
  outline(ctx, p);

  ctx.strokeStyle = p.roofDark;
  ctx.lineWidth = LINE * 1.6;
  ctx.beginPath();
  ctx.moveTo(x - w * 0.22, y - h);
  ctx.lineTo(x + w * 0.22, y - h);
  ctx.stroke();
}

/**
 * Донжон замка: высокая квадратная башня с зубцами. Единственная постройка, чей
 * материал не зависит от стадии — она всегда каменная, как и кольцо вокруг:
 * замок на стадии деревни должен спорить с хижинами вокруг, а не сливаться.
 *
 * Зубчатый верх сделан четырьмя мерлонами, а не восемью: на нижней корзине
 * (22 px на клетку) башня выходит около двадцати пикселей, и восемь зубцов
 * слиплись бы в ровную линию — то есть в обычную крышу.
 */
function keep(ctx: C, x: number, y: number, w: number, h: number): void {
  const p = PAL_STONE;
  const top = y - h;
  shadow(ctx, x, y, w);

  ctx.beginPath();
  ctx.rect(x - w / 2, top, w, h);
  ctx.fillStyle = p.wall;
  ctx.fill();
  outline(ctx, p);
  // Теневая половина: объём одной заливкой, как у прочих построек.
  ctx.fillStyle = p.wallDark;
  ctx.fillRect(x + w * 0.08, top, w * 0.42, h);

  // Зубцы поверх корпуса.
  const m = w / 7;
  for (const i of [0, 2, 4, 6]) {
    ctx.beginPath();
    ctx.rect(x - w / 2 + i * m, top - m, m, m);
    ctx.fillStyle = i >= 4 ? p.wallDark : p.wall;
    ctx.fill();
    outline(ctx, p);
  }

  // Поясок и проём ворот: без них башня читается пустым столбом.
  ctx.fillStyle = p.roofDark;
  ctx.fillRect(x - w / 2, top + h * 0.3, w, LINE * 1.6);
  ctx.fillStyle = RAMPART.gate;
  ctx.beginPath();
  ctx.moveTo(x - w * 0.13, y);
  ctx.lineTo(x - w * 0.13, y - h * 0.2);
  ctx.quadraticCurveTo(x, y - h * 0.3, x + w * 0.13, y - h * 0.2);
  ctx.lineTo(x + w * 0.13, y);
  ctx.closePath();
  ctx.fill();
}

/** Шатёр варваров: шкура на жердях, жерди торчат крестом наружу. */
function tent(ctx: C, x: number, y: number, w: number, h: number, p: BuildPalette): void {
  shadow(ctx, x, y, w);
  ctx.strokeStyle = PROPS.pole;
  ctx.lineWidth = LINE * 1.2;
  ctx.beginPath();
  ctx.moveTo(x - w * 0.22, y - h * 1.18);
  ctx.lineTo(x + w * 0.16, y - h * 0.5);
  ctx.moveTo(x + w * 0.22, y - h * 1.18);
  ctx.lineTo(x - w * 0.16, y - h * 0.5);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x - w / 2, y);
  ctx.lineTo(x - w * 0.16, y - h);
  ctx.lineTo(x + w * 0.16, y - h);
  ctx.lineTo(x + w / 2, y);
  // Рваный низ: полог не подрублен, и это видно.
  ctx.lineTo(x + w * 0.18, y - h * 0.08);
  ctx.lineTo(x, y);
  ctx.lineTo(x - w * 0.2, y - h * 0.09);
  ctx.closePath();
  ctx.fillStyle = p.roof;
  ctx.fill();
  outline(ctx, p);

  ctx.beginPath();
  ctx.moveTo(x + w * 0.16, y - h);
  ctx.lineTo(x + w / 2, y);
  ctx.lineTo(x + w * 0.18, y - h * 0.08);
  ctx.closePath();
  ctx.fillStyle = p.roofDark;
  ctx.fill();
}

/** Костёр: у варваров он всегда горит и всегда в середине стоянки. */
function campfire(ctx: C, x: number, y: number, s: number): void {
  ctx.fillStyle = PROPS.wood;
  ctx.beginPath();
  ctx.ellipse(x, y, s * 0.9, s * 0.42, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = PROPS.fire;
  ctx.beginPath();
  ctx.moveTo(x - s * 0.5, y);
  ctx.quadraticCurveTo(x - s * 0.22, y - s * 1.1, x, y - s * 1.7);
  ctx.quadraticCurveTo(x + s * 0.28, y - s * 1.0, x + s * 0.5, y);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = PROPS.fireCore;
  ctx.beginPath();
  ctx.moveTo(x - s * 0.2, y);
  ctx.quadraticCurveTo(x - s * 0.05, y - s * 0.6, x + s * 0.04, y - s * 0.95);
  ctx.quadraticCurveTo(x + s * 0.16, y - s * 0.5, x + s * 0.22, y);
  ctx.closePath();
  ctx.fill();
}

/** Череп на шесте: знак варварской стоянки, читается даже силуэтом. */
function skullStake(ctx: C, x: number, y: number, h: number): void {
  ctx.strokeStyle = PROPS.pole;
  ctx.lineWidth = LINE * 1.4;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y - h);
  ctx.stroke();
  ctx.fillStyle = PROPS.bone;
  ctx.beginPath();
  ctx.arc(x, y - h - 0.05, 0.058, 0, TAU);
  ctx.fill();
  ctx.fillStyle = PAL_HIDE.line;
  ctx.fillRect(x - 0.038, y - h - 0.07, 0.024, 0.026);
  ctx.fillRect(x + 0.014, y - h - 0.07, 0.024, 0.026);
}

/** Частокол: кольцо кольев. Зубчатый край — половина узнавания укреплённого поселения. */
function palisadeRing(ctx: C, rx: number): void {
  const ry = rx * SQUASH;
  const n = 34;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const x = Math.cos(a) * rx;
    const y = Math.sin(a) * ry;
    // Дальняя половина темнее: кольцо не должно выглядеть плоским обручем.
    ctx.fillStyle = y < 0 ? RAMPART.palisadeDark : RAMPART.palisade;
    ctx.beginPath();
    ctx.moveTo(x - 0.026, y);
    ctx.lineTo(x - 0.026, y - 0.15);
    ctx.lineTo(x, y - 0.19);
    ctx.lineTo(x + 0.026, y - 0.15);
    ctx.lineTo(x + 0.026, y);
    ctx.closePath();
    ctx.fill();
  }
  // Ворота: просвет внизу, к нему подходит дорога.
  ctx.fillStyle = RAMPART.gate;
  ctx.fillRect(-0.09, ry - 0.06, 0.18, 0.1);
}

/** Каменная стена города: сплошное тёмное кольцо, четыре башни и проём ворот. */
function stoneRing(ctx: C, rx: number): void {
  const ry = rx * SQUASH;
  const t = 0.13;
  const gate = 0.16 * Math.PI;
  const a0 = Math.PI / 2 + gate;
  const a1 = Math.PI / 2 - gate + TAU;

  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, a0, a1);
  ctx.ellipse(0, 0, rx - t, ry - t * 0.8, 0, a1, a0, true);
  ctx.closePath();
  ctx.fillStyle = RAMPART.stone;
  ctx.fill();
  ctx.strokeStyle = RAMPART.stoneDark;
  ctx.lineWidth = LINE;
  ctx.stroke();

  for (const a of [Math.PI * 0.18, Math.PI * 0.82, Math.PI * 1.26, Math.PI * 1.74]) {
    const x = Math.cos(a) * rx;
    const y = Math.sin(a) * ry;
    ctx.fillStyle = RAMPART.stone;
    ctx.beginPath();
    ctx.rect(x - 0.1, y - 0.24, 0.2, 0.3);
    ctx.fill();
    ctx.strokeStyle = RAMPART.stoneDark;
    ctx.lineWidth = LINE;
    ctx.stroke();
    // Зубцы: две выемки сверху, по ним башня и опознаётся.
    ctx.fillStyle = RAMPART.stoneDark;
    ctx.fillRect(x - 0.04, y - 0.24, 0.03, 0.06);
    ctx.fillRect(x + 0.05, y - 0.24, 0.03, 0.06);
  }

  ctx.fillStyle = RAMPART.gate;
  ctx.beginPath();
  ctx.rect(-0.12, ry - t * 0.9, 0.24, t * 1.1);
  ctx.fill();
}

/** Терновая загородка варваров: кривая незамкнутая дуга, никакой правильной стены. */
function thornArc(ctx: C, rx: number, rnd: () => number): void {
  const ry = rx * SQUASH;
  ctx.strokeStyle = RAMPART.thorn;
  ctx.lineWidth = LINE * 1.6;
  for (let i = 0; i < 16; i++) {
    const a = Math.PI * 1.06 + (i / 15) * Math.PI * 0.86;
    const x = Math.cos(a) * rx;
    const y = Math.sin(a) * ry;
    const lean = (rnd() - 0.5) * 0.16;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + lean, y - 0.16 - rnd() * 0.06);
    ctx.stroke();
  }
}

/** Расчищенная земля: неровное пятно с крапом. Радиус растёт со стадией. */
function clearing(ctx: C, r: number, rnd: () => number): void {
  const n = 14;
  const rad: number[] = [];
  for (let i = 0; i < n; i++) rad.push(r * (0.9 + rnd() * 0.2));
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const a = ((i % n) / n) * TAU;
    const k = rad[i % n];
    const x = Math.cos(a) * k;
    const y = Math.sin(a) * k * SQUASH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = EARTH.base;
  ctx.fill();
  ctx.strokeStyle = EARTH.edge;
  ctx.lineWidth = LINE * 2;
  ctx.stroke();

  ctx.fillStyle = EARTH.speck;
  for (let i = 0; i < 18; i++) {
    const a = rnd() * TAU;
    const k = r * Math.sqrt(rnd()) * 0.92;
    ctx.beginPath();
    ctx.ellipse(Math.cos(a) * k, Math.sin(a) * k * SQUASH, 0.05, 0.022, 0, 0, TAU);
    ctx.fill();
  }
}

/** Пашня: полосы за краем площадки. Появляется с деревни — лагерь ещё не пашет. */
function fields(ctx: C, r: number, rnd: () => number): void {
  for (let i = 0; i < 3; i++) {
    const x = r * (0.85 + i * 0.2);
    const y = r * SQUASH * (0.25 + rnd() * 0.35);
    ctx.fillStyle = EARTH.field;
    ctx.beginPath();
    ctx.ellipse(x, y, 0.16, 0.09, -0.3, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = EARTH.fieldLine;
    ctx.lineWidth = LINE;
    ctx.beginPath();
    ctx.moveTo(x - 0.13, y - 0.02);
    ctx.lineTo(x + 0.13, y - 0.05);
    ctx.stroke();
  }
}

/**
 * Флаг владельца: шест и вымпел цвета отношения. Своё поселение получает флаг
 * выше и второй вымпел — свою точку игрок должен находить не читая.
 */
export function flag(ctx: C, x: number, y: number, color: string, own: boolean): void {
  const h = own ? 0.86 : 0.62;
  const bw = own ? 0.3 : 0.24;
  const bh = own ? 0.26 : 0.2;

  ctx.strokeStyle = PROPS.pole;
  ctx.lineWidth = LINE * 1.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y - h);
  ctx.stroke();

  const pennant = (top: number, k: number): void => {
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x + bw * k, top + bh * k * 0.18);
    ctx.lineTo(x + bw * k * 0.68, top + bh * k * 0.5);
    ctx.lineTo(x + bw * k, top + bh * k * 0.84);
    ctx.lineTo(x, top + bh * k);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(20, 15, 10, 0.8)';
    ctx.lineWidth = LINE;
    ctx.stroke();
  };

  pennant(y - h, 1);
  if (own) pennant(y - h * 0.52, 0.62);

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y - h - 0.03, own ? 0.045 : 0.034, 0, TAU);
  ctx.fill();
}

/**
 * Пепелище: выжженное пятно, головни от шалашей и обугленный шест. Ни огня, ни
 * флага, ни ограды — по силуэту должно читаться, что тут кончилось, а не идёт.
 */
function ashes(ctx: C, r: number, rnd: () => number): void {
  const n = 14;
  const rad: number[] = [];
  for (let i = 0; i < n; i++) rad.push(r * (0.88 + rnd() * 0.2));
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const a = ((i % n) / n) * TAU;
    const k = rad[i % n];
    const x = Math.cos(a) * k;
    const y = Math.sin(a) * k * SQUASH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = ASH.ground;
  ctx.fill();
  ctx.strokeStyle = ASH.edge;
  ctx.lineWidth = LINE * 2;
  ctx.stroke();

  // Пятна остывшего пепла.
  ctx.fillStyle = ASH.ash;
  for (let i = 0; i < 12; i++) {
    const a = rnd() * TAU;
    const k = r * Math.sqrt(rnd()) * 0.9;
    ctx.beginPath();
    ctx.ellipse(Math.cos(a) * k, Math.sin(a) * k * SQUASH, 0.07, 0.03, 0, 0, TAU);
    ctx.fill();
  }

  // Головни: обломки жердей, торчащие под разными углами. Три штуки — больше на
  // 22 px сливаются в кляксу.
  ctx.lineCap = 'round';
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + 0.4;
    const k = r * (0.3 + rnd() * 0.45);
    const x = Math.cos(a) * k;
    const y = Math.sin(a) * k * SQUASH;
    const h = 0.14 + rnd() * 0.14;
    ctx.strokeStyle = i % 2 === 0 ? ASH.char : ASH.charLight;
    ctx.lineWidth = LINE * (1.6 + rnd());
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rnd() - 0.5) * 0.2, y - h);
    ctx.stroke();
  }
}

// ---------- Выпечка и кэш ----------

const cache = new Map<string, Sprite>();
/** Больше на экране всё равно не бывает: при переполнении вылетает самый старый. */
const CACHE_MAX = 16;

function paletteOf(look: Look): BuildPalette {
  if (look.relation === 'barbarian') return PAL_HIDE;
  return look.stage === 'town' ? PAL_STONE : PAL_WOOD;
}

export function bakeSettlement(look: Look, cell: number, dpr: number): Sprite {
  const w = SPAN_W * cell;
  const h = SPAN_H * cell;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * dpr));
  canvas.height = Math.max(1, Math.round(h * dpr));
  const ctx = canvas.getContext('2d');
  const sprite: Sprite = { canvas, w, h, ax: ANCHOR_X * cell, ay: ANCHOR_Y * cell, cell };
  if (!ctx) return sprite;

  // Дальше всё считается в долях клетки: код форм не зависит ни от корзины, ни от dpr.
  const u = cell * dpr;
  ctx.setTransform(u, 0, 0, u, ANCHOR_X * u, ANCHOR_Y * u);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const barbarian = look.relation === 'barbarian';
  const p = paletteOf(look);
  const r = clearRadius(look.stage, look.castle);
  const rnd = rng(look.variant * 104729 + look.stage.length * 13 + (barbarian ? 5 : 1) + (look.castle ? 37 : 0));

  // Пепелище рисуется вместо всего остального и раньше всего остального: у него
  // нет ни стадии, ни ограды, ни флага, и подмешивать их сюда нечего.
  if (look.ruin) {
    ashes(ctx, r, rnd);
    return sprite;
  }

  // Своё поселение подсвечено тёплым пятном под землёй: без ctx.filter, обычным
  // радиальным градиентом — он есть везде.
  if (look.mine) {
    const g = ctx.createRadialGradient(0, 0, r * 0.4, 0, 0, r * 2.0);
    g.addColorStop(0, OWN.glow);
    g.addColorStop(1, OWN.glowOut);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 2.0, r * 2.0 * SQUASH, 0, 0, TAU);
    ctx.fill();
  }

  clearing(ctx, r, rnd);
  if (look.stage !== 'camp' && !barbarian) fields(ctx, r, rnd);

  if (look.mine) {
    // Светлый ободок по краю площадки — третий признак своего, помимо свечения и флага.
    ctx.strokeStyle = OWN.rim;
    ctx.lineWidth = LINE * 1.6;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.04, r * 1.04 * SQUASH, 0, 0, TAU);
    ctx.stroke();
  }

  const ring = ringOf(look.stage, barbarian, look.castle);
  // Кольцо рисуется до домов: его дальняя половина должна уходить за крыши.
  if (ring === 'palisade') palisadeRing(ctx, r * 0.86);
  if (ring === 'stone') stoneRing(ctx, r * 0.86);
  if (ring === 'thorn') thornArc(ctx, r * 0.9, rnd);

  if (barbarian) campfire(ctx, 0, r * SQUASH * 0.15, 0.13);

  for (const b of layout(look.stage, barbarian, look.variant, look.castle)) {
    if (b.kind === 'lean') lean(ctx, b.x, b.y, b.w, b.h, p);
    else if (b.kind === 'tent') tent(ctx, b.x, b.y, b.w, b.h, p);
    else if (b.kind === 'hall') hall(ctx, b.x, b.y, b.w, b.h, p);
    else if (b.kind === 'keep') keep(ctx, b.x, b.y, b.w, b.h);
    else hut(ctx, b.x, b.y, b.w, b.h, p);
  }

  if (barbarian) skullStake(ctx, -r * 0.78, r * SQUASH * 0.42, 0.34);

  // Флаг последним: его не должна закрывать ни одна крыша.
  flag(ctx, r * 0.74, r * SQUASH * 0.3, RELATION_META[look.relation].color, look.mine);
  return sprite;
}

/** Спрайт из кэша; печётся только на смене стадии, отношения, варианта или корзины. */
export function settlementSprite(look: Look, px: number, dpr: number): Sprite {
  const bucket = pickBucket(px);
  const key = spriteKey(look, bucket, dpr);
  const have = cache.get(key);
  if (have) {
    cache.delete(key);
    cache.set(key, have);
    return have;
  }
  const sprite = bakeSettlement(look, bucket, dpr);
  cache.set(key, sprite);
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return sprite;
}

export function dropSprites(): void {
  cache.clear();
}

/** Картинки для легенды: их немного и меняться им не с чего. */
const legendCache = new Map<string, string>();

/**
 * Силуэт для легенды — картинкой, а не эмодзи. Легенда обязана показывать ту же
 * карту, что и полотно: значков стадий на ней нет с тех пор, как поселения стали
 * рисоваться, и эмодзи в легенде объясняли бы карту, которой больше нет.
 *
 * Печётся мимо `settlementSprite`: тот кэш рассчитан на экран (`CACHE_MAX` 16),
 * и шесть строк легенды вытеснили бы из него живые спрайты ровно в тот момент,
 * когда игрок закрывает легенду и возвращается к карте.
 *
 * Клетка здесь крупнее нижней корзины карты (20 против 22 — почти та же), но
 * мельче делать нельзя: на 15 зубцы донжона и башни городской стены сливаются в
 * ровную линию, и строка «Замок» перестаёт отличаться от строки «Город».
 */
export function silhouetteUrl(look: Look, cell = 20, dpr = 2): string {
  const key = `${spriteKey(look, cell, dpr)}`;
  const have = legendCache.get(key);
  if (have) return have;
  const url = bakeSettlement(look, cell, dpr).canvas.toDataURL('image/png');
  legendCache.set(key, url);
  return url;
}

/**
 * Кадр: одно копирование. cx, cy — центр клетки на экране в CSS-пикселях,
 * px — сколько пикселей занимает клетка сейчас.
 */
export function drawSettlement(ctx: C, look: Look, px: number, dpr: number, cx: number, cy: number): void {
  const sp = settlementSprite(look, px, dpr);
  const k = px / sp.cell;
  ctx.drawImage(sp.canvas, cx - sp.ax * k, cy - sp.ay * k, sp.w * k, sp.h * k);
}

// ---------- Метки состояния ----------

/** Что бывает срочного: чужой отряд на подходе, непрочитанный отчёт, свои стоят внутри. */
export type MarkerKind = 'attack' | 'report' | 'troops';

const MARKER_COLOR: Record<MarkerKind, string> = {
  attack: RELATION_META.enemy.color,
  report: '#f0e3c8',
  troops: RELATION_META.self.color,
};

/**
 * Метки — состояние, а не облик, поэтому они не запекаются в спрайт и рисуются
 * каждый кадр тремя дугами. Столбик стоит слева-сверху, вне площадки при любой
 * стадии (площадка сплющена, и точка (−0.95, −0.95) лежит за её краем даже у города),
 * и растёт вверх: снизу под поселением подписывается имя.
 */
export function drawMarkers(ctx: C, cx: number, cy: number, px: number, kinds: MarkerKind[], now: number): void {
  const r = Math.max(3, Math.min(6, px * 0.085));
  const x = cx - px * 0.95;
  for (let i = 0; i < kinds.length; i++) {
    const kind = kinds[i];
    const y = cy - px * (0.95 + i * 0.3);
    // Тревога мигает: это единственная метка, ради которой карту открывают срочно.
    ctx.globalAlpha = kind === 'attack' ? 0.55 + 0.45 * Math.abs(Math.sin(now / 380)) : 1;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fillStyle = MARKER_COLOR[kind];
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(12, 9, 6, 0.85)';
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}
