// Знаки карты бродяги (ПН-3, docs/gdd/path_of_sword.md, 5.2): руины — меткой карты, отряд — знаменем стороны, лагерь — шатром
// (открытый — с огнём, скрытый — холодный, в руинах — на камнях), путь — пунктиром до цели; точки ПН-5 — вольный город (стена и
// башня, ступень — точками), село (срубы), ватага НПС (чёрный стан с огнём). Лагерь — картинкой по ступени (ПН-12л, `campsite.tierOf`):
// малый — палатка и костёр, большой — шатёр героя, палатка и обоз; огонь — как в сцене (дождь гасит, `campsite.fireLit`); знамя своего
// отряда — гербом профиля (`heraldry/paint.armsCanvas`). Рисуется поверх кадра — без новых выпечек тайлов.
//
// Рисует поверх кадра карты (`WorldMap` → `roamhook`), только пока открыт кусок карты бродяги. Положение отряда — функцией
// записи хода (`world/roam.roamWhere`), руины — из кусков карты (`RegionChunk.ruins`, их отдаёт только мир бродяги, и только на
// разведанной земле). Мерка экранная: знак не мельче пальца на дальнем виде и не крупнее клетки на ближнем.
import type { FreeMark, RoamPointMark, RuinMark } from '@/world/types';
import type { BandMark } from '@/world/bandsight';
import { agoText } from '../feedWords';
import type { RoamCampRec, RoamWay } from '@/world/roammove';
import { roamMoving, roamWhere } from '@/world/roam';
import { loadedIn } from '@/world/cache';
import { sideColor, sideRgba } from '@/side';
import { toScreen, viewRect, type Camera, type Viewport } from '../grid';
import { ROAM_MARK } from '../palette';
import { tierOf, type CampTier } from '@/world/campsite';
import { armsCanvas } from '@/heraldry/paint';

type C = CanvasRenderingContext2D;

/** Размер знака в пикселях по масштабу: клетка, но не мельче и не крупнее. */
export const markSize = (scale: number): number => Math.max(14, Math.min(30, scale * 0.9));

function ruinGlyph(ctx: C, x: number, y: number, u: number): void {
  // Три обломка стены разной высоты на общем основании.
  ctx.fillStyle = ROAM_MARK.plate;
  ctx.beginPath();
  ctx.ellipse(x, y + u * 0.32, u * 0.62, u * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
  const bars: [number, number][] = [
    [-0.42, 0.55],
    [-0.1, 0.85],
    [0.22, 0.4],
  ];
  for (const [dx, h] of bars) {
    ctx.fillStyle = ROAM_MARK.stone;
    ctx.fillRect(x + dx * u, y + u * 0.3 - h * u, u * 0.24, h * u);
    ctx.fillStyle = ROAM_MARK.stoneDark;
    ctx.fillRect(x + dx * u + u * 0.17, y + u * 0.3 - h * u, u * 0.07, h * u);
  }
}

/** Вольный город (ПН-5): стена с башней под красной кровлей, ступень — точками над башней. */
function townGlyph(ctx: C, x: number, y: number, u: number, tier: number): void {
  ctx.fillStyle = ROAM_MARK.plate;
  ctx.beginPath();
  ctx.ellipse(x, y + u * 0.34, u * 0.7, u * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = ROAM_MARK.townWall;
  ctx.fillRect(x - u * 0.6, y - u * 0.05, u * 1.2, u * 0.38);
  ctx.fillRect(x - u * 0.16, y - u * 0.5, u * 0.32, u * 0.5);
  ctx.fillStyle = ROAM_MARK.townRoof;
  ctx.beginPath();
  ctx.moveTo(x - u * 0.24, y - u * 0.5);
  ctx.lineTo(x, y - u * 0.8);
  ctx.lineTo(x + u * 0.24, y - u * 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = ROAM_MARK.townTier;
  for (let i = 0; i < tier; i++) {
    ctx.beginPath();
    ctx.arc(x + (i - (tier - 1) / 2) * u * 0.22, y - u * 0.98, u * 0.07, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Вольный замок (ПН-10): стена с башнями по ступени (I — одна, II — две, III — три и шире), зубцы, стяг: кастеляна — синий, наш —
 * цвета стороны, чужого отряда — тёмный; сожжённый — пеплом без стяга; под нашим лагерем — пунктирный круг стороны.
 */
function castleGlyph(ctx: C, x: number, y: number, u: number, m: FreeMark): void {
  const wide = 0.55 + 0.15 * m.tier;
  const stone = m.burnt ? ROAM_MARK.ash : ROAM_MARK.castle;
  ctx.fillStyle = ROAM_MARK.plate;
  ctx.beginPath();
  ctx.ellipse(x, y + u * 0.36, u * (wide + 0.12), u * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = stone;
  ctx.fillRect(x - u * wide, y - u * 0.1, u * wide * 2, u * 0.44);
  const towers = m.tier === 1 ? [0] : m.tier === 2 ? [-0.62, 0.62] : [-0.8, 0, 0.8];
  for (const t of towers) {
    const tx = x + t * u * wide;
    const h = t === 0 ? 0.62 : 0.5;
    ctx.fillStyle = stone;
    ctx.fillRect(tx - u * 0.17, y - u * h, u * 0.34, u * h);
    ctx.fillStyle = ROAM_MARK.castleDark;
    for (const dx of [-0.17, -0.03, 0.11]) ctx.fillRect(tx + dx * u, y - u * (h + 0.08), u * 0.07, u * 0.08);
  }
  ctx.fillStyle = ROAM_MARK.castleDark;
  ctx.fillRect(x - u * 0.09, y + u * 0.08, u * 0.18, u * 0.26);
  if (!m.burnt) {
    const top = m.tier === 2 ? x - 0.62 * u * wide : x;
    const h = m.tier === 2 ? 0.5 : 0.62;
    ctx.fillStyle = ROAM_MARK.pole;
    ctx.fillRect(top - u * 0.02, y - u * (h + 0.42), u * 0.04, u * 0.36);
    ctx.fillStyle = m.held === 'mine' ? sideColor(true) : m.held === 'other' ? ROAM_MARK.vataga : ROAM_MARK.castleFlag;
    ctx.fillRect(top + u * 0.02, y - u * (h + 0.42), u * 0.28, u * 0.16);
  }
  if (m.siege) {
    ctx.strokeStyle = sideColor(true);
    ctx.lineWidth = Math.max(1.5, u * 0.07);
    ctx.setLineDash([u * 0.18, u * 0.12]);
    ctx.beginPath();
    ctx.ellipse(x, y, u * (wide + 0.3), u * 0.75, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

/** Село (ПН-5): два сруба под тёмной кровлей. */
function villageGlyph(ctx: C, x: number, y: number, u: number): void {
  for (const dx of [-0.28, 0.24]) {
    ctx.fillStyle = ROAM_MARK.hut;
    ctx.fillRect(x + dx * u - u * 0.2, y - u * 0.05, u * 0.4, u * 0.32);
    ctx.fillStyle = ROAM_MARK.hutRoof;
    ctx.beginPath();
    ctx.moveTo(x + dx * u - u * 0.26, y - u * 0.05);
    ctx.lineTo(x + dx * u, y - u * 0.34);
    ctx.lineTo(x + dx * u + u * 0.26, y - u * 0.05);
    ctx.closePath();
    ctx.fill();
  }
}

/** Ватага НПС (ПН-5): чёрный шатёр с огнём и красной лентой — чужая сторона. */
function vatagaGlyph(ctx: C, x: number, y: number, u: number): void {
  ctx.fillStyle = ROAM_MARK.vataga;
  ctx.beginPath();
  ctx.moveTo(x - u * 0.45, y + u * 0.3);
  ctx.lineTo(x, y - u * 0.38);
  ctx.lineTo(x + u * 0.45, y + u * 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = sideColor(false);
  ctx.fillRect(x - u * 0.04, y - u * 0.62, u * 0.34, u * 0.14);
  ctx.fillStyle = ROAM_MARK.fire;
  ctx.beginPath();
  ctx.arc(x + u * 0.58, y + u * 0.22, u * 0.12, 0, Math.PI * 2);
  ctx.fill();
}

/** Палатка: треугольник полотна с тёмным входом; холодная — тусклей. */
function tentShape(ctx: C, x: number, y: number, u: number, cold: boolean, fill?: string): void {
  ctx.fillStyle = fill ?? (cold ? ROAM_MARK.tentCold : ROAM_MARK.tent);
  ctx.beginPath();
  ctx.moveTo(x - u * 0.5, y + u * 0.3);
  ctx.lineTo(x, y - u * 0.4);
  ctx.lineTo(x + u * 0.5, y + u * 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = ROAM_MARK.tentDark;
  ctx.beginPath();
  ctx.moveTo(x - u * 0.1, y + u * 0.3);
  ctx.lineTo(x, y - u * 0.05);
  ctx.lineTo(x + u * 0.1, y + u * 0.3);
  ctx.closePath();
  ctx.fill();
}

function fireGlyph(ctx: C, x: number, y: number, u: number): void {
  ctx.fillStyle = ROAM_MARK.fire;
  ctx.beginPath();
  ctx.arc(x, y, u * 0.13, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = ROAM_MARK.fireCore;
  ctx.beginPath();
  ctx.arc(x, y + u * 0.02, u * 0.06, 0, Math.PI * 2);
  ctx.fill();
}

/** Обоз: кузов под полотном и два колеса. */
function wagonGlyph(ctx: C, x: number, y: number, u: number): void {
  ctx.fillStyle = ROAM_MARK.tentDark;
  ctx.fillRect(x - u * 0.28, y + u * 0.02, u * 0.56, u * 0.16);
  ctx.fillStyle = ROAM_MARK.tent;
  ctx.beginPath();
  ctx.ellipse(x, y + u * 0.02, u * 0.28, u * 0.2, 0, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = ROAM_MARK.stoneDark;
  for (const dx of [-0.17, 0.17]) {
    ctx.beginPath();
    ctx.arc(x + dx * u, y + u * 0.22, u * 0.08, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Что рисовать на месте лагеря: вид, ступень по людям, горит ли огонь. */
export interface CampMark {
  kind: RoamCampRec['kind'];
  tier: CampTier;
  fire: boolean;
}

/** Лагерь картинкой по ступени: малый — палатка и костёр; большой — шатёр героя (шире, с красной полосой), палатка и обоз. */
function campGlyph(ctx: C, x: number, y: number, u: number, m: CampMark): void {
  const cold = m.kind === 'hidden';
  if (m.tier === 'large') {
    tentShape(ctx, x + u * 0.45, y - u * 0.12, u * 0.7, cold);
    wagonGlyph(ctx, x - u * 0.62, y + u * 0.08, u);
    tentShape(ctx, x, y, u * 1.2, cold, cold ? ROAM_MARK.tentCold : ROAM_MARK.tent);
    ctx.fillStyle = sideColor(true);
    ctx.fillRect(x - u * 0.28, y - u * 0.02, u * 0.56, u * 0.07);
  } else tentShape(ctx, x, y, u, cold);
  if (m.fire) fireGlyph(ctx, x + u * (m.tier === 'large' ? 0.78 : 0.62), y + u * 0.22, u);
}

function bannerGlyph(ctx: C, x: number, y: number, u: number, ours = true, arms: string | null = null): void {
  ctx.strokeStyle = ROAM_MARK.pole;
  ctx.lineWidth = Math.max(1.5, u * 0.08);
  ctx.beginPath();
  ctx.moveTo(x, y + u * 0.35);
  ctx.lineTo(x, y - u * 0.6);
  ctx.stroke();
  // Знамя своего отряда — гербом профиля; без документа или чужое — вымпел стороны.
  const art = arms ? armsCanvas(arms, 32, { gloss: false }) : null;
  if (art) {
    ctx.drawImage(art, x + u * 0.02, y - u * 0.62, u * 0.42, u * 0.5);
    return;
  }
  ctx.fillStyle = sideColor(ours);
  ctx.beginPath();
  ctx.moveTo(x, y - u * 0.6);
  ctx.lineTo(x + u * 0.55, y - u * 0.45);
  ctx.lineTo(x, y - u * 0.28);
  ctx.closePath();
  ctx.fill();
}

/**
 * Дорисовать карту бродяги: руины в кадре, путь, отряд и лагерь. `true` — отряд в пути: кадр нужен по часам (знак едет).
 */
export function paintRoam(
  ctx: C,
  cam: Camera,
  vp: Viewport,
  dpr: number,
  now: number,
  way: RoamWay | null,
  camp: RoamCampRec | null,
  look: { men: number; fire: boolean; arms: string | null } = { men: 0, fire: camp?.kind === 'open', arms: null },
): boolean {
  const u = markSize(cam.scale);
  const rect = viewRect(cam, vp);
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const ruins: RuinMark[] = loadedIn(rect).flatMap((c) => c.ruins ?? []);
  for (const r of ruins) {
    const [x, y] = toScreen(cam, vp, r.x + 0.5, r.y + 0.5);
    if (x < -u || y < -u || x > vp.w + u || y > vp.h + u) continue;
    ruinGlyph(ctx, x, y, u);
  }
  // Точки бродяги (ПН-5): вольные города, сёла, ватаги — на разведанной земле; имя — на ближнем виде.
  const points: RoamPointMark[] = loadedIn(rect).flatMap((c) => c.points ?? []);
  ctx.textAlign = 'center';
  ctx.font = `600 ${Math.round(Math.max(10, u * 0.42))}px system-ui, sans-serif`;
  for (const p of points) {
    const [x, y] = toScreen(cam, vp, p.x + 0.5, p.y + 0.5);
    if (x < -u * 2 || y < -u * 2 || x > vp.w + u * 2 || y > vp.h + u * 2) continue;
    if (p.kind === 'town') townGlyph(ctx, x, y, u, p.tier);
    else if (p.kind === 'village') villageGlyph(ctx, x, y, u);
    else vatagaGlyph(ctx, x, y, u);
    if (cam.scale >= 20) label(ctx, p.name, x, y + u * 0.95);
  }
  // Вольные замки пула (ПН-10) — картинкой поверх кадра, по ступени; имя — на ближнем виде.
  const free: FreeMark[] = loadedIn(rect).flatMap((c) => c.free ?? []);
  for (const m of free) {
    const [x, y] = toScreen(cam, vp, m.x + 0.5, m.y + 0.5);
    if (x < -u * 2 || y < -u * 2 || x > vp.w + u * 2 || y > vp.h + u * 2) continue;
    castleGlyph(ctx, x, y, u, m);
    if (cam.scale >= 20) label(ctx, m.name, x, y + u * 0.95);
  }
  let moving = false;
  if (way) {
    const at = roamWhere(way, now);
    const [x, y] = toScreen(cam, vp, at.x + 0.5, at.y + 0.5);
    moving = roamMoving(way, now);
    if (moving) {
      const [tx, ty] = toScreen(cam, vp, way.to.x + 0.5, way.to.y + 0.5);
      ctx.strokeStyle = sideRgba(true, 0.85);
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(tx, ty, u * 0.35, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (camp && !moving) campGlyph(ctx, x - u * 0.35, y, u, { kind: camp.kind, tier: tierOf(look.men), fire: look.fire });
    bannerGlyph(ctx, camp && !moving ? x + u * (tierOf(look.men) === 'large' ? 0.75 : 0.35) : x, y, u, true, look.arms);
  }
  ctx.restore();
  return moving;
}

/** Подпись светлым по тёмной кайме — читается на любой земле. */
function label(ctx: C, text: string, x: number, y: number): void {
  ctx.lineWidth = 3;
  ctx.strokeStyle = ROAM_MARK.labelEdge;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = ROAM_MARK.label;
  ctx.fillText(text, x, y);
}

/**
 * Чужие отряды бродяг (ПН-4у): обнаруженный — знаменем чужой стороны, шатром, если стоит лагерем, стрелкой, куда смотрит колонна, и
 * числом людей; след — бледным знаменем в пунктирном круге и давностью (тем же правилом, что снимок поселения: последнее увиденное и
 * когда). `now` — часы сервера карты.
 */
export function paintBands(ctx: C, cam: Camera, vp: Viewport, dpr: number, now: number, marks: readonly BandMark[]): void {
  if (marks.length === 0) return;
  const u = markSize(cam.scale);
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.textAlign = 'center';
  ctx.font = `600 ${Math.round(Math.max(10, u * 0.42))}px system-ui, sans-serif`;
  for (const m of marks) {
    const [x, y] = toScreen(cam, vp, m.at.x + 0.5, m.at.y + 0.5);
    if (x < -u * 2 || y < -u * 2 || x > vp.w + u * 2 || y > vp.h + u * 2) continue;
    if (m.visible) {
      if (m.camp) campGlyph(ctx, x - u * 0.35, y, u, { kind: m.camp, tier: tierOf(m.men), fire: m.camp === 'open' });
      if (m.heading) {
        ctx.strokeStyle = sideRgba(false, 0.9);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + m.heading.x * u, y + m.heading.y * u);
        ctx.stroke();
      }
      bannerGlyph(ctx, m.camp ? x + u * 0.35 : x, y, u, false);
      label(ctx, String(m.men), x, y + u * 0.9);
    } else {
      ctx.globalAlpha = 0.45;
      ctx.strokeStyle = sideRgba(false, 0.8);
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.arc(x, y, u * 0.6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      bannerGlyph(ctx, x, y, u * 0.8, false);
      ctx.globalAlpha = 1;
      if (cam.scale >= 20) label(ctx, agoText(now - m.seenAt), x, y + u * 0.95);
    }
  }
  ctx.restore();
}

/** Точка бродяги в клетке касания (ПН-5) — из кусков карты. */
export const pointAtTap = (rect: { x: number; y: number; w: number; h: number }, c: { x: number; y: number }): RoamPointMark | null =>
  loadedIn(rect)
    .flatMap((k) => k.points ?? [])
    .find((p) => p.x === c.x && p.y === c.y) ?? null;

/** Вольный замок в клетке касания (ПН-10) — из кусков карты. */
export const freeAtTap = (rect: { x: number; y: number; w: number; h: number }, c: { x: number; y: number }): FreeMark | null =>
  loadedIn(rect)
    .flatMap((k) => k.free ?? [])
    .find((m) => m.x === c.x && m.y === c.y) ?? null;

/** Чужой отряд в клетке касания: живой — первым, следы — свежим первым. */
export const bandAt = (marks: readonly BandMark[], c: { x: number; y: number }): BandMark | null =>
  marks.find((m) => m.at.x === c.x && m.at.y === c.y) ?? null;
