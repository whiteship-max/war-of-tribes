// Караван: телега, которая выезжает из ворот за покупкой и возвращается с грузом.
//
// Покупка на рынке не мгновенная, и это должно быть видно, а не только написано
// в панели. Телега едет по главной улице — той самой, что идёт от ворот через
// торговые ряды, — поэтому дорога к воротам наконец для чего-то нужна.
//
// Своего состояния у телеги нет: сцена каждый кадр отдаёт ей долю пути
// (`derived.caravanProgress`), а всё остальное — чистая геометрия.
import * as THREE from 'three';
import { FIELD_ROAD, GATE_ANGLE, RING_RADIUS } from './plan';
import { M } from './buildings';

/** Откуда выезжает: от торговых рядов на воротной улице. */
const START_R = RING_RADIUS[2];

/** Докуда уезжает: за просёлок по угодьям, дальше её уже не видно за лесом. */
const FAR_R = FIELD_ROAD + 2;

/**
 * Доля пути, которую телега стоит «в отъезде» на дальнем конце. Без неё разворот
 * читается как отскок от невидимой стены.
 */
const DWELL = 0.12;

const smooth = (t: number): number => t * t * (3 - 2 * t);

export class CaravanAgent {
  readonly group = new THREE.Group();
  private wheels: THREE.Mesh[] = [];
  private cargo: THREE.Mesh;
  private driver: THREE.Group;
  private phase = Math.random() * 6;

  constructor(readonly id: number) {
    const g = this.group;
    // Кузов вытянут вдоль движения: телега едет носом вперёд.
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.3, 1.15), M.wood);
    body.position.y = 0.42;
    body.castShadow = true;
    g.add(body);
    for (const side of [-1, 1]) {
      for (const z of [-0.32, 0.32]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.07, 10), M.woodDark);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(side * 0.35, 0.24, z);
        wheel.castShadow = true;
        this.wheels.push(wheel);
        g.add(wheel);
      }
    }
    // Оглобли вперёд — за них телегу и тянут.
    g.add(shaft(-0.18), shaft(0.18));
    // Груз появляется только на обратной дороге: туда телега едет пустой.
    this.cargo = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.34, 0.85), M.hide);
    this.cargo.position.y = 0.72;
    this.cargo.castShadow = true;
    this.cargo.visible = false;
    g.add(this.cargo);

    this.driver = figure();
    this.driver.position.set(0.34, 0, 0.95);
    g.add(this.driver);
  }

  /** progress — доля пути 0..1 из состояния; t — время сцены для мелкой анимации. */
  update(progress: number, t: number): void {
    const p = Math.max(0, Math.min(1, progress));
    // Туда — первая половина, обратно — вторая; между ними короткая стоянка.
    const half = 0.5 - DWELL / 2;
    let k: number;
    let outward: boolean;
    if (p < half) {
      k = smooth(p / half);
      outward = true;
    } else if (p < half + DWELL) {
      k = 1;
      outward = true;
    } else {
      k = smooth(1 - (p - half - DWELL) / half);
      outward = false;
    }
    const r = START_R + (FAR_R - START_R) * k;
    const dir = outward ? 1 : -1;
    this.group.position.set(Math.cos(GATE_ANGLE) * r, 0, Math.sin(GATE_ANGLE) * r);
    this.group.rotation.y = Math.atan2(Math.cos(GATE_ANGLE) * dir, Math.sin(GATE_ANGLE) * dir);
    this.cargo.visible = !outward;

    const moving = k > 0.001 && k < 0.999;
    const spin = moving ? t * 4 : 0;
    for (const w of this.wheels) w.rotation.y = spin;
    this.driver.position.y = moving ? Math.abs(Math.sin(t * 8 + this.phase)) * 0.05 : 0;
  }
}

function shaft(x: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.9, 4), M.woodDark);
  m.rotation.x = Math.PI / 2;
  m.position.set(x, 0.4, 0.85);
  return m;
}

const SKIN = new THREE.MeshLambertMaterial({ color: 0xd9a77a, flatShading: true });
const COAT = new THREE.MeshLambertMaterial({ color: 0x8a6136, flatShading: true });

/** Возчик: та же фигурка, что и у жителей, только всегда при телеге. */
function figure(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.45, 6), COAT);
  body.position.y = 0.52;
  body.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 7, 6), SKIN);
  head.position.y = 0.9;
  head.castShadow = true;
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.3, 0.14), SKIN);
  legs.position.y = 0.15;
  g.add(legs, body, head);
  return g;
}
