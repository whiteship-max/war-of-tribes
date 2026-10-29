// Знаки карты бродяги (ПН-3, docs/gdd/path_of_sword.md, 5.2): руины — меткой карты, отряд — знаменем стороны, лагерь — шатром
// (открытый — с огнём, скрытый — холодный, в руинах — на камнях), путь — пунктиром до цели. Простые знаки до 3D (ПН-12).
//
// Рисует поверх кадра карты (`WorldMap` → `roamhook`), только пока открыт кусок карты бродяги. Положение отряда — функцией
// записи хода (`world/roam.roamWhere`), руины — из кусков карты (`RegionChunk.ruins`, их отдаёт только мир бродяги, и только на
// разведанной земле). Мерка экранная: знак не мельче пальца на дальнем виде и не крупнее клетки на ближнем.
import type { RuinMark } from '@/world/types';
import type { BandMark } from '@/world/bandsight';
import { agoText } from '../feedWords';
import type { RoamCampRec, RoamWay } from '@/world/roammove';
import { roamMoving, roamWhere } from '@/world/roam';
import { loadedIn } from '@/world/cache';
import { sideColor, sideRgba } from '@/side';
import { toScreen, viewRect, type Camera, type Viewport } from '../grid';
import { ROAM_MARK } from '../palette';

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

function tentGlyph(ctx: C, x: number, y: number, u: number, camp: RoamCampRec): void {
  const cold = camp.kind === 'hidden';
  ctx.fillStyle = cold ? ROAM_MARK.tentCold : ROAM_MARK.tent;
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
  if (camp.kind === 'open') {
    ctx.fillStyle = ROAM_MARK.fire;
    ctx.beginPath();
    ctx.arc(x + u * 0.62, y + u * 0.22, u * 0.13, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = ROAM_MARK.fireCore;
    ctx.beginPath();
    ctx.arc(x + u * 0.62, y + u * 0.24, u * 0.06, 0, Math.PI * 2);
    ctx.fill();
  }
}

function bannerGlyph(ctx: C, x: number, y: number, u: number, ours = true): void {
  ctx.strokeStyle = ROAM_MARK.pole;
  ctx.lineWidth = Math.max(1.5, u * 0.08);
  ctx.beginPath();
  ctx.moveTo(x, y + u * 0.35);
  ctx.lineTo(x, y - u * 0.6);
  ctx.stroke();
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
export function paintRoam(ctx: C, cam: Camera, vp: Viewport, dpr: number, now: number, way: RoamWay | null, camp: RoamCampRec | null): boolean {
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
    if (camp && !moving) tentGlyph(ctx, x - u * 0.35, y, u, camp);
    bannerGlyph(ctx, camp && !moving ? x + u * 0.35 : x, y, u);
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
      if (m.camp) tentGlyph(ctx, x - u * 0.35, y, u, { kind: m.camp, since: 0, builders: 0 });
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

/** Чужой отряд в клетке касания: живой — первым, следы — свежим первым. */
export const bandAt = (marks: readonly BandMark[], c: { x: number; y: number }): BandMark | null =>
  marks.find((m) => m.at.x === c.x && m.at.y === c.y) ?? null;
