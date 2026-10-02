// Стенд карты нового вида: `?showcase=map-tw` (docs/map_tw.md, раздел 10). Не игра: кусок настоящей
// Европы из атласа кладётся в кэш мира, а кадр печётся **один раз** — без цепочки кадров, без пальца.
// Тайлы печёт та же выпечка, что у игры (`bake.ts`; `old=1` — прежняя, `ground.ts`), поэтому стенд
// мерит её цену честно: то же место, тот же браузер, до и после.
//
//   ?showcase=map-tw                      Лигурийский берег: Генуя, Приморские Альпы, Апеннины
//   &at=684,1213  &scale=44               середина кадра (клетка мира) и масштаб, px на клетку
//   &view=start|near|mid|far|coast|mountains|forest|army    готовые ракурсы участка
//   &view=eu-norway|eu-sahara|eu-anatolia|eu-britain|eu-hungary|eu-pyrenees|eu-crimea|eu-baltic|eu-greece|eu-alps
//                                         края Европы (этап 2): та же выпечка на непохожей земле
//   &view=objects|objects-far             галерея миниатюр над равниной (места, войска, работы, значки);
//                                         &boxes=1 — рамки холста (пунктир) и тела (цель пальца)
//   &quality=low|medium|high              уровень (по умолчанию — высокий: «в полном качестве»)
//   &season=winter  &night=1              сезон выпечки и ночь поверх кадра
//   &old=1                                прежняя карта на том же участке — «до»
//   &clean=1                              без подписи стенда
//   &bench=1                              замер этапа 2: тайл среднего масштаба, лист старой карты, миниатюры
//
// Готовность — `document.body.dataset.ready = '1'`; числа — `document.body.dataset.showcase` (JSON):
// сколько тайлов испечено и медиана выпечки, по частям. Снимает `npm run map-tw:shots`.
import { putChunk, chunkRect, chunkKeysIn, clearCache } from '@/world/cache';
import { terrainAt as geoTerrain, featuresAt as geoFeatures, FEATURE } from '@/world/geography';
import { TERRAIN_ORDER } from '@/world/data/terrain';
import { WORLD_ORIGIN, WORLD_SIZE } from '@/world/data/tuning';
import type { RegionChunk, SettlementView } from '@/world/types';
import { qualityOf } from '@/render/quality';
import { pixelRatio } from '@/render/loop';
import { LABEL_FROM, PALETTE, SCALE_START } from '../const';
import { type Camera, type Viewport, detailAlpha, tileQuad, tileRequest, toScreen, viewRect } from '../grid';
import { TILE_SRC, prepareTiles, tileAt, tileBakes } from '../ground';
import { chunkBitmap } from '../tiles';
import { grainTile, makeCanvas, vignette } from '../paint';
import { MID_CELLS, OVERVIEW_BLEED, OVERVIEW_PX, bakeChunk, bakeMid, bakeStats, bakeTile, chunkStats, setTwLook } from './bake';
import type { Canvas } from './canvas';
import { setLand } from './land';
import { cacheLand } from './landcache';
import {
  BADGE_PX,
  PIN_PX,
  type BadgeKind,
  type Body,
  type HostLook,
  type Mini,
  type PinLook,
  type PlaceKind,
  type PlaceLook,
  badgeSprite,
  drawMini,
  dropMinis,
  fellSprite,
  flagSprite,
  hostBody,
  hostSprite,
  miniBucket,
  pinSprite,
  placeBody,
  placeSprite,
  worksSprite,
} from './mini';
import { placeLabel, regionLabel } from './labels';
import { contour, soften } from './border';
import { PARCHMENT_PX, SHEET_PX, bakeParchment } from './parchment';
import { drawSettlement as oldSettlement, type Look as OldLook } from '../village';
import { drawParty as oldParty, lookOf as oldPartyLook } from '../party';
import { RELATION_META } from '@/world/data/meta';
import type { Fate, Stage } from '@/world/types';
import { FELL_WORDS } from '../siegemark';
import { CAMP_DX, CAMP_DY } from './scene';

/** Сид стенда — тот же, что у закреплённого мира отчётов (`scripts/lib/pinned.ts`). Земле он не важен. */
const SEED = 20260912;

/** Ракурсы участка: середина кадра и масштаб. Клетки — мировые (атлас + `WORLD_ORIGIN`). */
const VIEWS: Record<string, { at: [number, number]; scale: number }> = {
  start: { at: [700, 1212], scale: SCALE_START },
  near: { at: [700, 1212], scale: 56 },
  mid: { at: [698, 1212], scale: 24 },
  far: { at: [686, 1210], scale: 7 },
  coast: { at: [694, 1218], scale: 44 },
  mountains: { at: [668, 1206], scale: 44 },
  forest: { at: [690, 1200], scale: 44 },
  army: { at: [688, 1208], scale: 44 },
  /** Край старой карты: разведанное вокруг города, дальше — пергамент (`edge=1` включён сам). */
  edge: { at: [697, 1210], scale: 12 },
  /**
   * Галерея миниатюр над равниной. Кастильская месета — самое ровное окно атласа на 16×38 клеток без леса,
   * рек и хребтов (счёт по атласу, `geography.terrainAt`/`featuresAt`): купы и реки не спорят с макетами.
   */
  // Вся Европа (этап 2): края атласа, где земля непохожа на лигурийский берег, — север, пустыня, степь,
  // острова, равнина. Клетки — проекция атласа от настоящих долготы и широты (`world/atlas/project.cellOf`).
  'eu-norway': { at: [710, 915], scale: 9 },
  'eu-sahara': { at: [585, 1410], scale: 9 },
  'eu-anatolia': { at: [1023, 1285], scale: 9 },
  'eu-britain': { at: [594, 1028], scale: 9 },
  'eu-hungary': { at: [830, 1170], scale: 9 },
  'eu-pyrenees': { at: [588, 1231], scale: 9 },
  'eu-crimea': { at: [1010, 1179], scale: 9 },
  'eu-baltic': { at: [839, 992], scale: 9 },
  'eu-greece': { at: [878, 1300], scale: 9 },
  'eu-alps': { at: [715, 1179], scale: 24 },
  objects: { at: [550, 1283], scale: 44 },
  'objects-far': { at: [550, 1283], scale: 10 },
};

/**
 * Что стоит на участке. Город игрока — у Генуи, на берегу; логово — в Апеннинах над ним; армия игрока
 * идёт из города на логово. Дорога — данные стенда, а не мира: в мире дорог сегодня нет
 * (`geography.tribeCenters`), и стенд кладёт её, чтобы проверить её вид, а не обещать её в игре.
 */
const SCENE = {
  home: { x: 697, y: 1211, name: 'Генуя' },
  lair: { x: 702, y: 1204, name: 'Волчье логово' },
  /** Доля пути армии от города до логова. */
  march: 0.42,
  /** Дорога стенда: от ворот города на северо-восток, к перевалу. */
  road: [
    [697, 1211],
    [700, 1209],
    [703, 1208],
    [706, 1205],
    [708, 1201],
  ] as [number, number][],
  /** Владение: клетки суши ближе этого к городу. */
  realm: 5.6,
  sea: { x: 699, y: 1219, name: 'Лигурийское море' },
};

const OWN = '#e8a43c';

interface Stats {
  tiles: number;
  bakeMs: number[];
  parts: Record<string, number[]>;
  chunks: number;
  chunkMs: number[];
}

const median = (a: number[]): number => {
  if (a.length === 0) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

/** Клетки дороги стенда: ломаная `SCENE.road` по клеткам, четырёхсвязно — как колея у мира. */
const ROAD = ((): Set<number> => {
  const out = new Set<number>();
  for (let i = 0; i + 1 < SCENE.road.length; i++) {
    let [x, y] = SCENE.road[i];
    const [x1, y1] = SCENE.road[i + 1];
    out.add(x * 4096 + y);
    while (x !== x1 || y !== y1) {
      if (Math.abs(x1 - x) >= Math.abs(y1 - y)) x += Math.sign(x1 - x);
      else y += Math.sign(y1 - y);
      out.add(x * 4096 + y);
    }
  }
  return out;
})();

/** Кусок карты для кэша — из той же географии, из которой его собирает мир (`world/geography.ts`). */
function regionChunk(cx: number, cy: number): RegionChunk {
  const rect = chunkRect(cx, cy);
  const n = rect.w * rect.h;
  const terrain = new Uint8Array(n);
  const features = new Uint8Array(n);
  const explored = new Uint8Array(n).fill(1);
  const influence = new Uint8Array(n);
  for (let j = 0; j < rect.h; j++) {
    for (let i = 0; i < rect.w; i++) {
      const x = rect.x + i;
      const y = rect.y + j;
      const k = j * rect.w + i;
      const t = geoTerrain(SEED, x, y);
      terrain[k] = Math.max(0, TERRAIN_ORDER.indexOf(t));
      let f = geoFeatures(SEED, x, y);
      if (ROAD.has(x * 4096 + y) && t !== 'water') f = f & FEATURE.river ? (f | FEATURE.bridge | FEATURE.road) & ~FEATURE.ford : f | FEATURE.road | FEATURE.track;
      features[k] = f;
      if (t !== 'water' && Math.hypot(x - SCENE.home.x, y - SCENE.home.y) < SCENE.realm) influence[k] = 1;
    }
  }
  const settlements: SettlementView[] = [];
  for (const [id, p, mine] of [
    ['home', SCENE.home, true],
    ['lair', SCENE.lair, false],
  ] as const) {
    if (p.x >= rect.x && p.y >= rect.y && p.x < rect.x + rect.w && p.y < rect.y + rect.h) {
      settlements.push({ id, x: p.x, y: p.y, name: p.name, mine } as unknown as SettlementView);
    }
  }
  return { rect, terrain, explored, features, influence, settlements };
}

function fillCache(rect: { x: number; y: number; w: number; h: number }): void {
  clearCache();
  const now = 0;
  for (const { key, cx, cy } of chunkKeysIn(rect)) putChunk(key, regionChunk(cx, cy), now);
}

function setupCanvas(root: HTMLElement): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; vp: Viewport; dpr: number } {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block;background:#120e0b';
  root.appendChild(canvas);
  const dpr = pixelRatio();
  const vp = { w: window.innerWidth, h: window.innerHeight };
  canvas.width = Math.round(vp.w * dpr);
  canvas.height = Math.round(vp.h * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Стенд карты: 2D-контекст недоступен.');
  return { canvas, ctx, vp, dpr };
}

/** Тайлы экрана: печёт все сразу (стенд), а не по одному за кадр, и меряет каждую выпечку. */
function drawTiles(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, old: boolean, stats: Stats): void {
  const req = tileRequest(viewRect(cam, vp));
  const alpha = detailAlpha(cam.scale);
  if (alpha <= 0) return;
  const shown = req.shown;
  const tiles = new Map<string, CanvasImageSource>();
  if (old) {
    // Прежняя выпечка — своей дверью: кадр за кадром, по тайлу, пока экран не испечётся целиком.
    for (let frame = 1; frame < 400; frame++) {
      const before = tileBakes();
      const t0 = performance.now();
      prepareTiles(SEED, shown, frame, shown.length + 8);
      const ms = performance.now() - t0;
      if (tileBakes() > before) stats.bakeMs.push(ms);
      if (shown.every((t) => tileAt(t.tx, t.ty))) break;
    }
    for (const t of shown) {
      const c = tileAt(t.tx, t.ty);
      if (c) tiles.set(`${t.tx}:${t.ty}`, c);
    }
  } else {
    for (const t of shown) {
      const t0 = performance.now();
      const c = bakeTile(SEED, t.tx, t.ty, () => makeCanvas(448, 448));
      const ms = performance.now() - t0;
      if (!c) continue;
      stats.bakeMs.push(ms);
      for (const [k, v] of Object.entries(bakeStats)) (stats.parts[k] ??= []).push(v);
      tiles.set(`${t.tx}:${t.ty}`, c);
    }
  }
  stats.tiles = tiles.size;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.globalAlpha = alpha;
  for (const t of shown) {
    const c = tiles.get(`${t.tx}:${t.ty}`);
    if (!c) continue;
    const q = tileQuad(cam, vp, t.tx, t.ty);
    ctx.drawImage(c, TILE_SRC.x, TILE_SRC.y, TILE_SRC.size, TILE_SRC.size, q.x, q.y, q.w, q.h);
  }
  ctx.restore();
}

/** Обзор: кусками карты, как у игры, — прежний растр или новый вид. */
function drawOverview(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, old: boolean, stats: Stats): void {
  const rect = viewRect(cam, vp);
  for (const { key, cx, cy } of chunkKeysIn(rect)) {
    void key;
    const r = chunkRect(cx, cy);
    let bmp: Canvas | null = null;
    if (!old) {
      const t0 = performance.now();
      const chunk = regionChunkCached(cx, cy);
      bmp = chunk ? bakeChunk(SEED, chunk) : null;
      if (bmp) {
        stats.chunks++;
        stats.chunkMs.push(performance.now() - t0);
        for (const [k, v] of Object.entries(chunkStats)) (stats.parts[`chunk.${k}`] ??= []).push(v);
      }
    }
    const fallback = bmp ?? chunkBitmapOf(cx, cy);
    if (!fallback) continue;
    const [sx, sy] = toScreen(cam, vp, r.x, r.y);
    // Кусок нового вида — картина без вылета по краю, прежний растр — клетка в пиксель целиком.
    const src: [number, number, number, number] = bmp ? [OVERVIEW_BLEED, OVERVIEW_BLEED, r.w * OVERVIEW_PX, r.h * OVERVIEW_PX] : [0, 0, r.w, r.h];
    ctx.imageSmoothingEnabled = src[2] > r.w;
    ctx.drawImage(fallback, src[0], src[1], src[2], src[3], Math.round(sx), Math.round(sy), Math.ceil(r.w * cam.scale), Math.ceil(r.h * cam.scale));
  }
  ctx.imageSmoothingEnabled = true;
}

const cachedChunks = new Map<string, ReturnType<typeof regionChunk> & { key: string; fetchedAt: number }>();
function regionChunkCached(cx: number, cy: number): (ReturnType<typeof regionChunk> & { key: string; fetchedAt: number }) | null {
  return cachedChunks.get(`${cx}:${cy}`) ?? null;
}
function chunkBitmapOf(cx: number, cy: number): HTMLCanvasElement | null {
  const c = regionChunkCached(cx, cy);
  return c ? chunkBitmap(c) : null;
}


// ---------- Что стоит на земле ----------

/** Владение города: мягкая заливка и черта по краю (`border.ts`). Стенд печёт её прямо в кадр. */
function drawRealm(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport): void {
  const R = Math.ceil(SCENE.realm) + 2;
  const x0 = SCENE.home.x - R;
  const y0 = SCENE.home.y - R;
  const w = R * 2 + 1;
  const f = new Float32Array(w * w);
  for (let j = 0; j < w; j++) {
    for (let i = 0; i < w; i++) {
      const x = x0 + i;
      const y = y0 + j;
      f[j * w + i] = geoTerrain(SEED, x, y) !== 'water' && Math.hypot(x - SCENE.home.x, y - SCENE.home.y) < SCENE.realm ? 1 : 0;
    }
  }
  const soft = soften(f, w, w);
  // Заливка: поле владения растром клетка-в-пиксель, растянутым со сглаживанием, — как у `zones.ts`.
  const tint = makeCanvas(w, w);
  const tc = tint.getContext('2d');
  if (tc) {
    const img = tc.createImageData(w, w);
    for (let k = 0; k < w * w; k++) {
      img.data[k * 4] = 232;
      img.data[k * 4 + 1] = 164;
      img.data[k * 4 + 2] = 60;
      img.data[k * 4 + 3] = soft[k] * 46;
    }
    tc.putImageData(img, 0, 0);
    const [sx, sy] = toScreen(cam, vp, x0, y0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(tint, sx, sy, w * cam.scale, w * cam.scale);
  }
  const segs = contour(soft, w, w, x0, y0, 0.5);
  ctx.beginPath();
  for (const [ax, ay, bx, by] of segs) {
    const [sx, sy] = toScreen(cam, vp, ax, ay);
    const [ex, ey] = toScreen(cam, vp, bx, by);
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
  }
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(34, 22, 12, 0.55)';
  ctx.lineWidth = 4.5;
  ctx.stroke();
  ctx.strokeStyle = OWN;
  ctx.lineWidth = 2.2;
  ctx.setLineDash([9, 4]);
  ctx.stroke();
  ctx.setLineDash([]);
}

function marchPoint(): { x: number; y: number } {
  const t = SCENE.march;
  return {
    x: SCENE.home.x + 0.5 + (SCENE.lair.x - SCENE.home.x) * t,
    y: SCENE.home.y + 0.5 + (SCENE.lair.y - SCENE.home.y) * t,
  };
}

/** Путь похода: пройденное — тускло, оставшееся — пунктиром следов к цели. Линии кадра, как у игры. */
function drawRoute(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport): void {
  const a = toScreen(cam, vp, SCENE.home.x + 0.5, SCENE.home.y + 0.5);
  const m = marchPoint();
  const b = toScreen(cam, vp, m.x, m.y);
  const c = toScreen(cam, vp, SCENE.lair.x + 0.5, SCENE.lair.y + 0.5);
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(30, 20, 12, 0.35)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(b[0], b[1]);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(30, 20, 12, 0.6)';
  ctx.lineWidth = 4.5;
  ctx.setLineDash([2, 7]);
  ctx.beginPath();
  ctx.moveTo(b[0], b[1]);
  ctx.lineTo(c[0], c[1]);
  ctx.stroke();
  ctx.strokeStyle = '#f1e3bd';
  ctx.lineWidth = 2.6;
  ctx.stroke();
  ctx.setLineDash([]);
  // Цель: кольцо у логова.
  ctx.strokeStyle = 'rgba(241, 227, 189, 0.9)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(c[0], c[1], cam.scale * 0.55, cam.scale * 0.34, 0, 0, Math.PI * 2);
  ctx.stroke();
}

function drawPlaces(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, dpr: number, old: boolean): void {
  const px = cam.scale;
  const b = miniBucket(px);
  const [cx, cy] = toScreen(cam, vp, SCENE.home.x + 0.5, SCENE.home.y + 0.5);
  const [lx, ly] = toScreen(cam, vp, SCENE.lair.x + 0.5, SCENE.lair.y + 0.5);
  if (old) {
    const city: OldLook = { stage: 'town', relation: 'self', mine: true, variant: 1, castle: true, ruin: false, sacked: false } as OldLook;
    const den: OldLook = { stage: 'camp', relation: 'barbarian', mine: false, variant: 2, castle: false, ruin: false, sacked: false } as OldLook;
    oldSettlement(ctx, den, px, dpr, lx, ly);
    oldSettlement(ctx, city, px, dpr, cx, cy);
    return;
  }
  const den: PlaceLook = { kind: 'lair', stage: 'village', color: RELATION_META.barbarian.color, own: false, variant: 1, sacked: false };
  const home: PlaceLook = { kind: 'city', stage: 'town', color: OWN, own: true, variant: 1, sacked: false };
  drawMini(ctx, placeSprite(den, px, dpr), px, b, lx, ly);
  drawMini(ctx, placeSprite(home, px, dpr), px, b, cx, cy);
}

function drawArmy(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, dpr: number, old: boolean): void {
  const m = marchPoint();
  const [ax, ay] = toScreen(cam, vp, m.x, m.y);
  const west = SCENE.lair.x < SCENE.home.x;
  if (old) {
    oldParty(ctx, oldPartyLook({ own: true, units: { spearman: 24, archer: 10 }, standing: false, seen: true, west }), cam.scale, dpr, ax, ay);
    return;
  }
  drawMini(ctx, hostSprite({ color: OWN, size: 2, west, camp: false }, cam.scale, dpr), cam.scale, miniBucket(cam.scale), ax, ay);
}

function drawNames(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, old: boolean): void {
  const [cx, cy] = toScreen(cam, vp, SCENE.home.x + 0.5, SCENE.home.y + 0.5);
  const [lx, ly] = toScreen(cam, vp, SCENE.lair.x + 0.5, SCENE.lair.y + 0.5);
  if (old) {
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const [name, x, y, mine] of [
      [SCENE.home.name, cx, cy, true],
      [SCENE.lair.name, lx, ly, false],
    ] as const) {
      const top = y + Math.max(6, cam.scale * 1.2);
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(10, 8, 6, 0.85)';
      ctx.strokeText(name, x, top);
      ctx.fillStyle = mine ? RELATION_META.self.color : '#e7dcc9';
      ctx.fillText(name, x, top);
    }
    return;
  }
  // Имена поселений — с того же масштаба, что у игры (`LABEL_FROM`): издали они сливаются в кашу.
  if (cam.scale >= LABEL_FROM) {
    placeLabel(ctx, SCENE.home.name, cx, cy + cam.scale * 1.05, true);
    placeLabel(ctx, SCENE.lair.name, lx, ly + cam.scale * 0.72, false);
  }
  const [sx, sy] = toScreen(cam, vp, SCENE.sea.x + 0.5, SCENE.sea.y + (cam.scale < LABEL_FROM ? 4.5 : 0.5));
  regionLabel(ctx, SCENE.sea.name, sx, sy, Math.max(13, Math.min(22, cam.scale * 0.42)), true);
}

/** Сколько клеток вокруг города разведано в пробе края: дальше — пергамент старой карты. */
const KNOWN_R = 15;

/** Край старой карты поверх земли (`parchment.ts`) — проба вида: в игре туман пока прежний (этап 2). */
function drawEdge(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport): void {
  const r = viewRect(cam, vp);
  const area = { x: Math.floor(r.x) - 1, y: Math.floor(r.y) - 1, w: Math.ceil(r.w) + 3, h: Math.ceil(r.h) + 3 };
  const known = (x: number, y: number): number => {
    const d = Math.hypot(x - SCENE.home.x - 0.5, y - SCENE.home.y - 0.5);
    return d < KNOWN_R - 1 ? 1 : d > KNOWN_R + 1 ? 0 : (KNOWN_R + 1 - d) / 2;
  };
  const canvas = bakeParchment(SEED, area, (x, y) => geoTerrain(SEED, x, y), known);
  const [sx, sy] = toScreen(cam, vp, area.x, area.y);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(canvas, sx, sy, (canvas.width / PARCHMENT_PX) * cam.scale, (canvas.height / PARCHMENT_PX) * cam.scale);
}

/** Ночь: умножение синим на весь кадр и тёплые огни поселений поверх — одна заливка и два пятна. */
function drawNight(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport): void {
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = '#3b4870';
  ctx.fillRect(0, 0, vp.w, vp.h);
  ctx.globalCompositeOperation = 'lighter';
  for (const [p, r, a] of [
    [SCENE.home, 1.2, 0.5],
    [SCENE.lair, 0.55, 0.45],
  ] as const) {
    const [x, y] = toScreen(cam, vp, p.x + 0.5, p.y + 0.4);
    const rr = r * cam.scale;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rr);
    g.addColorStop(0, `rgba(255, 170, 80, ${a})`);
    g.addColorStop(1, 'rgba(255, 170, 80, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - rr, y - rr, rr * 2, rr * 2);
  }
  ctx.restore();
}

function drawPaper(ctx: CanvasRenderingContext2D, vp: Viewport): void {
  const grain = ctx.createPattern(grainTile(), 'repeat');
  if (grain) {
    ctx.fillStyle = grain;
    ctx.fillRect(0, 0, vp.w, vp.h);
  }
  ctx.drawImage(vignette(), 0, 0, vp.w, vp.h);
}


// ---------- Галерея миниатюр (view=objects) ----------
//
// Всё, что кадр игры рисует миниатюрой и значком, — рядами над настоящей равниной, с подписью под каждым:
// места по стадиям, пепелище и разорение, войска по размерам в обе стороны, лагеря, осадные работы по
// ступеням, значки дальнего масштаба, стяги, бейджи и знаки участи. Раскладка — по ширине экрана; сколько
// места ей нужно, страница пишет в `dataset.need`, и снимок подгоняет под это экран (`map-tw-shots.ts`).

const STAGE_RU: Record<Stage, string> = { camp: 'лагерь', village: 'деревня', stronghold: 'крепость', town: 'город' };
const STAGE_LIST: Stage[] = ['camp', 'village', 'stronghold', 'town'];
const FOE = RELATION_META.enemy.color;
const BARB = RELATION_META.barbarian.color;
const NEUTRAL = RELATION_META.neutral.color;
const ALLY = RELATION_META.ally.color;

/** Предмет галереи: что нарисовано, подпись и сколько он занимает от своей точки, CSS px. */
interface Exhibit {
  cap: string;
  l: number;
  r: number;
  up: number;
  down: number;
  draw: (ctx: CanvasRenderingContext2D, sx: number, sy: number) => void;
  /** Тело — цель пальца, CSS px от точки (рамка при `boxes=1`). */
  body?: { rx: number; up: number; down: number };
}

/**
 * Миниатюра в клетках: размеры спрайта растягиваются из корзины, как в кадре игры. Спрайт берётся заново
 * при рисовании — галерея на корзине 80 весит больше кэша (16 МБ), и спрайт, взятый для раскладки, к
 * своему ходу мог быть уже вытеснен (обнулён) — как в кадре игры, где спрайт берут прямо перед копией.
 */
function miniExhibit(cap: string, get: () => Mini, px: number, body: Body | null, extra?: Exhibit['draw']): Exhibit {
  const k = px / miniBucket(px);
  const m = get();
  return {
    cap,
    l: m.ax * k,
    r: (m.w - m.ax) * k,
    up: m.ay * k,
    down: (m.h - m.ay) * k,
    draw: (ctx, sx, sy) => {
      drawMini(ctx, get(), px, miniBucket(px), sx, sy);
      extra?.(ctx, sx, sy);
    },
    body: body ? { rx: body.rx * px, up: body.up * px, down: body.down * px } : undefined,
  };
}

/** Значок постоянного размера: спрайт как есть, без растяжки; берётся заново при рисовании, как миниатюра. */
function fixedExhibit(cap: string, get: () => Mini): Exhibit {
  const m = get();
  return {
    cap,
    l: m.ax,
    r: m.w - m.ax,
    up: m.ay,
    down: m.h - m.ay,
    draw: (ctx, sx, sy) => ctx.drawImage(get().canvas, sx - m.ax, sy - m.ay, m.w, m.h),
    body: { rx: Math.max(m.ax, m.w - m.ax), up: m.ay, down: m.h - m.ay },
  };
}

function placeExhibit(cap: string, l: PlaceLook, px: number, dpr: number): Exhibit {
  return miniExhibit(cap, () => placeSprite(l, px, dpr), px, placeBody(l));
}

function hostExhibit(cap: string, l: HostLook, px: number, dpr: number): Exhibit {
  return miniExhibit(cap, () => hostSprite(l, px, dpr), px, hostBody(l));
}

/** Осада целиком, как в игре: ров и задние рогатки под двором, город, передние поверх, лагерь сбоку. */
function siegeExhibit(px: number, dpr: number): Exhibit {
  const back = worksSprite(8, 8, 'back', px, dpr);
  const city: PlaceLook = { kind: 'city', stage: 'stronghold', color: NEUTRAL, own: false, variant: 2, sacked: false };
  const camp: HostLook = { color: FOE, size: 3, west: false, camp: true };
  const cs = placeSprite(city, px, dpr);
  const hs = hostSprite(camp, px, dpr);
  const b = miniBucket(px);
  const k = px / b;
  // Сдвиг лагеря — тот же, что у кадра игры (`tw/scene.CAMP_DX`, `CAMP_DY`): шатры у стены, город виден.
  const dx = CAMP_DX * px;
  const dy = CAMP_DY * px;
  return {
    cap: 'осада 8/8',
    l: Math.max(back.ax, cs.ax) * k,
    r: Math.max((back.w - back.ax) * k, (cs.w - cs.ax) * k, dx + (hs.w - hs.ax) * k),
    up: Math.max(back.ay, cs.ay) * k,
    down: Math.max((back.h - back.ay) * k, (cs.h - cs.ay) * k, dy + (hs.h - hs.ay) * k),
    draw: (ctx, sx, sy) => {
      drawMini(ctx, worksSprite(8, 8, 'back', px, dpr), px, b, sx, sy);
      drawMini(ctx, placeSprite(city, px, dpr), px, b, sx, sy);
      drawMini(ctx, worksSprite(8, 8, 'front', px, dpr), px, b, sx, sy);
      drawMini(ctx, hostSprite(camp, px, dpr), px, b, sx + dx, sy + dy);
    },
  };
}

function worksExhibit(f: number, r: number, px: number, dpr: number): Exhibit {
  const b = miniBucket(px);
  return miniExhibit(`работы ${f}/${r}`, () => worksSprite(f, r, 'back', px, dpr), px, null, (ctx, sx, sy) => {
    // Точка города посередине кольца: работы обнимают двор, а не стоят сами по себе.
    ctx.fillStyle = 'rgba(243, 233, 216, 0.75)';
    ctx.beginPath();
    ctx.arc(sx, sy, 2.5, 0, Math.PI * 2);
    ctx.fill();
    drawMini(ctx, worksSprite(f, r, 'front', px, dpr), px, b, sx, sy);
  });
}

function pinExhibit(cap: string, l: PinLook, dpr: number): Exhibit {
  return fixedExhibit(cap, () => pinSprite(l, dpr));
}

function galleryRows(px: number, dpr: number, far: boolean): { title: string; items: Exhibit[] }[] {
  const rows: { title: string; items: Exhibit[] }[] = [];
  const place = (kind: PlaceKind, stage: Stage, color: string, own: boolean, variant: number, sacked = false): PlaceLook => ({
    kind,
    stage,
    color,
    own,
    variant,
    sacked,
  });
  if (!far) {
    rows.push({ title: 'свой город (own)', items: STAGE_LIST.map((st, i) => placeExhibit(STAGE_RU[st], place('city', st, OWN, true, i % 3), px, dpr)) });
    rows.push({
      title: 'чужой город (нейтрал)',
      items: STAGE_LIST.map((st, i) => placeExhibit(STAGE_RU[st], place('city', st, NEUTRAL, false, (i + 1) % 3), px, dpr)),
    });
    const castleColors = [NEUTRAL, ALLY, FOE, FOE];
    const castleNames = ['нейтр', 'союз', 'враг', 'враг'];
    rows.push({
      title: 'замок',
      items: STAGE_LIST.map((st, i) => placeExhibit(`${STAGE_RU[st]}·${castleNames[i]}`, place('castle', st, castleColors[i], false, i % 3), px, dpr)),
    });
    rows.push({ title: 'логово', items: STAGE_LIST.map((st, i) => placeExhibit(STAGE_RU[st], place('lair', st, BARB, false, i % 3), px, dpr)) });
    rows.push({
      title: 'пепелище · разорено',
      items: [
        placeExhibit('пепел·лагерь', place('ruin', 'camp', BARB, false, 0), px, dpr),
        placeExhibit('пепел·крепость', place('ruin', 'stronghold', BARB, false, 1), px, dpr),
        placeExhibit('пепел·город', place('ruin', 'town', BARB, false, 2), px, dpr),
        placeExhibit('разор·деревня', place('city', 'village', FOE, false, 0, true), px, dpr),
        placeExhibit('разор·город', place('city', 'town', FOE, false, 1, true), px, dpr),
        placeExhibit('разор·замок', place('castle', 'stronghold', NEUTRAL, false, 2, true), px, dpr),
      ],
    });
    const sizes = [0, 1, 2, 3, 4] as const;
    const sizeCap = (s: number): string => (s === 0 ? '0 слух' : s === 4 ? '4 орда' : String(s));
    rows.push({ title: 'войско на восток (своё)', items: sizes.map((s) => hostExhibit(sizeCap(s), { color: OWN, size: s, west: false, camp: false }, px, dpr)) });
    rows.push({ title: 'войско на запад (враг)', items: sizes.map((s) => hostExhibit(sizeCap(s), { color: FOE, size: s, west: true, camp: false }, px, dpr)) });
    rows.push({
      title: 'лагерь войска',
      items: [
        hostExhibit('свой 1', { color: OWN, size: 1, west: false, camp: true }, px, dpr),
        hostExhibit('свой 2', { color: OWN, size: 2, west: false, camp: true }, px, dpr),
        hostExhibit('враг 3', { color: FOE, size: 3, west: false, camp: true }, px, dpr),
        hostExhibit('враг 4', { color: FOE, size: 4, west: false, camp: true }, px, dpr),
        hostExhibit('враг слух', { color: FOE, size: 0, west: false, camp: true }, px, dpr),
      ],
    });
    rows.push({
      title: 'осадные работы (фронт/тыл)',
      items: [worksExhibit(0, 0, px, dpr), worksExhibit(2, 2, px, dpr), worksExhibit(4, 4, px, dpr), worksExhibit(8, 8, px, dpr)],
    });
    rows.push({ title: 'осада как в игре', items: [siegeExhibit(px, dpr)] });
  }
  rows.push({
    title: `значки мест (${PIN_PX} px)`,
    items: [
      pinExhibit('свой', { kind: 'city', color: OWN, own: true }, dpr),
      pinExhibit('город', { kind: 'city', color: NEUTRAL, own: false }, dpr),
      pinExhibit('враг', { kind: 'city', color: FOE, own: false }, dpr),
      pinExhibit('союз', { kind: 'city', color: ALLY, own: false }, dpr),
      pinExhibit('замок', { kind: 'castle', color: FOE, own: false }, dpr),
      pinExhibit('замок', { kind: 'castle', color: NEUTRAL, own: false }, dpr),
      pinExhibit('логово', { kind: 'lair', color: BARB, own: false }, dpr),
      pinExhibit('пепел', { kind: 'ruin', color: BARB, own: false }, dpr),
    ],
  });
  const flags: Exhibit[] = [];
  for (const [color, who] of [
    [OWN, 'с'],
    [FOE, 'в'],
  ] as const) {
    for (const size of [0, 1, 2, 3, 4] as const) flags.push(fixedExhibit(`${who}${size}`, () => flagSprite({ color, size, camp: false }, dpr)));
  }
  flags.push(fixedExhibit('с·лаг', () => flagSprite({ color: OWN, size: 2, camp: true }, dpr)));
  flags.push(fixedExhibit('в·лаг', () => flagSprite({ color: FOE, size: 3, camp: true }, dpr)));
  rows.push({ title: 'стяги войск (с — своё, в — враг; число — размер)', items: flags });
  const badges: Exhibit[] = (['attack', 'troops', 'siege'] as BadgeKind[]).map((k) => fixedExhibit(k, () => badgeSprite(k, dpr)));
  rows.push({ title: `бейджи (${BADGE_PX} px)`, items: badges });
  rows.push({
    title: 'знак участи',
    items: (['burn', 'captives', 'plunder'] as Fate[]).map((f) => fixedExhibit(f, () => fellSprite(f, FELL_WORDS[f], dpr))),
  });
  return rows;
}

/** Раскладка и рисование галереи. Возвращает, сколько места ей нужно (ширина, высота), CSS px. */
function drawGallery(ctx: CanvasRenderingContext2D, vp: Viewport, px: number, dpr: number, far: boolean, boxes: boolean): { w: number; h: number } {
  const rows = galleryRows(px, dpr, far);
  const PAD = 10;
  const GAP = 10;
  const CAP = 12;
  ctx.font = '9px monospace';
  const capW = (s: string): number => ctx.measureText(s).width + 4;
  let y = PAD;
  // Ширина без переноса: по ней снимок подгоняет экран (строка, не влезшая в экран, уходит вниз).
  let maxW = 0;
  const label = (s: string, x: number, yy: number, font: string, color: string): void => {
    ctx.font = font;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(26, 20, 16, 0.85)';
    ctx.strokeText(s, x, yy);
    ctx.fillStyle = color;
    ctx.fillText(s, x, yy);
  };
  for (const row of rows) {
    label(row.title, PAD, y, '10px monospace', '#f2d590');
    y += 14;
    // Строки по ширине экрана: предмет, не влезший справа, уходит на новую строку того же ряда.
    let line: { e: Exhibit; ax: number }[] = [];
    const flush = (): void => {
      if (line.length === 0) return;
      const up = Math.max(...line.map((p) => p.e.up));
      const down = Math.max(...line.map((p) => p.e.down));
      const ay = y + up;
      for (const { e, ax } of line) {
        if (boxes) {
          ctx.save();
          ctx.setLineDash([3, 3]);
          ctx.strokeStyle = 'rgba(243, 233, 216, 0.6)';
          ctx.lineWidth = 1;
          ctx.strokeRect(ax - e.l + 0.5, ay - e.up + 0.5, e.l + e.r - 1, e.up + e.down - 1);
          ctx.restore();
        }
        e.draw(ctx, ax, ay);
        if (boxes && e.body) {
          ctx.strokeStyle = 'rgba(120, 220, 255, 0.85)';
          ctx.lineWidth = 1;
          ctx.strokeRect(ax - e.body.rx, ay - e.body.up, e.body.rx * 2, e.body.up + e.body.down);
        }
        ctx.font = '9px monospace';
        const cw = ctx.measureText(e.cap).width;
        label(e.cap, ax - cw / 2, ay + down + 2, '9px monospace', '#f3e9d8');
      }
      y = ay + down + CAP + GAP;
      line = [];
    };
    let x = PAD;
    let natural = PAD;
    for (const e of row.items) {
      ctx.font = '9px monospace';
      const half = capW(e.cap) / 2;
      const l = Math.max(e.l, half);
      const r = Math.max(e.r, half);
      natural += l + r + GAP;
      if (line.length > 0 && x + l + r > vp.w - PAD) {
        flush();
        x = PAD;
      }
      line.push({ e, ax: x + l });
      x += l + r + GAP;
    }
    maxW = Math.max(maxW, natural - GAP + PAD);
    flush();
  }
  return { w: Math.ceil(maxW), h: Math.ceil(y + PAD) };
}

function bench(cam: Camera, dpr: number, stats: Stats): void {
  const time = (f: () => unknown): number => {
    const t0 = performance.now();
    f();
    return performance.now() - t0;
  };
  const mtx = Math.floor((cam.cx - WORLD_ORIGIN.x) / MID_CELLS);
  const mty = Math.floor((cam.cy - WORLD_ORIGIN.y) / MID_CELLS);
  const mids: [number, number][] = [];
  for (let j = -1; j <= 0; j++) for (let i = -1; i <= 1; i++) mids.push([mtx + i, mty + j]);
  const sheetArea = (i: number): { x: number; y: number; w: number; h: number } => ({
    x: Math.floor(cam.cx) - 18 + i * 32,
    y: Math.floor(cam.cy) - 18,
    w: 36,
    h: 36,
  });
  const known = (x: number, y: number): number => {
    const d = Math.hypot(x - SCENE.home.x - 0.5, y - SCENE.home.y - 0.5);
    return d < KNOWN_R - 1 ? 1 : d > KNOWN_R + 1 ? 0 : (KNOWN_R + 1 - d) / 2;
  };
  const looks: [string, () => unknown][] = [
    ['miniCity', () => placeSprite({ kind: 'city', stage: 'town', color: OWN, own: true, variant: 1, sacked: false }, 44, dpr)],
    ['miniCastle', () => placeSprite({ kind: 'castle', stage: 'town', color: RELATION_META.neutral.color, own: false, variant: 0, sacked: false }, 44, dpr)],
    ['miniLair', () => placeSprite({ kind: 'lair', stage: 'town', color: RELATION_META.barbarian.color, own: false, variant: 2, sacked: false }, 44, dpr)],
    ['miniHost', () => hostSprite({ color: OWN, size: 4, west: false, camp: false }, 44, dpr)],
  ];
  for (let pass = 0; pass < 2; pass++) {
    const keep = pass === 1;
    for (const [tx, ty] of mids) {
      let baked: Canvas | null = null;
      const ms = time(() => (baked = bakeMid(SEED, tx, ty)));
      // Не испёкся (нет округи) — это не цена выпечки, а отказ: в замер не идёт.
      if (keep && baked) (stats.parts.mid ??= []).push(ms);
    }
    for (let i = 0; i < 3; i++) {
      const ms = time(() => bakeParchment(SEED, sheetArea(i), (x, y) => geoTerrain(SEED, x, y), known, SHEET_PX));
      if (keep) (stats.parts.sheet ??= []).push(ms);
    }
    for (const [name, make] of looks) {
      for (let i = 0; i < 3; i++) {
        dropMinis();
        const ms = time(make);
        if (keep) (stats.parts[name] ??= []).push(ms);
      }
    }
  }
}

export function mountMapTw(root: HTMLElement, p: URLSearchParams): void {
  document.title = 'TRIBE · стенд карты';
  const view = VIEWS[p.get('view') ?? 'start'] ?? VIEWS.start;
  const at = (p.get('at') ?? '').split(',').map(Number);
  const cam: Camera = {
    cx: (at.length === 2 && at.every(Number.isFinite) ? at[0] : view.at[0]) + 0.5,
    cy: (at.length === 2 && at.every(Number.isFinite) ? at[1] : view.at[1]) + 0.5,
    scale: Number(p.get('scale') ?? view.scale),
  };
  const old = p.get('old') === '1';
  setTwLook({ quality: qualityOf(p.get('quality')) ?? 'high', season: p.get('season') === 'winter' ? 1 : 0 });
  // Стенд кладёт куски Европы в кэш мира сам и печёт прямо по нему (docs/map_tw.md, раздел 13.4).
  setLand(cacheLand);

  const { ctx, vp, dpr } = setupCanvas(root);
  const rect = viewRect(cam, vp);
  const pad = 48 + Math.ceil(vp.w / cam.scale) + 8;
  const need = {
    x: Math.max(WORLD_ORIGIN.x, rect.x - pad),
    y: Math.max(WORLD_ORIGIN.y, rect.y - pad),
    w: Math.min(WORLD_SIZE, rect.w + pad * 2),
    h: Math.min(WORLD_SIZE, rect.h + pad * 2),
  };
  const t0 = performance.now();
  fillCache(need);
  for (const { key, cx, cy } of chunkKeysIn(need)) {
    void key;
    cachedChunks.set(`${cx}:${cy}`, { ...regionChunk(cx, cy), key: `${cx}:${cy}`, fetchedAt: 0 });
  }
  const fillMs = performance.now() - t0;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = PALETTE.void;
  ctx.fillRect(0, 0, vp.w, vp.h);
  // Прогрев: первая выпечка идёт по холодному коду, и её цена — цена JIT, а не выпечки. Меряется второй
  // проход по тем же тайлам и кускам (у прежней выпечки — свой кэш, поэтому её прогрев — соседний экран).
  const warm: Stats = { tiles: 0, bakeMs: [], parts: {}, chunks: 0, chunkMs: [] };
  const aside: Camera = { ...cam, cx: cam.cx + vp.w / cam.scale + 8 };
  drawOverview(ctx, old ? aside : cam, vp, old, warm);
  drawTiles(ctx, old ? aside : cam, vp, old, warm);
  ctx.fillStyle = PALETTE.void;
  ctx.fillRect(0, 0, vp.w, vp.h);
  const stats: Stats = { tiles: 0, bakeMs: [], parts: {}, chunks: 0, chunkMs: [] };
  drawOverview(ctx, cam, vp, old, stats);
  drawTiles(ctx, cam, vp, old, stats);
  const gallery = (p.get('view') ?? '').startsWith('objects');
  if (gallery) {
    // Галерея: только земля и миниатюры — ни владения, ни похода, ни бумаги поверх.
    const need = drawGallery(ctx, vp, cam.scale, dpr, p.get('view') === 'objects-far', p.get('boxes') === '1');
    document.body.dataset.need = `${need.w},${need.h}`;
    document.body.dataset.showcase = JSON.stringify({ view: p.get('view'), cam, tiles: stats.tiles, need });
    document.body.dataset.ready = '1';
    return;
  }
  if (!old) drawRealm(ctx, cam, vp);
  drawPlaces(ctx, cam, vp, dpr, old);
  if (!old && (p.get('edge') === '1' || p.get('view') === 'edge')) drawEdge(ctx, cam, vp);
  drawPaper(ctx, vp);
  if (p.get('night') === '1') drawNight(ctx, cam, vp);
  drawRoute(ctx, cam, vp);
  drawArmy(ctx, cam, vp, dpr, old);
  drawNames(ctx, cam, vp, old);

  // Замер этапа 2 (`bench=1`, docs/map_tw.md, раздел 8): тайл среднего масштаба, лист старой карты и
  // спрайты миниатюр — то, что печётся в игре по одному за кадр. Два прохода, меряется второй (первый —
  // прогрев JIT), медиана по шести тайлам, трём листам и трём выпечкам каждого вида миниатюры.
  if (!old && p.get('bench') === '1') bench(cam, dpr, stats);

  const parts: Record<string, number> = {};
  for (const [k, v] of Object.entries(stats.parts)) parts[k] = Math.round(median(v) * 100) / 100;
  const out = {
    view: p.get('view') ?? 'start',
    old,
    quality: old ? 'old' : (qualityOf(p.get('quality')) ?? 'high'),
    cam,
    tiles: stats.tiles,
    bakeMedianMs: Math.round(median(stats.bakeMs) * 100) / 100,
    bakeMaxMs: Math.round(Math.max(0, ...stats.bakeMs) * 100) / 100,
    parts,
    chunks: stats.chunks,
    chunkMedianMs: Math.round(median(stats.chunkMs) * 100) / 100,
    fillMs: Math.round(fillMs),
    overviewPx: OVERVIEW_PX,
  };
  document.body.dataset.showcase = JSON.stringify(out);
  if (p.get('clean') !== '1') {
    const cap = document.createElement('div');
    cap.style.cssText =
      'position:fixed;left:8px;top:8px;padding:4px 8px;font:11px/1.3 monospace;color:#f3e9d8;background:rgba(26,20,16,.7);border-radius:6px;white-space:pre;pointer-events:none';
    cap.textContent = `${out.quality} ${out.view} · тайлов ${out.tiles} · выпечка ${out.bakeMedianMs} мс`;
    root.appendChild(cap);
  }
  document.body.dataset.ready = '1';
}
