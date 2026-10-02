// Что стоит на карте нового вида и где (docs/map_tw.md, этап 2): места, войска в поле и агенты — одной
// правдой на кадр и на палец. Кадр (`tw/frame.ts`) рисует по этому списку, касание (`tw/tap.ts`) ищет в нём
// цель тем же вызовом: две правды о том, где нарисован объект, разошлись бы ровно на полклетки, и палец
// попадал бы мимо нарисованного.
//
// Смысл объектов — прежний и прежними правилами: вид места — из полей мира, размер чужого отряда — только
// в живом обзоре (`world/sight` через `sightDiscs`), точки агентов — `figures.spotsOf`.
import type { Coord, FigureView, MarchView, SettlementView } from '@/world/types';
import { inSight, type SightDisc } from '@/world/fog';
import { marchPosition } from '@/world/geo';
import { figurePosition } from '@/world/store';
import { RELATION_META } from '@/world/data/meta';
import { type Camera, type Viewport, toScreen } from '../grid';
import { variantOf } from '../village';
import { type PartySize, lookOf as partyLook } from '../party';
import { type Spot, spotsOf } from '../figures';
import { ANCHOR_X, ANCHOR_Y, SPAN_H, SPAN_W } from '../agent';
import { type HostLook, type PlaceKind, type PlaceLook, flagSprite, hostBody, pinSprite, placeBody } from './mini';

// ---------- Масштаб: миниатюра или значок ----------

/**
 * С какого масштаба места и войска — миниатюры, а не значки постоянного размера. Ниже `MINI_LO` миниатюра
 * в клетку мельче пальца и неразличима (город в 3.5 клетки на 10 px на клетку — 35 px каши), выше
 * `MINI_HI` значок прячется: между ними перелив встречной прозрачностью, как у тайлов.
 */
export const MINI_LO = 11;
export const MINI_HI = 15;

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

/** Вид места из полей мира. Своё поселение — город в духе нового города, двор живого игрока — замок. */
export function placeLookOf(s: SettlementView): PlaceLook {
  const kind: PlaceKind = s.ruin ? 'ruin' : s.relation === 'barbarian' ? 'lair' : s.castle && !s.mine ? 'castle' : 'city';
  return { kind, stage: s.stage, color: s.color, own: s.mine, variant: variantOf(s.id), sacked: s.sacked };
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
 * город под ними должен остаться виден. Сдвиг — в клетках, вправо-вниз, за кольцом рогаток.
 */
export const CAMP_DX = 1.05;
export const CAMP_DY = 0.55;

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
  spot: Spot;
  /** Войско при полководце: тот же вид, что у похода. */
  host: HostLook | null;
  /** Силуэт агента и войско при нём. */
  body: Box;
  hostBox: Box | null;
  /** Клетка фигуры (`store.figuresOn`). */
  cell: Coord;
}

export function figureItems(cam: Camera, vp: Viewport, figures: FigureView[], now: number, dpr: number): FigureItem[] {
  const mini = asMini(cam.scale);
  return spotsOf(cam, vp, figures, now).map((spot) => {
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
    return { spot, host, body, hostBox, cell: cellOfFigure(f, now) };
  });
}

/** Клетка фигуры — тем же правилом, что `store.figuresOn`: округлённое положение, выведенное из времени. */
function cellOfFigure(f: FigureView, now: number): Coord {
  const at = figurePosition(f, now);
  return { x: Math.round(at.x), y: Math.round(at.y) };
}
