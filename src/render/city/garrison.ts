// Стража города — те же бойцы, что в роликах боя и осады (docs/polish.md, П-5): лучники на стене и копейщики у ворот
// одеты, запечены и нарисованы толпой роликов (`reel/crowd.ts`: облики по дальности, отсечение вне кадра, разброс в
// строю, герб державы на щитах и груди сюрко). Где они стоят и как ходят дозором, решает жизнь города (`life.ts`): этот
// кусок только рисует, и рисует то же место.
//
// Своя докачка после первого кадра города (`vite.config.ts`, дверь «город: стража»), как суета: толпа роликов в кусок
// города и в первую загрузку не едет. Пока кусок не приехал, стоят прежние фигуры стражи.
import * as THREE from 'three';
import { Crowd } from '../reel/crowd';
import { TW_SPEC } from '../reel/spec';
import { CLIP_INDEX, figureFrame, type FigureFrame, type Troupe, type TroupeUnit } from '../reel/troupe';
import { armsCode, armsOr } from '@/heraldry/arms';
import type { Quality } from '../quality';
import type { CityLife, GuardSpots } from './life';

/** Рост бойца роликов (1.05 сцены — 1.79 м эталона) в метрах города: стражник ростом с горожанина. */
export const GUARD_SCALE = 1.66;

export class CityGarrison {
  readonly group = new THREE.Group();
  private crowd: Crowd;
  private frame: FigureFrame;
  private spots: GuardSpots;
  private wallCap: number;
  private arms: string;

  constructor(
    private life: CityLife,
    quality: Quality,
    arms: string | null | undefined,
  ) {
    this.group.name = 'city-garrison';
    const cap = life.guardCap;
    this.wallCap = cap.wall;
    const n = cap.wall + cap.gate;
    // Два отряда: лучники на стене, копейщики у ворот — наши (цвет своей стороны, `side.ts`), с гербом державы.
    const units: TroupeUnit[] = [
      { id: 0, ours: true, kind: 'archer', face: 'archer', first: 0, figures: cap.wall, ranks: 1, depth: 0, fleeAt: null, banner: null },
      { id: 1, ours: true, kind: 'spear', face: 'spearman', first: cap.wall, figures: cap.gate, ranks: 1, depth: 0, fleeAt: null, banner: null },
    ];
    const troupe: Troupe = {
      units,
      unitOf: Int32Array.from({ length: n }, (_, i) => (i < cap.wall ? 0 : 1)),
      faceOf: Int16Array.from({ length: n }, (_, i) => (i < cap.wall ? 0 : 1)),
      faceIds: [
        { id: 'archer', kind: 'archer' },
        { id: 'spearman', kind: 'spear' },
      ],
      lx: new Float32Array(n),
      lz: new Float32Array(n),
      scale: new Float32Array(n).fill(GUARD_SCALE),
      tone: Float32Array.from({ length: n }, (_, i) => ((i * 37) % 11) * 0.01 - 0.05),
      deathAt: new Float32Array(n).fill(Infinity),
    };
    this.arms = armsCode(armsOr(arms));
    // Тени бойцов в городе нет (заместители — камера тени ролика): стражников мало, и стоят они на стене.
    this.crowd = new Crowd(troupe, { ...TW_SPEC[quality], shadow: 'none' }, { ours: this.arms, theirs: this.arms });
    this.group.add(this.crowd.group);
    this.frame = figureFrame(n);
    this.spots = { x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n), yaw: new Float32Array(n), moving: new Uint8Array(n) };
    life.hideGuards();
  }

  /** Герб державы сменился — на щитах и сюрко стражи тот же, что на стягах. */
  setArms(code: string | null | undefined): void {
    const key = armsCode(armsOr(code));
    if (key === this.arms) return;
    this.arms = key;
    this.crowd.setCoats({ ours: key, theirs: key });
  }

  /** Кадр стражи: места — от жизни города; клип — шаг у идущего дозорного, стойка у прочих; облик — по дальности. */
  update(t: number, camera: THREE.PerspectiveCamera): void {
    const f = this.frame;
    const { count, wall } = this.life.guardsInto(this.spots);
    const s = this.spots;
    f.shown.fill(0);
    for (let k = 0; k < count; k++) {
      // Места стены — первые `wallCap` фигур (лучники), посты ворот — после них (копейщики).
      const i = k < wall ? k : this.wallCap + (k - wall);
      f.x[i] = s.x[k];
      f.y[i] = s.y[k];
      f.z[i] = s.z[k];
      // Фигура города смотрит на +x при нуле, боец роликов — на +z: разворот на четверть круга.
      f.yaw[i] = s.yaw[k] + Math.PI / 2;
      f.clip[i] = s.moving[k] ? CLIP_INDEX.march : CLIP_INDEX.idle;
      f.time[i] = t + i * 0.37;
      f.shown[i] = 1;
    }
    this.crowd.update(f, camera);
  }

  dispose(): void {
    this.crowd.dispose();
  }
}
