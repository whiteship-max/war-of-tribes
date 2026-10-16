/**
 * Бюджет кадра промыслов — счётом по графу сцены, без видеокарты (docs/minigames.md, 8). Граф тот же, что рисуется:
 * обставляет его `world.furnish`, игры — те же классы, что в сцене; зерно — любое: число кустов, ягод, животных,
 * оленей, укрытий и деревьев берега от зерна не зависит.
 */
import * as THREE from 'three';
import { Dome } from '@/prologue/dome';
import { Surfaces } from '@/prologue/surface';
import type { MinigameId } from '@/game/data/minigames';
import { BerriesPlay } from './berriesPlay';
import { HerdPlay } from './herdPlay';
import { HuntPlay } from './huntPlay';
import { FishPlay } from './fishPlay';
import type { Shore } from './fishing';
import type { Play } from './stage';
import { aimRing } from './models';
import { frameCost, furnish, type FrameCost } from './world';
import { SHADOWS } from './tier';
import type { Tier } from '@/prologue/look';

/**
 * Потолок кадра по ступени (docs/polish.md, П-4, «Решения»). Прежде — один на всё: 80 вызовов и 30 тысяч треугольников
 * с тенью, мерка — кадр поляны предыстории на телефонной ступени. Звери П-4 — мягкие тела с мехом, и одна овца весит
 * как прежнее стадо целиком; поэтому потолок — по ступени, а не по поляне:
 *
 *   full  — настольный: 110 вызовов, 120 тысяч треугольников с тенью;
 *   lite  — телефон: 80 вызовов (вызов — дорогое на телефоне, его не прибавлено), 60 тысяч треугольников с тенью.
 *           Вершины телефону дёшевы рядом с заливкой: кадр промысла — восемь проходов конвейера по экрану в полтора
 *           раза плотнее (`stage.DPR_OF`), а шестьдесят тысяч треугольников — это три с половиной миллиона в секунду;
 *           не держит — сторож опускает ступень (`render/steady`);
 *   base  — пол: та же лепка, что у телефона (сторож опускает ступень, не перелепливая зверей), но без тени —
 *           и потолок без её прохода: 80 и 45 тысяч.
 */
export const MINI_BUDGET: Record<Tier, { calls: number; triangles: number }> = {
  full: { calls: 110, triangles: 120_000 },
  lite: { calls: 80, triangles: 60_000 },
  base: { calls: 80, triangles: 45_000 },
};

export function budgetOf(id: MinigameId, tier: Tier, shore: Shore = 'river', shadows = SHADOWS[tier]): FrameCost {
  const scene = new THREE.Scene();
  const surfaces = new Surfaces();
  const dome = new Dome();
  const camera = new THREE.PerspectiveCamera(72, 390 / 844, 0.05, 90);
  const play: Play =
    id === 'berries'
      ? new BerriesPlay(12345)
      : id === 'herd'
        ? new HerdPlay(12345)
        : id === 'hunt'
          ? new HuntPlay(12345)
          : new FishPlay(12345, { shore, zone: shore === 'sea' ? 'med' : 'land', season: 'summer', rain: 0 });
  play.dress?.(tier);
  furnish(scene, surfaces, play, camera, dome, 'summer');
  const aim = aimRing();
  aim.visible = true;
  scene.add(aim);
  return frameCost(scene, shadows);
}
