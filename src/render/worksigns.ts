// Занятость показывает здание, а не человек.
//
// Раньше занятость читалась по людям: житель шёл от костра к своему зданию,
// топтался там и возвращался. Это стоило дорого (пути, повороты, матрицы на
// каждого) и сообщало ровно ничего: разглядеть, кто куда идёт, на телефоне
// нельзя. Хуже того, вышло наоборот нужному — чем лучше идут дела, тем пустее
// деревня: все при деле, и на площади никого.
//
// Теперь работает здание. У кузницы горит горн и идёт дым, у лесопилки ходит
// груз, у склада лежат мешки. Признак загорается, когда в здании есть рабочие,
// и гаснет, когда их нет, — это и есть весь язык. Ходьбы и поиска пути нет.
//
// Цена: один вызов отрисовки на все грузы разом (инстансы, цвет через
// instanceColor), один на весь дым труб (точки, weather.ts), а горн у кузницы
// был в модели и раньше — он просто гаснет без кузнецов.
import * as THREE from 'three';
import type { Building, BuildingTypeId, GameState } from '@/game/types';
import { handsCount, workerCount } from '@/game/derived';
import { INSTANCED } from './materials';
import { PALETTE } from './palette';
import { placeOf, plotRadius } from './plan';

/** Что носят у этого здания. Цвет — из палитры, своих hex здесь нет. */
export type LoadKind = 'sack' | 'log' | 'stone' | 'hide' | 'bone';

const LOAD_COLOR: Record<LoadKind, number> = {
  sack: PALETTE.cloth,
  log: PALETTE.wood,
  stone: PALETTE.stone,
  hide: PALETTE.hide,
  bone: PALETTE.bone,
};

export interface Sign {
  /** Груз у стены: один тюк лежит, второй ходит вверх-вниз — это и есть движение. */
  load?: LoadKind;
  /** Дым из трубы. Все трубы посёлка — одно облако точек: один вызов на всех. */
  smoke?: boolean;
  /** Горн. Он есть в модели кузницы: без кузнецов просто гаснет. */
  glow?: boolean;
}

/**
 * Признак занятости по типу здания. Здесь только те, где есть кому работать
 * (`job` в data/buildings.ts), плюс склад — у него рабочих нет никогда, а мешки
 * при полных закромах он показывать обязан, иначе главное здание посёлка стоит
 * мёртвым. У склада признак считается по запасам, а не по людям.
 */
export const WORK_SIGN: Partial<Record<BuildingTypeId, Sign>> = {
  gathering: { load: 'sack' },
  sawmill: { load: 'log' },
  quarry: { load: 'stone' },
  hunter_hut: { load: 'hide' },
  mine: { load: 'stone' },
  workshop: { load: 'log' },
  farm: { load: 'sack' },
  pen: { load: 'sack' },
  church: { smoke: true },
  smithy: { load: 'stone', smoke: true, glow: true },
  storage: { load: 'sack' },
};

/**
 * Работает ли здание — по этому зажигаются его признаки (у посёлка и у города одно правило). Склад —
 * исключение по запасам (`full` — закрома полны на виду), кузница — по заказам: кузнецы у горна без
 * заказа не работают. Двор, где работают одни невольники, работает: признак зажигают руки на местах.
 */
export const workBusy = (s: GameState, b: Building, full: boolean): boolean =>
  b.type === 'storage' ? full : b.type === 'smithy' ? workerCount(s, b.id) > 0 && (s.forge?.length ?? 0) > 0 : handsCount(s, b.id) > 0;

/** Высота дыма над зданием — над коньком, а не из стены. */
export const SMOKE_HEIGHT = 2.2;

/** Груз стоит сбоку от здания: по радиусу перед ним фасад, а сбоку он всегда виден. */
export function signSpot(type: BuildingTypeId): THREE.Vector3 {
  const spot = placeOf(type);
  const off = Math.min(1.5, plotRadius(type) * 0.7);
  return new THREE.Vector3(spot.x - Math.sin(spot.angle) * off, 0, spot.z + Math.cos(spot.angle) * off);
}

const SIZE = 0.5;
const LIFT = 0.7;
const CAPACITY_STEP = 8;

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _pos = new THREE.Vector3();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

interface Load {
  at: THREE.Vector3;
  color: THREE.Color;
  /** Сдвиг фазы: соседние здания не должны качать груз в такт. */
  phase: number;
}

/**
 * Грузы всех работающих зданий разом: два инстанса на здание — лежащий тюк и
 * ходящий над ним. Вызов отрисовки один, сколько бы зданий ни работало.
 */
export class WorkSigns {
  readonly group = new THREE.Group();
  private mesh!: THREE.InstancedMesh;
  private capacity = 0;
  private loads: Load[] = [];

  constructor() {
    this.group.name = 'worksigns';
    this.grow(CAPACITY_STEP);
  }

  private grow(capacity: number): void {
    const old = this.mesh;
    if (old) {
      this.group.remove(old);
      old.dispose();
    }
    const n = capacity * 2;
    const mesh = new THREE.InstancedMesh(old?.geometry ?? new THREE.BoxGeometry(SIZE, SIZE * 0.8, SIZE), INSTANCED, n);
    mesh.name = 'loads';
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    // Груз мелкий и стоит в пятне тени здания — своей тени ему не нужно.
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    this.mesh = mesh;
    this.capacity = capacity;
    this.group.add(mesh);
  }

  /** Список работающих зданий. Зовётся из sync, а не каждый кадр. */
  set(active: { type: BuildingTypeId; kind: LoadKind }[]): void {
    this.loads = active.map((a, i) => ({
      at: signSpot(a.type),
      color: new THREE.Color(LOAD_COLOR[a.kind]),
      phase: i * 1.7,
    }));
    if (this.loads.length > this.capacity) this.grow(this.loads.length + CAPACITY_STEP);
  }

  /** Пишет матрицы. Зовётся раз в кадр. */
  update(t: number): void {
    const mesh = this.mesh;
    for (let i = 0; i < this.loads.length; i++) {
      const load = this.loads[i];
      const k = Math.abs(Math.sin(t * 1.6 + load.phase));
      // Лежит.
      _pos.set(load.at.x, SIZE * 0.4, load.at.z);
      _e.set(0, load.phase, 0);
      _q.setFromEuler(_e);
      _s.setScalar(1);
      mesh.setMatrixAt(i * 2, _m.compose(_pos, _q, _s));
      mesh.setColorAt(i * 2, load.color);
      // Ходит: поднимается и опускается над первым, слегка поворачиваясь.
      _pos.set(load.at.x, SIZE * 0.4 + SIZE * 0.9 + k * LIFT, load.at.z);
      _e.set(0, load.phase + k * 0.9, 0);
      _q.setFromEuler(_e);
      _s.setScalar(0.9);
      mesh.setMatrixAt(i * 2 + 1, _m.compose(_pos, _q, _s));
      mesh.setColorAt(i * 2 + 1, load.color);
    }
    for (let i = this.loads.length * 2; i < this.capacity * 2; i++) mesh.setMatrixAt(i, ZERO);
    mesh.count = this.loads.length * 2;
    mesh.visible = this.loads.length > 0;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
}
