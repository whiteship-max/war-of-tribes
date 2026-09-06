// Залп стрел. Самый узнаваемый средневековый кадр — туча в небе, — и он должен
// читаться издалека, а не разбираться по одной стреле.
//
// Стрелы не считаются поштучно и цели себе не ищут. Залп в журнале — одно
// событие (`volley`: кто стрелял и скольких выбил), и рисуется он одной пачкой
// инстансов по общей параболе: разброс только по фазе вылета и по точке падения.
// Куда он летит, решает раскадровка из того же журнала (потери по секторам в
// стрелковой фазе), а не эта пачка.
import * as THREE from 'three';
import type { Volley } from '@/battle/replay';
import { INSTANCED } from '../materials';
import { PALETTE } from '../palette';

/**
 * Сколько стрел на одного выбитого. Залп много гуще потерь: попадает малая
 * часть, а летит туча — и в кадре важна именно туча.
 */
export const ARROWS_PER_MAN = 6;
/** Границы пачки: десяток ничего не скажет, тысяча ничего не добавит. */
export const ARROWS = { min: 34, max: 120 };

/**
 * Высота дуги над серединой пути. Выше не значит лучше: камера боя стоит на
 * шести-девяти метрах, и залп, поднятый под неё, читается палками в небе, а не
 * тучей над строем. Дуга должна проходить над головами и под камерой.
 */
const ARC = 2.4;
/** Разлёт точки падения вокруг цели. */
const SPREAD = { x: 2.2, z: 1.6 };
/** Длина стрелы и её толщина. */
const LEN = 0.66;
const R = 0.019;

/** Сколько стрел в этом залпе. Чистая функция: тот же залп — та же туча. */
export const arrowsOf = (men: number): number =>
  Math.max(ARROWS.min, Math.min(ARROWS.max, Math.round(men * ARROWS_PER_MAN)));

function hash(n: number): number {
  let h = Math.imul(n ^ 0x27d4eb2d, 0x165667b1) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2545f491) >>> 0;
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

/** Высота стрелы на доле пути: дуга от плеча стрелка до земли у цели. */
const height = (u: number): number => 1.2 + ARC * 4 * u * (1 - u) - 1.2 * u;

const DIR = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** Все залпы кадра — одним вызовом отрисовки. */
export class ArrowStorm {
  readonly mesh: THREE.InstancedMesh;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  // Светлое древко: туча стрел должна читаться на фоне травы, а не тонуть в ней.
  private c = new THREE.Color(PALETTE.wood);

  constructor(capacity = ARROWS.max * 2) {
    // Стрела — четырёхгранное древко без донцев: с двух метров она точка, с
    // двадцати — штрих, и большего от неё не нужно.
    const g = new THREE.CylinderGeometry(R, R * 0.6, 1, 4, 1, true).translate(0, 0.5, 0);
    this.mesh = new THREE.InstancedMesh(g, INSTANCED, capacity);
    this.mesh.name = 'arrows';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.count = 0;
  }

  update(volleys: readonly Volley[]): void {
    let at = 0;
    volleys.forEach((v, vi) => {
      const n = arrowsOf(v.men);
      for (let i = 0; i < n && at < this.mesh.instanceMatrix.count; i++) {
        const r1 = hash(vi * 7717 + i * 53 + 1);
        const r2 = hash(vi * 7717 + i * 53 + 2);
        const r3 = hash(vi * 7717 + i * 53 + 3);
        // Своя фаза у каждой стрелы: пачка растянута, а не летит одним диском.
        const u = clamp01((v.u - r3 * 0.34) / (1 - r3 * 0.34));
        // Ещё не сошедшая с тетивы стрела место в буфере НЕ занимает: иначе в
        // нём остаётся матрица прошлого кадра, и по небу висят чужие стрелы.
        if (u <= 0) continue;
        at += 1;
        const tx = v.toX + (r1 - 0.5) * SPREAD.x;
        const tz = v.toZ + (r2 - 0.5) * SPREAD.z;
        const x = v.fromX + (tx - v.fromX) * u;
        const z = v.fromZ + (tz - v.fromZ) * u;
        // Общая парабола на всех: одна формула, а не своя физика у каждой стрелы.
        const y = height(u);
        // Стрела смотрит вдоль своего движения: та же парабола чуть впереди.
        const du = 0.02;
        DIR.set((tx - v.fromX) * du, height(Math.min(1, u + du)) - y, (tz - v.fromZ) * du).normalize();
        this.p.set(x, y, z);
        this.s.set(1, LEN, 1);
        this.q.setFromUnitVectors(UP, DIR);
        this.m.compose(this.p, this.q, this.s);
        this.mesh.setMatrixAt(at - 1, this.m);
        this.mesh.setColorAt(at - 1, this.c);
      }
    });
    this.mesh.count = at;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.dispose();
  }
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
