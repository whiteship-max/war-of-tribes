/**
 * Бюджет кадра промыслов — счётом по графу сцены (docs/minigames.md, 8; потолки по ступени — docs/polish.md, П-4): тот
 * же граф, что рисуется (`world.furnish`), с той лепкой, с которой сцена встаёт на ступени (`Play.dress`). Область: все
 * четыре игры (рыбалка — у реки и у моря), три ступени, у каждой — её тень (`tier.SHADOWS`: у пола теней нет). Точка
 * внутри области — в графе есть то, ради чего игра: ягоды инстансами, стадо, олени с луком, вода с удочкой.
 */
import { describe, expect, it } from 'vitest';
import { MINI_BUDGET, budgetOf } from './budget';
import * as THREE from 'three';
import { TIERS } from '@/prologue/look';
import { Dome } from '@/prologue/dome';
import { Surfaces } from '@/prologue/surface';
import { BerriesPlay } from './berriesPlay';
import { HerdPlay } from './herdPlay';
import { furnish } from './world';

describe('промыслы: бюджет кадра', () => {
  for (const [id, shore] of [
    ['berries', 'river'],
    ['herd', 'river'],
    ['hunt', 'river'],
    ['fish', 'river'],
    ['fish', 'sea'],
  ] as const) {
    for (const tier of TIERS) {
      it(`${id}${id === 'fish' ? ` (${shore})` : ''}, ${tier}: вызовов и треугольников не больше потолка ступени`, () => {
        const c = budgetOf(id, tier, shore);
        const lim = MINI_BUDGET[tier];
        expect(c.calls, 'в графе что-то есть').toBeGreaterThan(5);
        expect(c.calls + c.shadowCalls, `${id} вызовов`).toBeLessThanOrEqual(lim.calls);
        expect(c.triangles + c.shadowTriangles, `${id} треугольников`).toBeLessThanOrEqual(lim.triangles);
        if (tier === 'base') expect(c.shadowCalls, 'у пола теней нет').toBe(0);
      });
    }
  }

  it('потолок не растёт вниз по ступеням: телефон не дороже настольного, пол — не дороже телефона', () => {
    expect(MINI_BUDGET.lite.triangles).toBeLessThanOrEqual(MINI_BUDGET.full.triangles);
    expect(MINI_BUDGET.base.triangles).toBeLessThanOrEqual(MINI_BUDGET.lite.triangles);
    expect(MINI_BUDGET.lite.calls).toBeLessThanOrEqual(MINI_BUDGET.full.calls);
  });

  it('ягоды — одним вызовом на всю поляну, стадо — по вызову на породу, трава — одним вызовом', () => {
    const graph = (id: 'berries' | 'herd'): THREE.Object3D[] => {
      const scene = new THREE.Scene();
      const play = id === 'berries' ? new BerriesPlay(12345) : new HerdPlay(12345);
      play.dress('lite');
      furnish(scene, new Surfaces(), play, new THREE.PerspectiveCamera(), new Dome(), 'summer');
      const out: THREE.Object3D[] = [];
      scene.traverse((o) => out.push(o));
      return out;
    };
    const berries = graph('berries');
    // Сотня ягод — копии одной сетки: один меш на всю поляну, а не по мешу на ягоду.
    const b = berries.filter((o) => o.name === 'berries');
    expect(b.length).toBe(1);
    expect((b[0] as THREE.InstancedMesh).isInstancedMesh).toBe(true);
    expect((b[0] as THREE.InstancedMesh).count).toBeGreaterThan(50);
    const herd = graph('herd');
    // Стадо копиями: девять животных — по мешу на породу, а не по мешу на туловище и ноги каждого.
    const beasts = herd.filter((o) => ['sheep', 'goat', 'cow', 'lamb'].includes(o.name));
    expect(beasts.length).toBeLessThanOrEqual(4);
    for (const m of beasts) expect((m as THREE.InstancedMesh).isInstancedMesh, m.name).toBe(true);
    expect(beasts.reduce((n, m) => n + (m as THREE.InstancedMesh).count, 0)).toBeGreaterThanOrEqual(8);
    // Трава — тысяча пучков копиями: один меш на луг.
    for (const g of [...berries, ...herd].filter((o) => o.name === 'grass')) expect((g as THREE.InstancedMesh).count).toBeGreaterThan(300);
  });
});
