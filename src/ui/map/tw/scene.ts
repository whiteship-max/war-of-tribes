// Что стоит на карте нового вида и где (docs/map_tw.md, этап 2): места, войска в поле и агенты — одной
// правдой на кадр и на палец. Кадр (`tw/frame.ts`) рисует по этому списку, касание (`tw/tap.ts`) ищет в нём
// цель тем же вызовом: две правды о том, где нарисован объект, разошлись бы ровно на полклетки, и палец
// попадал бы мимо нарисованного.
//
// Смысл объектов — прежний и прежними правилами: вид места — из полей мира, размер чужого отряда — только
// в живом обзоре (`world/sight` через `sightDiscs`), точки агентов — `figures.spotsOf`.
//
// Карта по регионам (docs/map_tw.md, раздел 13.5): место вне региона игрока в сцену не попадает — значит, не
// рисуется и пальцу не цель. Мерка одна — `theatre/active.withinActive` по клетке объекта, та же, что у мира. Свои
// отряды и агенты видны всегда (docs/map_tw.md, 0.−2): путь — прямая, и между двумя своими клетками она может
// пройти чужим краем (залив, излом границы) — свой человек не пропадает с карты на это время.
import type { Coord, FigureView, MarchView, Rect, SettlementView } from '@/world/types';
import { inSight, type SightDisc } from '@/world/fog';
import { marchPosition } from '@/world/geo';
import { figurePosition } from '@/world/store';
import { RELATION_META } from '@/world/data/meta';
import { type Camera, type Viewport, toScreen } from '../grid';
import { type PartySize, lookOf as partyLook } from '../party';
import { type Spot, spotsOf } from '../figures';
import { ANCHOR_X, ANCHOR_Y, FAN_STEP, SPAN_H, SPAN_W } from '../agent';
import { settlementAt } from '@/world/cache';
import type { HostLook, PlaceKind, PlaceLook } from './mini';
import { type MarkLook, STAGE_PIPS, markGeo, markPx } from './marks';
import { SIDE_COLOR } from '@/side';
import { withinActive } from './theatre/active';

// ---------- Масштаб: ближний или дальний ----------

/**
 * Места, отряды и лагеря — значками нового интерфейса на любом масштабе (`tw/marks.ts`, docs/map_tw.md, раздел 14);
 * прежние миниатюры в кадре игры не рисуются. Порог остался у того, что лежит на земле и читается только вблизи, —
 * рядов рогаток вокруг осаждённого места: ниже `MINI_LO` они мельче значка, выше `MINI_HI` видны целиком, а издали
 * осаду говорит метка у значка (`frame.drawBadges`).
 */
export const MINI_LO = 15;
export const MINI_HI = 17;

/** Доля ближнего вида на масштабе: 0 — дальний, 1 — ближний (рогатки видны). */
export function miniAlpha(scale: number): number {
  if (scale <= MINI_LO) return 0;
  if (scale >= MINI_HI) return 1;
  const t = (scale - MINI_LO) / (MINI_HI - MINI_LO);
  return t * t * (3 - 2 * t);
}

/** Ближний ли масштаб: рогатки на земле, а не метка осады. */
export const asMini = (scale: number): boolean => miniAlpha(scale) >= 0.5;

// ---------- Коробки на экране ----------

/** Прямоугольник экрана: что нарисовано телом объекта. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

// ---------- Места ----------

/**
 * Где искать места кадра: вид экрана с запасом на размах миниатюры. Город, стоящий за краем экрана, виден на
 * нём крышами и полями (до двух с половиной клеток вверх и двух вбок), а места берутся по кускам карты,
 * задетым областью: без запаса город из соседнего куска не рисовался и не ловил палец, пока камера не
 * заденет его кусок (проверка этапа 2).
 */
export const placesRect = (r: Rect): Rect => ({ x: r.x - 3, y: r.y - 2, w: r.w + 6, h: r.h + 5 });

/**
 * Вид места из полей мира. Двор живого игрока — замок, логово — логово, сожжённое — пепелище.
 *
 * Своё поселение — **всегда каменный город** (стадия «город» миниатюры), в духе нового города: игрок видит
 * свой город стеной из известняка с башнями с первой минуты (вид города — единственный вид игры), и хутор
 * под вышкой на карте рассказывал бы о другом месте. Рост своего города виден в самом городе; размер на
 * карте — у чужих мест, о которых другого знания нет (снимки игры этапа 2, круг 4).
 */
export function placeLookOf(s: SettlementView): PlaceLook {
  const kind: PlaceKind = s.ruin ? 'ruin' : s.relation === 'barbarian' ? 'lair' : s.castle && !s.mine ? 'castle' : 'city';
  const stage = s.mine && kind === 'city' ? 'town' : s.stage;
  return { kind, stage, color: s.color, own: s.mine };
}

/** Кольцо пепелища: пепел, а не цвет стороны — места больше нет. */
export const RUIN_RING = '#8c8478';

/**
 * Значок места (`tw/marks.ts`). Рисунок — по виду и размеру: свой город — город (`stage-town`), как в самом городе;
 * чужие города и неувиденные места — рисунком своей стадии (стоянка, деревня, острог, крепость); логово — разбойники;
 * пепелище — огонь, приглушённо. Плашка размера — настоящая стадия у всех, и у своего: размер соседа сравнивают со
 * своим. Кольцо — цвет стороны или отношения, у своего — золото (`side.ts`).
 */
export function placeMarkOf(s: SettlementView): MarkLook {
  const pips = STAGE_PIPS[s.stage];
  if (s.ruin) return { glyph: 'evt-fire', ring: RUIN_RING, pips, own: false, dim: true, corner: null };
  const corner = s.sacked ? 'evt-fire' : null;
  if (s.relation === 'barbarian') return { glyph: 'evt-raiders', ring: s.color, pips, own: false, dim: false, corner };
  if (s.mine) return { glyph: 'stage-town', ring: SIDE_COLOR.ours, pips, own: true, dim: false, corner };
  return { glyph: `stage-${s.stage}`, ring: s.color, pips, own: false, dim: false, corner };
}

/** Диаметр значка места на масштабе. */
export const placeMarkPx = (m: MarkLook, scale: number): number => markPx(scale, m.pips, m.own);

/** Тело значка на экране от середины диска. */
function markBox(m: MarkLook, d: number, sx: number, sy: number): Box {
  const g = markGeo(m, d);
  return { x0: sx - g.rx, y0: sy - g.up, x1: sx + g.rx, y1: sy + g.down };
}

export interface PlaceItem {
  s: SettlementView;
  look: PlaceLook;
  /** Значок и его диаметр на этом масштабе. */
  mark: MarkLook;
  d: number;
  /** Точка места на экране — середина клетки; на ней середина диска. */
  sx: number;
  sy: number;
  /** Тело значка: цель пальца и место, которое обходят подписи. */
  body: Box;
}

export function placeItems(cam: Camera, vp: Viewport, list: SettlementView[], _dpr: number): PlaceItem[] {
  const px = cam.scale;
  const out: PlaceItem[] = [];
  for (const s of list) {
    if (!withinActive(s.x, s.y)) continue;
    const [sx, sy] = toScreen(cam, vp, s.x + 0.5, s.y + 0.5);
    // Запас у края: значок и рогатки вокруг осаждённого места (полторы клетки) не выскакивают у края.
    const pad = Math.max(48, px * 1.6);
    if (sx < -pad || sy < -pad || sx > vp.w + pad || sy > vp.h + pad) continue;
    const look = placeLookOf(s);
    const mark = placeMarkOf(s);
    const d = placeMarkPx(mark, px);
    out.push({ s, look, mark, d, sx, sy, body: markBox(mark, d, sx, sy) });
  }
  return out;
}

// ---------- Войска в поле ----------

/** Размер войска нового вида по лестнице прежнего (`party.sizeOf`): слух — без фигур. */
const HOST_SIZE: Record<PartySize, HostLook['size']> = { rumor: 0, small: 1, band: 2, host: 3, horde: 4 };

/**
 * Лагерь у цели ставится сбоку от неё, а не поверх: на карте кампании шатры осаждающих стоят у стены, и
 * город под ними должен остаться виден. Сдвиг — в клетках, вправо-вниз, **за** задним рядом рогаток
 * (`siegemark.REAR_R` 1.38 по x, 0.86 по y): точка лагеря — на 1.26 радиуса кольца; прежние (1.05, 0.55)
 * ставили шатры прямо на рогатки (галерея стенда, «осада 8/8»).
 */
export const CAMP_DX = 1.6;
export const CAMP_DY = 0.42;

/**
 * Значок отряда: в поле — воин в доспехе со щитом (`troop-legionary`), стоит у цели — шатры (`stage-camp`): лагерь,
 * осадный или подмоги. Скрещённые мечи (`hud-army`) на диске читались молотками (снимки, круг 1). Плашка —
 * размер отряда по лестнице прежнего (горстка, отряд, войско, орда); слух — без плашки и приглушённо: сколько их,
 * знают только глаза (`world/sight`).
 */
export function hostMarkOf(l: HostLook): MarkLook {
  return { glyph: l.camp ? 'stage-camp' : 'troop-legionary', ring: l.color, pips: l.size, own: false, dim: l.size === 0, corner: null };
}

/** Отряд мельче места того же размера: место — цель, отряд — фишка на пути к ней. */
export const hostMarkPx = (m: MarkLook, scale: number): number => Math.round((markPx(scale, m.pips, false) * 0.9) / 2) * 2;

export interface HostItem {
  m: MarchView;
  look: HostLook;
  mark: MarkLook;
  d: number;
  /** Где отряд в мире (дробная клетка; стоящий — на цели). */
  pos: Coord;
  standing: boolean;
  /** Точки экрана: отряд, откуда вышел, куда идёт. */
  sx: number;
  sy: number;
  fx: number;
  fy: number;
  tx: number;
  ty: number;
  angle: number;
  body: Box;
  /** Клетка, которую тап по отряду отдаёт `openAt`: чужой идущий — его клетка (`store.marchOn`), стоящий — цель. */
  cell: Coord;
  /** Можно ли тапнуть по нему как по отряду: только чужой и идущий к цели (`store.marchOn`). */
  target: boolean;
}

export function hostItems(cam: Camera, vp: Viewport, marches: MarchView[], discs: SightDisc[], now: number, _dpr: number): HostItem[] {
  const out: HostItem[] = [];
  for (const m of marches) {
    const standing = m.phase === 'stay';
    const pos = standing ? m.to : marchPosition(m, now);
    const cell = standing ? { x: m.to.x, y: m.to.y } : { x: Math.round(pos.x), y: Math.round(pos.y) };
    // Свой — всегда; чужой — пока идёт из своего региона или в него (тот же путь через чужой край), иначе — только
    // в своём регионе.
    const ours = m.own || withinActive(m.from.x, m.from.y) || withinActive(m.to.x, m.to.y);
    if (!ours && !withinActive(cell.x, cell.y)) continue;
    const [fx, fy] = toScreen(cam, vp, m.from.x + 0.5, m.from.y + 0.5);
    const [tx, ty] = toScreen(cam, vp, m.to.x + 0.5, m.to.y + 0.5);
    let [sx, sy] = toScreen(cam, vp, pos.x + 0.5, pos.y + 0.5);
    if (standing) {
      sx += CAMP_DX * cam.scale;
      sy += CAMP_DY * cam.scale;
    }
    const angle = standing ? 0 : Math.atan2(ty - sy, tx - sx);
    const west = tx < sx;
    // Сколько их — разведданные, и решает это одно правило на весь мир (`world/sight.ts`): свой отряд
    // считает игрок, чужой — только глаза. Тот же вызов, что у прежнего кадра (`frame.drawMarch`).
    const old = partyLook({
      own: m.own,
      units: m.units,
      standing,
      seen: m.own || inSight(discs, pos.x, pos.y),
      west,
    });
    const color = m.hostile ? RELATION_META.enemy.color : RELATION_META.self.color;
    const look: HostLook = { color, size: HOST_SIZE[old.size], west, camp: old.shape === 'camp' };
    const mark = hostMarkOf(look);
    const d = hostMarkPx(mark, cam.scale);
    const body = markBox(mark, d, sx, sy);
    out.push({ m, look, mark, d, pos, standing, sx, sy, fx, fy, tx, ty, angle, body, cell, target: !m.own && m.phase === 'out' });
  }
  return out;
}

// ---------- Агенты ----------

export interface FigureItem {
  /** Точка рисунка: у агента на клетке места — сдвинута к воротам (`atGate`). */
  spot: Spot;
  /** Настоящая точка агента на экране — середина его клетки: от неё круг обзора и всё, что меряет мир. */
  at: [number, number];
  /** Войско при полководце: тот же вид и тот же значок, что у похода. */
  host: HostLook | null;
  hostMark: MarkLook | null;
  hostD: number;
  /** Силуэт агента и войско при нём. */
  body: Box;
  hostBox: Box | null;
  /** Клетка фигуры (`store.figuresOn`). */
  cell: Coord;
}

/**
 * Агенты, стоящие на клетке места, — у его ворот, справа от тела, а не поверх крыш: четверо дома иначе
 * закрывали бы собственный город на любом масштабе (снимки игры этапа 2, круг 1). Клетка у них прежняя — и
 * тап, и смысл решает клетка (`store.figuresOn`); сдвигается только картинка. Идущие не сдвигаются: город на
 * пути дёргал бы фигуру вбок.
 */
function atGate(cam: Camera, spots: Spot[], now: number): Spot[] {
  const count = new Map<string, number>();
  const cells = spots.map((sp) => cellOfFigure(sp.f, now));
  for (const c of cells) count.set(`${c.x}|${c.y}`, (count.get(`${c.x}|${c.y}`) ?? 0) + 1);
  return spots.map((sp, i) => {
    if (sp.f.phase === 'moving') return sp;
    const c = cells[i];
    const s = settlementAt(c.x, c.y);
    if (!s) return sp;
    const mark = placeMarkOf(s);
    const half = markGeo(mark, placeMarkPx(mark, cam.scale)).rx;
    const n = count.get(`${c.x}|${c.y}`) ?? 1;
    const fan = ((n - 1) / 2) * FAN_STEP * sp.unit + ANCHOR_X * sp.unit;
    const dx = half + fan + 4;
    const dy = 0.15 * cam.scale;
    return { ...sp, px: sp.px + dx, ax: sp.ax + dx, py: sp.py + dy };
  });
}

export function figureItems(cam: Camera, vp: Viewport, figures: FigureView[], now: number, _dpr: number): FigureItem[] {
  // Агенты — свои люди: видны всегда, и за краем региона тоже (путь между своими клетками через чужой край).
  const raw = spotsOf(cam, vp, figures, now);
  return atGate(cam, raw, now).map((spot, i) => {
    const { f, px, ax, py, unit, men, standing, west } = spot;
    const body: Box = {
      x0: ax - ANCHOR_X * unit,
      y0: py - ANCHOR_Y * unit,
      x1: ax - ANCHOR_X * unit + SPAN_W * unit,
      y1: py - ANCHOR_Y * unit + SPAN_H * unit,
    };
    let host: HostLook | null = null;
    let hostMark: MarkLook | null = null;
    let hostD = 0;
    let hostBox: Box | null = null;
    if (men > 0) {
      // Своё войско — своё: размер считает игрок (`seen: true`), как у прежнего `figures.drawFigures`.
      const old = partyLook({ own: true, units: f.troops, standing, seen: true, west });
      host = { color: RELATION_META.self.color, size: HOST_SIZE[old.size], west, camp: old.shape === 'camp' };
      hostMark = hostMarkOf(host);
      hostD = hostMarkPx(hostMark, cam.scale);
      hostBox = markBox(hostMark, hostD, px, py);
    }
    return { spot, at: [raw[i].px, raw[i].py], host, hostMark, hostD, body, hostBox, cell: cellOfFigure(f, now) };
  });
}

/** Клетка фигуры — тем же правилом, что `store.figuresOn`: округлённое положение, выведенное из времени. */
function cellOfFigure(f: FigureView, now: number): Coord {
  const at = figurePosition(f, now);
  return { x: Math.round(at.x), y: Math.round(at.y) };
}
