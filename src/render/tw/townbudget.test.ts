// Бюджет кадра роликов с настоящим городом за стеной (docs/polish.md, П-6) — подсчётом построенного, без браузера, как
// `siege/budget.test.ts` и `tw/budget.test.ts`: сцена собирается как в игре — раскладка, вырез, город под ролик (поток
// сборки здесь же), — и обходится. Текстуры города — общие с городом игры (`CityShare`): в игре ролик их не множит, и в
// счёт они не идут. Худший кадр: у осады — начало и середина каждого эпизода, у боя — построение войска на потолке фигур.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { QUALITIES, type Quality } from '../quality';
import { TW_BUDGET, TW_SPEC } from '../reel/spec';
import { SHADOW_LAYER } from '../reel/crowd';
import { showOfSiege } from '@/ui/battle/siege';
import { standSiege } from '../siege/stand';
import { siegeReel } from '../siege/reel';
import { SiegeStage } from '../siege/stage';
import { layoutOf } from '../siege/layout';
import { standBattle } from '../battle-stand';
import { twPlanOfRecord } from './record';
import { TwStage } from './stage';
import { frameOf, houseOfTown, townCut } from './town';
import { townBackdrop, type TownBackdrop } from '../city/backdrop';
import { cityPlan } from '../city/layout';
import { cityUniforms } from '../city/material';
import type { CityShare } from '../city/index';
import type { TwWall } from './site';

const PLAN = cityPlan();
/** Город игры: план тот же, текстуры — пустые (счёт их не видит). */
const share = (q: Quality): CityShare => ({ quality: q, plan: PLAN, uniforms: cityUniforms(), map: new THREE.Texture(), land: new THREE.Texture() });

interface Count {
  calls: number;
  triangles: number;
  town: number;
  bytes: number;
}

/** Что нарисует кадр: видимый меш — вызов, треугольники на инстансы; тень — второй раз. Город — отдельной строкой. */
function count(scene: THREE.Scene, bytes: number): Count {
  let calls = 0;
  let triangles = 0;
  let town = 0;
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    for (let p: THREE.Object3D | null = m; p; p = p.parent) if (!p.visible) return;
    const g = m.geometry;
    const tris = ((g.index ? g.index.count : g.attributes.position.count) / 3) * ((m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : 1);
    const k = (m.layers.mask !== 1 << SHADOW_LAYER ? 1 : 0) + (m.castShadow ? 1 : 0);
    calls += k;
    triangles += tris * k;
    if (m.name.startsWith('town')) town += tris * k;
  });
  return { calls, triangles, town, bytes };
}

async function siegeWorst(name: string, q: Quality): Promise<Count & { samples: number }> {
  const { rec, report } = standSiege(new URLSearchParams(`case=${name}`));
  const show = showOfSiege(rec, report);
  const lay = layoutOf(show, q);
  const town = await townBackdrop(frameOf(lay.wall!), townCut(lay.wall!, lay.town!.inside, lay.town!.outside), q, share(q), false);
  const reel = siegeReel(show, q, town.houses.map((h) => houseOfTown(frameOf(lay.wall!), h)));
  const stage = new SiegeStage(reel, TW_SPEC[q], town);
  const cam = { camera: new THREE.PerspectiveCamera(40, 390 / 844, 0.5, 2000), now: { tx: 0, tz: 0, dist: 90, yaw: 0, pitch: 0.6 }, groundY: 0 };
  let worst: Count | null = null;
  let samples = 0;
  for (const ep of reel.episodes) {
    for (const t of [ep.at + 0.2, ep.at + ep.len * 0.5]) {
      stage.apply(t, cam as never);
      stage.crowd.update(stage.frame, null);
      samples++;
      const c = count(stage.scene, stage.textureBytes());
      if (!worst || c.triangles > worst.triangles) worst = c;
    }
  }
  stage.dispose();
  return { ...worst!, samples };
}

async function battleWorst(site: string, q: Quality): Promise<Count> {
  const b = standBattle(new URLSearchParams(`replay=tw&men=4000&foe=4000&seed=7&place=woods,road,river,ford&site=${site}`));
  const plan = twPlanOfRecord(b.result, b.us, b.troops, q, b.militia, b.place, b.beastSide, b.site);
  const w = plan.site!.wall as TwWall;
  const town: TownBackdrop = await townBackdrop(frameOf(w), townCut(w, plan.site!.town!.inside, plan.site!.town!.outside), q, share(q), false);
  const stage = new TwStage(plan, TW_SPEC[q], town);
  const cam = { camera: new THREE.PerspectiveCamera(), now: { tx: 0, tz: 0, dist: 120, yaw: 0, pitch: 0.8 }, groundY: 0 };
  stage.apply(1, cam as never, 1);
  stage.crowd.update(stage.frame, null);
  const c = count(stage.scene, stage.textureBytes());
  stage.dispose();
  return c;
}

const check = (what: string, q: Quality, c: Count): void => {
  const b = TW_BUDGET[q];
  if (process.env.TW_BUDGET_SHOW === '1') console.log(`${what} ${q}: вызовов ${c.calls} · треугольников ${c.triangles} (город ${c.town}) · текстуры ${(c.bytes / 1048576).toFixed(1)} МБ`);
  // Граница области: город в кадре есть — правило про ролик с городом.
  expect(c.town, `${what} ${q}: треугольников города`).toBeGreaterThan(20_000);
  expect(c.calls, `${what} ${q}: вызовов`).toBeLessThanOrEqual(b.calls);
  expect(c.triangles, `${what} ${q}: треугольников`).toBeLessThanOrEqual(b.triangles);
  expect(c.bytes / 1048576, `${what} ${q}: текстуры, МБ`).toBeLessThanOrEqual(b.textureMB);
};

describe('ролики с городом за стеной: бюджет кадра по уровням', () => {
  it.each(['gates', 'storm', 'hunger', 'broken', 'paid', 'repair'])('осада %s: с городом не дороже бюджета уровня ролика боя', async (name) => {
    for (const q of QUALITIES) {
      const c = await siegeWorst(name, q);
      expect(c.samples, `${name} ${q}: кадров в обходе`).toBeGreaterThan(4);
      check(`осада ${name}`, q, c);
    }
  }, 120_000);

  it.each(['wall', 'gate', 'sortie', 'camp', 'joint'])('бой у стены (%s), войско на потолке: с городом не дороже бюджета уровня', async (site) => {
    for (const q of QUALITIES) check(`бой ${site}`, q, await battleWorst(site, q));
  }, 120_000);
});
