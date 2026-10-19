// Облака над картой (docs/city.md, 15; docs/map_tw.md, 6): та же погода, что над городом (`ui/parts/weather`), — тени
// облаков бегут по земле региона, а издали над картой плывут и сами облака, как на карте кампании.
//
// Цена — заливка узором: облачный лист (тайл 256 px, бесшовный) печётся один раз на уровень облачности при первом
// облачном кадре (три листа, пара миллисекунд), а в кадре — одна заливка на тени и одна на облака (смесь соседних
// уровней — своим листом, К-1), без перебора облаков. Лист едет по ветру как функция часов страницы: сдвиг — скорость × время. На «Низком» облаков нет.
import { useGame } from '@/game/store';
import { ZONES, windTo, zoneOf } from '@/render/climate';
import { homeRegion, weatherNow } from '@/ui/parts/weather';
import type { Camera, Viewport } from '../grid';
import { makeCanvas } from '../paint';
import { mapLevel } from './quality';

/** Тайл листа, px, и сколько клеток мира он покрывает. */
const TILE = 256;
const TILE_CELLS = 46;
/** Скорость облаков, клеток в секунду: вблизи тень ползёт пикселем за секунду, издали — едва. */
const SPEED = 0.05;
/** Тень лежит со сдвигом от облака — к юго-востоку, на четверть тайла меньше клетки. */
const SHADOW_SHIFT = { x: 0.8, y: 1.1 };
/** Сколько облаков в листе по уровню облачности: редкие, кучевые, сплошь. */
const LEVELS = [7, 16, 30];

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Сеяный ряд — лист у всех один (это рисунок, не погода: погода — что и где на нём видно). */
function seeded(salt: number): () => number {
  let x = 0x9e3779b9 ^ salt;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}

interface Sheet {
  top: HTMLCanvasElement;
  shade: HTMLCanvasElement;
}

const sheets: (Sheet | null)[] = [null, null, null];

/** Лист облаков уровня `k`: кучевые клубы из мягких пятен, бесшовно по краям; светлый — облака, тёмный — тени. */
function sheet(k: number): Sheet {
  const have = sheets[k];
  if (have) return have;
  const top = makeCanvas(TILE, TILE);
  const shade = makeCanvas(TILE, TILE);
  const rnd = seeded(31 + k * 7);
  const tc = top.getContext('2d');
  const sc = shade.getContext('2d');
  for (let i = 0; i < LEVELS[k]; i++) {
    const cx = rnd() * TILE;
    const cy = rnd() * TILE;
    const r = (0.07 + rnd() * 0.08) * TILE * (k === 2 ? 1.3 : 1);
    // Клуб — пять-семь пятен вокруг середины.
    const puffs = 5 + Math.floor(rnd() * 3);
    for (let p = 0; p < puffs; p++) {
      const a = rnd() * Math.PI * 2;
      const d = rnd() * r * 0.8;
      const pr = r * (0.45 + rnd() * 0.5);
      for (const ox of [-TILE, 0, TILE])
        for (const oy of [-TILE, 0, TILE]) {
          const x = cx + Math.cos(a) * d + ox;
          const y = cy + Math.sin(a) * d * 0.7 + oy;
          if (x + pr < 0 || x - pr > TILE || y + pr < 0 || y - pr > TILE) continue;
          if (tc) {
            const g = tc.createRadialGradient(x, y - pr * 0.15, 0, x, y, pr);
            g.addColorStop(0, 'rgba(255, 255, 255, 0.55)');
            g.addColorStop(0.55, 'rgba(244, 244, 248, 0.32)');
            g.addColorStop(1, 'rgba(236, 238, 244, 0)');
            tc.fillStyle = g;
            tc.fillRect(x - pr, y - pr, pr * 2, pr * 2);
          }
          if (sc) {
            const g = sc.createRadialGradient(x, y, 0, x, y, pr);
            g.addColorStop(0, 'rgba(18, 24, 36, 0.4)');
            g.addColorStop(0.6, 'rgba(18, 24, 36, 0.2)');
            g.addColorStop(1, 'rgba(18, 24, 36, 0)');
            sc.fillStyle = g;
            sc.fillRect(x - pr, y - pr, pr * 2, pr * 2);
          }
        }
    }
  }
  const s = { top, shade };
  sheets[k] = s;
  return s;
}

/**
 * Смесь двух соседних листов — одним листом (К-1): облачность переливается между уровнями, и прежде кадр заливал экран
 * обоими листами, каждый своей долей, — два полных экрана на тени и два на облака. Смесь печётся в лист того же размера
 * при перемене доли больше чем на 1/32 (погода меняется минутами; 256 × 256 — доли миллисекунды), а кадр заливает её
 * одной заливкой. Наложение «поверх» сочетательно, и картинка та же, кроме места, где облака двух листов легли друг на
 * друга, — там тень темнее на доли процента.
 */
const MIX_STEPS = 32;
const blends: Record<'top' | 'shade', { k: number; m: number; canvas: HTMLCanvasElement } | null> = { top: null, shade: null };

function blend(part: 'top' | 'shade', k: number, m: number): HTMLCanvasElement {
  const have = blends[part];
  if (have && have.k === k && have.m === m) return have.canvas;
  const canvas = have?.canvas ?? makeCanvas(TILE, TILE);
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, TILE, TILE);
    ctx.globalAlpha = 1 - m / MIX_STEPS;
    ctx.drawImage(sheet(k)[part], 0, 0);
    ctx.globalAlpha = m / MIX_STEPS;
    ctx.drawImage(sheet(k + 1)[part], 0, 0);
    ctx.globalAlpha = 1;
  }
  blends[part] = { k, m, canvas };
  // Узор снимает холст в минуту создания: прежний узор этого холста показывал бы прежнюю смесь.
  patterns.delete(canvas);
  blendBakes++;
  return canvas;
}

/** Сколько раз пеклась смесь — тесту кэша. */
let blendBakes = 0;
export const cloudBlendBakes = (): number => blendBakes;

/** Лист на долю `mix` между уровнями `k` и `k + 1`: крайние доли — сам лист, между ними — смесь. */
function layer(part: 'top' | 'shade', k: number, mix: number): HTMLCanvasElement {
  const m = Math.round(mix * MIX_STEPS);
  if (m <= 0) return sheet(k)[part];
  if (m >= MIX_STEPS) return sheet(k + 1)[part];
  return blend(part, k, m);
}

/** Узор листа на этом холсте: один на пару, сдвиг ставится каждому кадру заново (`setTransform` узора). */
const patterns = new WeakMap<HTMLCanvasElement, { ctx: CanvasRenderingContext2D; pat: CanvasPattern | null }>();

function patternOf(ctx: CanvasRenderingContext2D, img: HTMLCanvasElement): CanvasPattern | null {
  const have = patterns.get(img);
  if (have && have.ctx === ctx) return have.pat;
  const pat = ctx.createPattern(img, 'repeat');
  patterns.set(img, { ctx, pat });
  return pat;
}

/** Залить кадр листом: начало листа — в клетке `ox`, `oy` мира. */
function fill(ctx: CanvasRenderingContext2D, img: HTMLCanvasElement, cam: Camera, vp: Viewport, ox: number, oy: number, alpha: number): void {
  if (alpha <= 0.01) return;
  const pat = patternOf(ctx, img);
  if (!pat) return;
  const k = (cam.scale * TILE_CELLS) / TILE;
  const sx = (ox - cam.cx) * cam.scale + vp.w / 2;
  const sy = (oy - cam.cy) * cam.scale + vp.h / 2;
  pat.setTransform(new DOMMatrix([k, 0, 0, k, sx, sy]));
  ctx.globalAlpha = alpha;
  ctx.fillStyle = pat;
  ctx.fillRect(0, 0, vp.w, vp.h);
}

/**
 * Облака кадра: под туманом и листом за границей региона, над землёй и местами. `night` — доля ночи: ночью теней нет,
 * облака темнеют ночной заливкой кадра. Вернёт, легло ли что-нибудь: оно плывёт само (шаг живого, `still.ts`).
 */
export function drawClouds(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, night: number): boolean {
  if (mapLevel() === 'low' || typeof DOMMatrix === 'undefined') return false;
  const s = useGame.getState().s;
  if (!s) return false;
  const w = weatherNow(s);
  const cover = Math.max(w.cloud, w.rain, w.snow);
  if (cover < 0.08) return false;
  // Облака плывут верхним ветром региона — тем же, что гонит тени по городу.
  const to = windTo(ZONES[zoneOf(homeRegion())].from);
  // Сдвиг — по часам страницы: где облако, игроку не важно, важно, что оно плывёт (погода — общая, `weatherNow`).
  const t = (performance.now() / 1000) % 1e6;
  const ox = to.x * SPEED * t;
  const oy = to.z * SPEED * t;
  // Уровень листа и доля соседнего: облачность переливается, а не переключается.
  const lv = Math.min(1.999, cover * 2);
  const k0 = Math.floor(lv);
  const mix = lv - k0;
  ctx.save();
  // Тени — днём; издали и вблизи одинаково.
  const shade = (1 - night) * smooth(0.08, 0.35, cover);
  if (shade > 0.01) fill(ctx, layer('shade', k0, mix), cam, vp, ox + SHADOW_SHIFT.x, oy + SHADOW_SHIFT.y, shade);
  // Облака — издали: вблизи камера под ними, видны только тени.
  const top = (1 - smooth(5, 16, cam.scale)) * smooth(0.15, 0.5, cover) * (1 - 0.35 * Math.max(w.rain, w.storm));
  if (top > 0.01) fill(ctx, layer('top', k0, mix), cam, vp, ox, oy, top);
  ctx.restore();
  // Плывут, только когда хоть что-то легло: ночью без теней и вблизи без облаков стоять нечему.
  return shade > 0.01 || top > 0.01;
}

/** Уборка: листы облаков отпускаются вместе с кадром карты. */
export function dropClouds(): void {
  sheets.fill(null);
  blends.top = null;
  blends.shade = null;
}
