// Камера-режиссёр (docs/gfx.md, «Камера»): ход без склеек, такт смотрит туда, где по журналу смысл, развязка — лицом к
// победителю. Камера ведётся так же, как в ролике: `TacticalCamera` идёт за режиссёром кадр за кадром.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { standBattle } from '../battle-stand';
import { twPlanOfRecord } from '../tw/record';
import { directorSceneOf } from '../tw/stage';
import type { TwPlan } from '../tw/plan';
import { TacticalCamera, cameraPosition, type CamBounds } from './camera';
import { beatsOf } from './beats';
import { BLEND_MAX, OPEN, beatCues, directorView } from './director';

const ASPECT = 390 / 844;
const BOUNDS: CamBounds = { minX: -200, maxX: 200, minZ: -200, maxZ: 200, minDist: 4.5, maxDist: 500 };

const planOf = (q: string): TwPlan => {
  const b = standBattle(new URLSearchParams(q));
  return twPlanOfRecord(b.result, b.us, b.troops, 'medium', b.militia, b.place, b.beastSide);
};

/** Ровный бой, неровный (погоня) и бой у брода: три разных хода журнала. */
const SET = ['replay=tw&men=600&foe=560&seed=7&place=woods,road', 'replay=tw&men=900&foe=400&seed=4', 'replay=tw&men=500&foe=500&seed=5&place=river,ford'].map((q) => ({ q, plan: planOf(q) }));

describe('камера-режиссёр', () => {
  it('склеек нет: камера, идущая за режиссёром, не прыгает между кадрами 30 к/с', () => {
    for (const { q, plan } of SET) {
      const scene = directorSceneOf(plan);
      const beats = beatsOf(plan.cast, plan.result, plan.timing);
      const cam = new TacticalCamera(directorView(scene, beats, plan.timing, 0, ASPECT), BOUNDS);
      cam.setAspect(ASPECT);
      const a = new THREE.Vector3();
      const b = new THREE.Vector3();
      cameraPosition(cam.now, 0, a);
      let worst = 0;
      for (let t = 1 / 30; t <= plan.seconds; t += 1 / 30) {
        cam.follow(directorView(scene, beats, plan.timing, t, ASPECT));
        cam.update(1 / 30);
        cameraPosition(cam.now, 0, b);
        worst = Math.max(worst, a.distanceTo(b));
        a.copy(b);
      }
      // Полтора метра за кадр — это 45 м/с на отъезде: ход, а не рывок (правило прежнего ролика, docs/battle-replay.md).
      expect(worst, q).toBeLessThan(1.5);
    }
  });

  it('общий план открывается вблизи за нашей первой линией и отъезжает; сшибка — у полосы, где её выбили больше', () => {
    for (const { q, plan } of SET) {
      const scene = directorSceneOf(plan);
      const beats = beatsOf(plan.cast, plan.result, plan.timing);
      const open = directorView(scene, beats, plan.timing, 0.2, ASPECT);
      const wide = directorView(scene, beats, plan.timing, OPEN.hold + OPEN.pull + 0.1, ASPECT);
      expect(open.dist, q).toBeLessThan(wide.dist * 0.6);
      // Открытие — над нашей стороной поля (мы на −Z).
      expect(open.tz, q).toBeLessThan(0);
      const clash = beats.find((b) => b.id === 'clash')!;
      const at = clash.at + 1.2;
      expect(at).toBeLessThan(beats[2]?.at ?? Infinity);
      const v = directorView(scene, beats, plan.timing, at, ASPECT);
      const spot = scene.spot(clash.focus!.side, clash.focus!.sector, at)!;
      expect(Math.abs(v.tx - spot.x), q).toBeLessThan(6);
      expect(v.dist, q).toBeLessThan(wide.dist);
    }
  });

  it('перелом смотрит на сектор, с которого бой пошёл к исходу; после боя камера — низко над полем, из-за наших', () => {
    let turns = 0;
    for (const { q, plan } of SET) {
      const scene = directorSceneOf(plan);
      const beats = beatsOf(plan.cast, plan.result, plan.timing);
      const ti = beats.findIndex((b) => b.id === 'turn');
      const turn = beats[ti];
      if (turn) {
        turns++;
        // Камера пришла к перелому: тронулась (`beatCues`) и прошла переход, но ещё держит его (3.2 с от начала такта).
        const at = Math.max(turn.at, beatCues(beats)[ti]) + Math.min(BLEND_MAX, 3);
        const v = directorView(scene, beats, plan.timing, at, ASPECT);
        const spot = scene.spot(turn.focus!.side, turn.focus!.sector, turn.at + 0.5)!;
        expect(Math.abs(v.tx - spot.x), q).toBeLessThan(6);
      }
      const coda = directorView(scene, beats, plan.timing, plan.seconds, ASPECT);
      const rout = directorView(scene, beats, plan.timing, plan.timing.end - 1.5, ASPECT);
      // После боя — из-за наших (азимут около нуля), ниже развязки и ближе к земле.
      expect(Math.abs(coda.yaw), q).toBeLessThan(1);
      expect(coda.pitch, q).toBeLessThan(rout.pitch);
    }
    expect(turns).toBeGreaterThan(0);
  });
});
