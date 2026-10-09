// Облака над картой (docs/city.md, 15; docs/map_tw.md, 6): та же погода, что над городом (`ui/parts/weather`), — тени
// облаков бегут по земле региона, а издали над картой плывут и сами облака, как на карте кампании.
//
// Цена — заливка узором: облачный лист (тайл 256 px, бесшовный) печётся один раз на уровень облачности при первом
// облачном кадре (три листа, пара миллисекунд), а в кадре — одна-две заливки на тени и одна-две на облака, без
// перебора облаков. Лист едет по ветру как функция часов страницы: сдвиг — скорость × время. На «Низком» облаков нет.
import { useGame } from '@/game/store';
import { ZONES, windTo, zoneOf } from '@/render/climate';
import { homeRegion, weatherNow } from '@/ui/parts/weather';
import type { Camera, Viewport } from '../grid';
import { makeCanvas } from '../paint';
import { twQuality } from './quality';

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

/** Залить кадр листом: начало листа — в клетке `ox`, `oy` мира. */
function fill(ctx: CanvasRenderingContext2D, img: HTMLCanvasElement, cam: Camera, vp: Viewport, ox: number, oy: number, alpha: number): void {
  if (alpha <= 0.01) return;
  const pat = ctx.createPattern(img, 'repeat');
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
  if (twQuality() === 'low' || typeof DOMMatrix === 'undefined') return false;
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
  if (shade > 0.01) {
    fill(ctx, sheet(k0).shade, cam, vp, ox + SHADOW_SHIFT.x, oy + SHADOW_SHIFT.y, shade * (1 - mix));
    fill(ctx, sheet(k0 + 1).shade, cam, vp, ox + SHADOW_SHIFT.x, oy + SHADOW_SHIFT.y, shade * mix);
  }
  // Облака — издали: вблизи камера под ними, видны только тени.
  const top = (1 - smooth(5, 16, cam.scale)) * smooth(0.15, 0.5, cover) * (1 - 0.35 * Math.max(w.rain, w.storm));
  if (top > 0.01) {
    fill(ctx, sheet(k0).top, cam, vp, ox, oy, top * (1 - mix));
    fill(ctx, sheet(k0 + 1).top, cam, vp, ox, oy, top * mix);
  }
  ctx.restore();
  // Плывут, только когда хоть что-то легло: ночью без теней и вблизи без облаков стоять нечему.
  return shade > 0.01 || top > 0.01;
}

/** Уборка: листы облаков отпускаются вместе с кадром карты. */
export function dropClouds(): void {
  sheets.fill(null);
}
