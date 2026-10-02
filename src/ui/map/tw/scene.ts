// Что стоит на карте нового вида и где (docs/map_tw.md, этап 2): места, войска в поле и агенты — одной
// правдой на кадр и на палец. Кадр (`tw/frame.ts`) рисует по этому списку, касание (`tw/tap.ts`) ищет в нём
// цель тем же вызовом: две правды о том, где нарисован объект, разошлись бы ровно на полклетки, и палец
// попадал бы мимо нарисованного.
//
// Смысл объектов — прежний и прежними правилами: вид места — из полей мира, размер чужого отряда — только
// в живом обзоре (`world/sight` через `sightDiscs`), точки агентов — `figures.spotsOf`.
import type { Coord, FigureView, MarchView, Rect, SettlementView } from '@/world/types';
import { inSight, type SightDisc } from '@/world/fog';
import { marchPosition } from '@/world/geo';
import { figurePosition } from '@/world/store';
import { RELATION_META } from '@/world/data/meta';
import { type Camera, type Viewport, toScreen } from '../grid';
import { variantOf } from '../village';
import { type PartySize, lookOf as partyLook } from '../party';
import { type Spot, spotsOf } from '../figures';
import { ANCHOR_X, ANCHOR_Y, FAN_STEP, SPAN_H, SPAN_W } from '../agent';
import { settlementAt } from '@/world/cache';
import { type HostLook, type PlaceKind, type PlaceLook, PIN_PX, flagSprite, hostBody, pinSprite, placeBody } from './mini';

// ---------- Масштаб: миниатюра или значок ----------

/**
 * С какого масштаба места и войска — миниатюры, а не значки постоянного размера. Ниже `MINI_LO` миниатюра
 * мельче значка и неразличима (стоянка логова — полторы клетки, на 12 px — 18 px каши), выше `MINI_HI`
 * значок прячется. Полоса перелива узкая: в широкой полупрозрачные значок и миниатюра читались кашей
 * (снимки игры этапа 2, круг 4, ×14).
 */
export const MINI_LO = 15;
export const MINI_HI = 17;

/** Доля миниатюры на масштабе: 0 — значки, 1 — миниатюры. */
export function miniAlpha(scale: number): number {
  if (scale <= MINI_LO) return 0;
  if (scale >= MINI_HI) return 1;
  const t = (scale - MINI_LO) / (MINI_HI - MINI_LO);
  return t * t * (3 - 2 * t);
}

/** Чем объект нарисован на этом масштабе: цель пальца — то, что видно сильнее. */
export const asMini = (scale: number): boolean => miniAlpha(scale) >= 0.5;

// ---------- Коробки на экране ----------

/** Прямоугольник экрана: что нарисовано телом объекта. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const bodyBox = (sx: number, sy: number, rx: number, up: number, down: number): Box => ({
  x0: sx - rx,
  y0: sy - up,
  x1: sx + rx,
  y1: sy + down,
});

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
  return { kind, stage, color: s.color, own: s.mine, variant: variantOf(s.id), sacked: s.sacked };
}

export interface PlaceItem {
  s: SettlementView;
  look: PlaceLook;
  /** Точка места на экране — середина клетки. */
  sx: number;
  sy: number;
  /** Тело миниатюры или значка — смотря что видно на масштабе. */
  body: Box;
}

export function placeItems(cam: Camera, vp: Viewport, list: SettlementView[], dpr: number): PlaceItem[] {
  const px = cam.scale;
  const mini = asMini(px);
  const out: PlaceItem[] = [];
  for (const s of list) {
    const [sx, sy] = toScreen(cam, vp, s.x + 0.5, s.y + 0.5);
    // Миниатюра шире клетки (город — до трёх с половиной): запас, чтобы крыши не выскакивали у края.
    const pad = Math.max(48, px * 2.2);
    if (sx < -pad || sy < -pad || sx > vp.w + pad || sy > vp.h + pad) continue;
    const look = placeLookOf(s);
    let body: Box;
    if (mini) {
      const b = placeBody(look);
      body = bodyBox(sx, sy, b.rx * px, b.up * px, b.down * px);
    } else {
      const pin = pinSprite({ kind: look.kind, color: look.color, own: look.own }, dpr);
      body = { x0: sx - pin.ax, y0: sy - pin.ay, x1: sx - pin.ax + pin.w, y1: sy - pin.ay + pin.h };
    }
    out.push({ s, look, sx, sy, body });
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

export interface HostItem {
  m: MarchView;
  look: HostLook;
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

export function hostItems(cam: Camera, vp: Viewport, marches: MarchView[], discs: SightDisc[], now: number, dpr: number): HostItem[] {
  const out: HostItem[] = [];
  const mini = asMini(cam.scale);
  for (const m of marches) {
    const standing = m.phase === 'stay';
    const pos = standing ? m.to : marchPosition(m, now);
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
    let body: Box;
    if (mini) {
      const b = hostBody(look);
      body = bodyBox(sx, sy, b.rx * cam.scale, b.up * cam.scale, b.down * cam.scale);
    } else {
      const f = flagSprite({ color, size: look.size, camp: look.camp }, dpr);
      body = { x0: sx - f.ax, y0: sy - f.ay, x1: sx - f.ax + f.w, y1: sy - f.ay + f.h };
    }
    const cell = standing ? { x: m.to.x, y: m.to.y } : { x: Math.round(pos.x), y: Math.round(pos.y) };
    out.push({ m, look, pos, standing, sx, sy, fx, fy, tx, ty, angle, body, cell, target: !m.own && m.phase === 'out' });
  }
  return out;
}

// ---------- Агенты ----------

export interface FigureItem {
  /** Точка рисунка: у агента на клетке места — сдвинута к воротам (`atGate`). */
  spot: Spot;
  /** Настоящая точка агента на экране — середина его клетки: от неё круг обзора и всё, что меряет мир. */
  at: [number, number];
  /** Войско при полководце: тот же вид, что у похода. */
  host: HostLook | null;
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
  const mini = asMini(cam.scale);
  return spots.map((sp, i) => {
    if (sp.f.phase === 'moving') return sp;
    const c = cells[i];
    const s = settlementAt(c.x, c.y);
    if (!s) return sp;
    const half = mini ? placeBody(placeLookOf(s)).rx * cam.scale : PIN_PX / 2;
    const n = count.get(`${c.x}|${c.y}`) ?? 1;
    const fan = ((n - 1) / 2) * FAN_STEP * sp.unit + ANCHOR_X * sp.unit;
    const dx = half + fan + 4;
    const dy = 0.15 * cam.scale;
    return { ...sp, px: sp.px + dx, ax: sp.ax + dx, py: sp.py + dy };
  });
}

export function figureItems(cam: Camera, vp: Viewport, figures: FigureView[], now: number, dpr: number): FigureItem[] {
  const mini = asMini(cam.scale);
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
    let hostBox: Box | null = null;
    if (men > 0) {
      // Своё войско — своё: размер считает игрок (`seen: true`), как у прежнего `figures.drawFigures`.
      const old = partyLook({ own: true, units: f.troops, standing, seen: true, west });
      host = { color: RELATION_META.self.color, size: HOST_SIZE[old.size], west, camp: old.shape === 'camp' };
      if (mini) {
        const b = hostBody(host);
        hostBox = bodyBox(px, py, b.rx * cam.scale, b.up * cam.scale, b.down * cam.scale);
      } else {
        const fl = flagSprite({ color: host.color, size: host.size, camp: host.camp }, dpr);
        hostBox = { x0: px - fl.ax, y0: py - fl.ay, x1: px - fl.ax + fl.w, y1: py - fl.ay + fl.h };
      }
    }
    return { spot, at: [raw[i].px, raw[i].py], host, body, hostBox, cell: cellOfFigure(f, now) };
  });
}

/** Клетка фигуры — тем же правилом, что `store.figuresOn`: округлённое положение, выведенное из времени. */
function cellOfFigure(f: FigureView, now: number): Coord {
  const at = figurePosition(f, now);
  return { x: Math.round(at.x), y: Math.round(at.y) };
}
