/**
 * Бюджет кадра промыслов — счётом по графу сцены, без видеокарты (docs/minigames.md, 8). Граф тот же, что рисуется:
 * обставляет его `world.furnish`, игры — те же классы, что в сцене. Счёт — худший кадр, а не первый: зерно — с редким
 * (ягнёнок — девятое животное стада, земляника — свой куст), и в счёт идёт всё, что может показаться за игру, а не
 * только видное до «Начать» (руки с охапкой, рыба на крючке, `world.frameCost`). Число кустов, ягод, оленей, укрытий и
 * деревьев берега от зерна не зависит.
 */
import * as THREE from 'three';
import { Dome } from '@/prologue/dome';
import { Surfaces } from '@/prologue/surface';
import type { MinigameId } from '@/game/data/minigames';
import { BerriesPlay } from './berriesPlay';
import { layBerries } from './berries';
import { herdOf } from './herd';
import { HerdPlay } from './herdPlay';
import { HuntPlay } from './huntPlay';
import { FishPlay } from './fishPlay';
import type { Shore } from './fishing';
import { PRECIP_BOX, PRECIP_DIST, PRECIP_OF, castsShadow, type Play } from './stage';
import { WEATHER_LOOKS } from '@/render/climate';
import { CityPrecip } from '@/render/city/precip';
import { aimRing } from './models';
import { frameCost, furnish, type FrameCost } from './world';
import { SHADOWS } from './tier';
import type { Tier } from '@/prologue/look';

/**
 * Потолок кадра по ступени (docs/polish.md, П-4, «Решения»). Прежде — один на всё: 80 вызовов и 30 тысяч треугольников
 * с тенью, мерка — кадр поляны предыстории на телефонной ступени. П-4 — мягкие звери с мехом и места: лес, луг, трава
 * копиями; одна овца весит как прежнее стадо целиком, а травы на поляне — тысяча пучков. Поэтому потолок — по ступени:
 *
 *   full  — настольный: 120 вызовов, 160 тысяч треугольников с тенью;
 *   lite  — телефон: 80 вызовов (вызов — дорогое на телефоне, его не прибавлено), 80 тысяч треугольников с тенью.
 *           Вершины телефону дёшевы рядом с заливкой: кадр промысла — восемь проходов конвейера по экрану в полтора
 *           раза плотнее (`stage.DPR_OF`), а восемьдесят тысяч треугольников — это меньше пяти миллионов в секунду;
 *           не держит — сторож опускает ступень (`render/steady`);
 *   base  — пол: травы и подробности меньше (`places.DENSITY`), тени нет — и потолок без её прохода: 80 и 60 тысяч.
 */
export const MINI_BUDGET: Record<Tier, { calls: number; triangles: number }> = {
  full: { calls: 120, triangles: 160_000 },
  lite: { calls: 80, triangles: 80_000 },
  base: { calls: 80, triangles: 60_000 },
};

/** Первое зерно, у которого есть редкое: худший кадр игры. */
const firstWith = (has: (seed: number) => boolean): number => {
  let seed = 1;
  while (!has(seed)) seed++;
  return seed;
};
let rare: { berries: number; herd: number } | null = null;
const rareSeeds = (): { berries: number; herd: number } =>
  (rare ??= {
    berries: firstWith((s) => layBerries(s, { rare: true }).bushes.some((b) => b.kind === 'strawberry')),
    herd: firstWith((s) => herdOf(s, { rare: true }).beasts.some((b) => b.kind === 'lamb')),
  });

/**
 * Цена кадра промысла `id` на ступени `tier`. `wx` — осадки поверх сцены (`stage.loadPrecip`): дождь — струи и ближние
 * струи, снег — хлопья у человека и у камеры; счёт — уровня ступени (`stage.PRECIP_OF`), тень — по погоде.
 */
export function budgetOf(
  id: MinigameId,
  tier: Tier,
  shore: Shore = 'river',
  wx: 'rain' | 'snow' | null = null,
  shadows = wx ? castsShadow(tier, WEATHER_LOOKS[wx]) : SHADOWS[tier],
): FrameCost {
  const scene = new THREE.Scene();
  const surfaces = new Surfaces();
  const dome = new Dome();
  const camera = new THREE.PerspectiveCamera(72, 390 / 844, 0.05, 90);
  const play: Play =
    id === 'berries'
      ? new BerriesPlay(rareSeeds().berries)
      : id === 'herd'
        ? new HerdPlay(rareSeeds().herd)
        : id === 'hunt'
          ? new HuntPlay(12345)
          : new FishPlay(12345, { shore, zone: shore === 'sea' ? 'med' : 'land', season: 'summer', rain: 0 });
  play.dress?.(tier);
  furnish(scene, surfaces, play, camera, dome, 'summer');
  const aim = aimRing();
  aim.visible = true;
  scene.add(aim);
  // Спрятанное до поры — в счёт: руки с охапкой, рыба на крючке. Осадки — отдельно и только видное: снег в дождь не идёт.
  const cost = frameCost(scene, shadows, true);
  if (!wx) return cost;
  const p = new CityPrecip(PRECIP_OF[tier], undefined, false);
  // Кадр осадков — только чтобы они встали видимыми: свет, небо и буфер на счёт струй и хлопьев не влияют.
  p.update({
    t: 0,
    rain: wx === 'rain' ? 1 : 0,
    snow: wx === 'snow' ? 1 : 0,
    windX: 1,
    windZ: 0,
    wind: 0.5,
    center: new THREE.Vector3(),
    dist: PRECIP_DIST,
    box: PRECIP_BOX,
    camera,
    bufferHeight: 1266,
    light: 1,
    flash: 0,
    night: 0,
    sky: new THREE.Color(0.6, 0.65, 0.7),
    fogNear: 12,
    fogFar: 50,
  });
  const sky = new THREE.Scene();
  sky.add(p.group);
  const fall = frameCost(sky, shadows);
  p.dispose();
  return { calls: cost.calls + fall.calls, triangles: cost.triangles + fall.triangles, shadowCalls: cost.shadowCalls + fall.shadowCalls, shadowTriangles: cost.shadowTriangles + fall.shadowTriangles };
}
