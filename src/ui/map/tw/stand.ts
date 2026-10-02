// Стенд карты нового вида: `?showcase=map-tw` (docs/map_tw.md, раздел 10). Не игра: кусок настоящей
// Европы из атласа кладётся в кэш мира, а кадр печётся **один раз** — без цепочки кадров, без пальца.
// Тайлы печёт та же выпечка, что у игры (`bake.ts`; `old=1` — прежняя, `ground.ts`), поэтому стенд
// мерит её цену честно: то же место, тот же браузер, до и после.
//
//   ?showcase=map-tw                      Лигурийский берег: Генуя, Приморские Альпы, Апеннины
//   &at=684,1213  &scale=44               середина кадра (клетка мира) и масштаб, px на клетку
//   &view=start|near|mid|far|coast|mountains|forest|army    готовые ракурсы участка
//   &quality=low|medium|high              уровень (по умолчанию — высокий: «в полном качестве»)
//   &season=winter  &night=1              сезон выпечки и ночь поверх кадра
//   &old=1                                прежняя карта на том же участке — «до»
//   &clean=1                              без подписи стенда
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
import { chunkBitmap, overviewSrc } from '../tiles';
import { grainTile, makeCanvas, vignette } from '../paint';
import { OVERVIEW_PX, bakeChunk, bakeStats, bakeTile, chunkStats, setTwLook } from './bake';
import { armySprite, citySprite, drawMini, lairSprite, miniBucket } from './mini';
import { placeLabel, regionLabel } from './labels';
import { contour, soften } from './border';
import { PARCHMENT_PX, bakeParchment } from './parchment';
import { drawSettlement as oldSettlement, type Look as OldLook } from '../village';
import { drawParty as oldParty, lookOf as oldPartyLook } from '../party';
import { RELATION_META } from '@/world/data/meta';

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
  const tiles = new Map<string, HTMLCanvasElement>();
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
    let bmp: HTMLCanvasElement | null = null;
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
    const src = overviewSrc(fallback, r.w);
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
  drawMini(ctx, lairSprite(1, px, dpr), px, b, lx, ly);
  drawMini(ctx, citySprite({ color: OWN, own: true, variant: 1 }, px, dpr), px, b, cx, cy);
}

function drawArmy(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, dpr: number, old: boolean): void {
  const m = marchPoint();
  const [ax, ay] = toScreen(cam, vp, m.x, m.y);
  const west = SCENE.lair.x < SCENE.home.x;
  if (old) {
    oldParty(ctx, oldPartyLook({ own: true, units: { spearman: 24, archer: 10 }, standing: false, seen: true, west }), cam.scale, dpr, ax, ay);
    return;
  }
  drawMini(ctx, armySprite({ color: OWN, size: 2, west }, cam.scale, dpr), cam.scale, miniBucket(cam.scale), ax, ay);
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
  if (!old) drawRealm(ctx, cam, vp);
  drawPlaces(ctx, cam, vp, dpr, old);
  if (!old && (p.get('edge') === '1' || p.get('view') === 'edge')) drawEdge(ctx, cam, vp);
  drawPaper(ctx, vp);
  if (p.get('night') === '1') drawNight(ctx, cam, vp);
  drawRoute(ctx, cam, vp);
  drawArmy(ctx, cam, vp, dpr, old);
  drawNames(ctx, cam, vp, old);

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
