// Портрет советника совета Ратуши (РТ-1, docs/city_v3.md, «Решения РТ-1»): погрудно, тем же набором персонажа, что стоит в
// покоях (`kit/`, `advisor/`), — облик из зерна и возраста (`looks.lookOf`). Старший советник совета — тот, что встаёт у стола
// в покоях: один облик на портрете и в комнате.
//
// Рисуется по просьбе окна совета своим маленьким рендером в картинку и живёт в памяти, пока жива страница: цикла кадра нет
// (дверь кадра `render/loop` не нужна — кадр один), рендер гаснет сам, когда портретов не просят (`IDLE_MS`), и свой контекст
// WebGL отдаёт. Нет WebGL — портрета нет, окно показывает силуэт.
import * as THREE from 'three';
import { STILL, type Gesture } from '../folk';
import { pixelRatio } from '../../loop';
import { makeAdvisor } from './index';
import { lookOf } from './looks';

/** Размер портрета, css-пиксели: карточка должности 56 × 70 и строка просителя — тем же листом. */
export const PORTRAIT_W = 56;
export const PORTRAIT_H = 70;

/** Сколько рендер ждёт новой просьбы, прежде чем отдать контекст. */
const IDLE_MS = 4000;

let renderer: THREE.WebGLRenderer | null = null;
let idle: ReturnType<typeof setTimeout> | null = null;

function ensure(): THREE.WebGLRenderer {
  if (idle) clearTimeout(idle);
  idle = setTimeout(release, IDLE_MS);
  if (renderer) return renderer;
  const canvas = document.createElement('canvas');
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.NeutralToneMapping;
  // Плотность — дверью кадра (её потолок, `loop.DPR_CAP`): портрет на телефонном экране @2.
  r.setPixelRatio(pixelRatio());
  r.setSize(PORTRAIT_W, PORTRAIT_H, false);
  r.setClearColor(0x000000, 0);
  renderer = r;
  return r;
}

function release(): void {
  idle = null;
  if (!renderer) return;
  renderer.dispose();
  renderer.forceContextLoss();
  renderer = null;
}

/** Ключ портрета: зерно, должность и возраст годом — тот же человек с годами седеет. */
export const portraitKey = (seed: number, age: number, post: string): string => `${post}:${seed >>> 0}:${Math.floor(age)}`;

/**
 * Портрет картинкой (`data:`-адрес): поклон не нужен — стоит, чуть развёрнут к свету, взгляд прямо. Тёплый дневной свет
 * покоев (тот же, что у стенда фигур), фон прозрачный — рамку и подложку рисует окно.
 */
export function paintPortrait(seed: number, age: number, post: string): string {
  const r = ensure();
  const scene = new THREE.Scene();
  const k = makeAdvisor({ look: lookOf(seed, age, post), inside: false });
  try {
    scene.add(k.body.mesh);
    // Свет покоев у окна: тёплый, чуть приглушённый (лица набора нарисованы светом в листах — полная яркость их выбеливает),
    // контур — со стороны окна слева.
    k.u.uTint.value.setRGB(0.9, 0.84, 0.76);
    k.u.uRim.value.setRGB(0.34, 0.3, 0.24);
    k.u.uRimDir.value.set(-0.75, 0.35, 0.55).normalize();
    const g: Gesture = { ...STILL };
    k.pose(1.484, 0, 0, g, g);
    const q = k.pose(1.5, 0, 0, g, g);
    const yaw = -0.26;
    k.body.pose({ x: 0, y: 0, z: 0, yaw, lift: q.lift, turns: q.turns });
    k.body.write();
    // Тело набора рождается скрытым — его показывает хозяин сцены, поставив на место.
    k.body.mesh.visible = true;
    // Кадр погрудно: голова в верхней трети, плечи и ворот — по низу.
    const eyes = k.body.at('lids', [0, 0, 0]);
    const aim: [number, number, number] = [eyes[0], eyes[1] - 0.02, eyes[2]];
    const camera = new THREE.PerspectiveCamera(15, PORTRAIT_W / PORTRAIT_H, 0.05, 20);
    const d = 1.72;
    camera.position.set(aim[0] + Math.sin(yaw * 0.4) * d, aim[1] + 0.03, aim[2] + Math.cos(yaw * 0.4) * d);
    camera.lookAt(aim[0], aim[1], aim[2]);
    r.clear();
    r.render(scene, camera);
    return r.domElement.toDataURL('image/webp', 0.88);
  } finally {
    scene.remove(k.body.mesh);
    k.body.mesh.geometry.dispose();
    k.dispose();
  }
}
