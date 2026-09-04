// Фигурки — жители и бойцы — рисуются инстансами. Одна геометрия на часть тела
// (ноги, туловище, голова, шапка, палка, щит), а на каждую фигурку — только
// матрица и цвет. Полсотни человек в городе стоили четыре с половиной сотни
// вызовов отрисовки: по мешу на деталь и ещё раз в теневом проходе. Теперь частей
// шесть, вызовов девять, и число людей на это не влияет.
//
// Агент (villagers.ts, soldiers.ts) не держит мешей: он правит позу своей Figure —
// положение, поворот, мах ног, наклон туловища, палку в руке, — а матрицы всех
// инстансов раз в кадр пишет пул. Цвета — из палитры: у каждой части свой
// цвет на фигурку, поэтому одежда по профессии и шлем по виду бойца не требуют
// отдельных материалов.
import * as THREE from 'three';
import { INSTANCED } from './materials';
import { PALETTE } from './palette';

export type PartName = 'leg' | 'torso' | 'head' | 'cap' | 'stick' | 'shield';

const PARTS: PartName[] = ['leg', 'torso', 'head', 'cap', 'stick', 'shield'];

/** Части, что отбрасывают тень: как у старых фигурок — туловище, голова и щит. */
const CASTS: PartName[] = ['torso', 'head', 'shield'];

/** Базовая палка: жердь жителя. Оружие бойца — та же геометрия, масштабом. */
export const STICK_LENGTH = 0.8;
export const STICK_RADIUS = 0.025;

/** Палка в руке: длина, радиус и наклон в плоскости плеч. */
export interface Stick {
  length: number;
  radius: number;
  tilt: number;
}

/** Поза одной фигурки. Агент правит поля, пул читает их раз в кадр. */
export class Figure {
  readonly position = new THREE.Vector3();
  rotationY = 0;
  /** Общий масштаб: дети — 0.7. */
  scale = 1;
  /** Мах ног вокруг X: левая на +swing, правая на −swing. */
  legSwing = 0;
  /** Наклон туловища вперёд-назад: рабочее покачивание. */
  torsoTilt = 0;
  /** Ширина плеч относительно жителя: у бойца чуть шире. */
  torsoWidth = 1;
  stick: Stick | null = null;
  shield = false;
  visible = true;
  readonly colors: Record<PartName, THREE.Color> = {
    leg: new THREE.Color(PALETTE.skin),
    torso: new THREE.Color(PALETTE.cloth),
    head: new THREE.Color(PALETTE.skin),
    cap: new THREE.Color(PALETTE.hair),
    stick: new THREE.Color(PALETTE.stake),
    shield: new THREE.Color(PALETTE.metal),
  };
}

const CAPACITY_STEP = 16;

const _root = new THREE.Matrix4();
const _local = new THREE.Matrix4();
const _tmp = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

function geometryOf(part: PartName): THREE.BufferGeometry {
  switch (part) {
    case 'leg':
      return new THREE.BoxGeometry(0.12, 0.3, 0.12);
    case 'torso':
      return new THREE.CylinderGeometry(0.16, 0.2, 0.45, 6);
    case 'head':
      return new THREE.SphereGeometry(0.15, 7, 6);
    case 'cap':
      return new THREE.SphereGeometry(0.155, 7, 5, 0, Math.PI * 2, 0, Math.PI / 2);
    case 'stick':
      return new THREE.CylinderGeometry(STICK_RADIUS, STICK_RADIUS, STICK_LENGTH, 4);
    case 'shield':
      return new THREE.CylinderGeometry(0.22, 0.22, 0.06, 8);
  }
}

/** Все фигурки сцены. Растёт по мере надобности, вызовов отрисовки от этого не прибавляется. */
export class FigurePool {
  readonly group = new THREE.Group();
  private meshes = {} as Record<PartName, THREE.InstancedMesh>;
  private figures: Figure[] = [];
  private capacity = 0;

  constructor() {
    this.group.name = 'figures';
    this.grow(CAPACITY_STEP);
  }

  add(f: Figure): void {
    if (this.figures.includes(f)) return;
    this.figures.push(f);
    if (this.figures.length > this.capacity) this.grow(this.capacity + CAPACITY_STEP);
  }

  remove(f: Figure): void {
    const i = this.figures.indexOf(f);
    if (i >= 0) this.figures.splice(i, 1);
  }

  get size(): number {
    return this.figures.length;
  }

  /** Пересобирает инстансы под новую ёмкость. Ноги — по две на фигурку. */
  private grow(capacity: number): void {
    for (const part of PARTS) {
      const old = this.meshes[part];
      if (old) {
        this.group.remove(old);
        old.dispose();
      }
      const n = part === 'leg' ? capacity * 2 : capacity;
      const mesh = new THREE.InstancedMesh(old?.geometry ?? geometryOf(part), INSTANCED, n);
      mesh.name = part;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = CASTS.includes(part);
      // Люди ходят по всему кадру; сфера по геометрии одной фигурки культуру только испортит.
      mesh.frustumCulled = false;
      this.meshes[part] = mesh;
      this.group.add(mesh);
    }
    this.capacity = capacity;
  }

  private write(part: PartName, index: number, f: Figure, x: number, y: number, z: number, rx: number, rz: number, sx = 1, sy = 1, sz = 1): void {
    _e.set(rx, 0, rz);
    _q.setFromEuler(_e);
    _pos.set(x, y, z);
    _s.set(sx, sy, sz);
    _local.compose(_pos, _q, _s);
    _tmp.multiplyMatrices(_root, _local);
    const mesh = this.meshes[part];
    mesh.setMatrixAt(index, _tmp);
    mesh.setColorAt(index, f.colors[part]);
  }

  /** Пишет матрицы и цвета всех фигурок. Зовётся раз в кадр после update агентов. */
  update(): void {
    const n = this.figures.length;
    for (let i = 0; i < n; i++) {
      const f = this.figures[i];
      if (!f.visible) {
        for (const part of PARTS) this.meshes[part].setMatrixAt(i, ZERO);
        this.meshes.leg.setMatrixAt(i * 2 + 1, ZERO);
        continue;
      }
      _e.set(0, f.rotationY, 0);
      _q.setFromEuler(_e);
      _s.setScalar(f.scale);
      _root.compose(f.position, _q, _s);
      // Ноги качаются вокруг своей середины — как у старых фигурок.
      this.write('leg', i * 2, f, -0.08, 0.15, 0, f.legSwing, 0);
      this.write('leg', i * 2 + 1, f, 0.08, 0.15, 0, -f.legSwing, 0);
      this.write('torso', i, f, 0, 0.52, 0, f.torsoTilt, 0, f.torsoWidth, 1, f.torsoWidth);
      this.write('head', i, f, 0, 0.9, 0, 0, 0);
      this.write('cap', i, f, 0, 0.92, 0, 0, 0);
      if (f.stick) {
        const k = f.stick.radius / STICK_RADIUS;
        const len = f.stick.length / STICK_LENGTH;
        // Длинное древко держат выше: середина уезжает вверх на четверть прибавки.
        this.write('stick', i, f, 0.22, 0.55 + (f.stick.length - STICK_LENGTH) * 0.25, 0.05, 0, f.stick.tilt, k, len, k);
      } else this.meshes.stick.setMatrixAt(i, ZERO);
      if (f.shield) this.write('shield', i, f, -0.24, 0.58, 0.06, 0, Math.PI / 2);
      else this.meshes.shield.setMatrixAt(i, ZERO);
    }
    for (const part of PARTS) {
      const mesh = this.meshes[part];
      mesh.count = part === 'leg' ? n * 2 : n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
}
