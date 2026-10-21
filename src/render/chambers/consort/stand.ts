// Стенд супруги (ЛЦ-2, docs/characters.md): `?showcase=consort` — фигуры без покоев на ровном сером фоне, снимки кругов
// качества и сравнения обликов (`npm run consort:shots`). Кадр рисуется по просьбе (`__consort.shot`), одним вызовом, без
// цепочки кадров: ничего не крутится, пока стенд не попросили.
import * as THREE from 'three';
import { STILL, type Gesture } from '../folk';
import { CONSORT_IDS, makeConsort, type ConsortId, type ConsortKit } from './index';

export interface ShotAsk {
  looks?: ConsortId[];
  /** Ракурс: спереди, три четверти, сбоку, сзади; `face` — лицо крупно; `sheet` — три фигуры и три головы под ними. */
  view?: 'front' | 'three' | 'side' | 'back' | 'face' | 'sheet';
  /** Ракурс голов в листе (`sheet`). */
  angle?: 'front' | 'three' | 'side';
  light?: 'day' | 'night';
  /** Время живости, с; клип стояния (2, 3) — с начала, `at` — секунда клипа. */
  t?: number;
  clip?: 2 | 3;
  at?: number;
  walk?: number;
  phase?: number;
  talk?: number;
  curtsy?: number;
  lookYaw?: number;
  blink?: boolean;
  /** Лицо крупно: поле зрения, градусы, и сдвиг цели (оси фигуры), м. */
  fov?: number;
  aim?: [number, number, number];
  /** Лицо крупно: поворот фигуры, рад. */
  yaw?: number;
  /** Листы — сплошным цветом (тело красное, лицо зелёное): чья сетка где. */
  debug?: boolean;
}

const YAW = { front: 0, three: -0.62, side: -Math.PI / 2, back: Math.PI } as const;
const BG = 0x3c3c3e;

export function mountConsortStand(root: HTMLElement, p: URLSearchParams): void {
  document.body.style.margin = '0';
  document.body.style.background = '#3c3c3e';
  const canvas = document.createElement('canvas');
  root.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.setPixelRatio(1);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
  const kits = new Map<ConsortId, ConsortKit>();
  const kit = (id: ConsortId): ConsortKit => {
    let k = kits.get(id);
    if (!k) {
      k = makeConsort({ look: id, inside: false });
      scene.add(k.body.mesh);
      kits.set(id, k);
    }
    return k;
  };
  const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 50);

  const pose = (k: ConsortKit, x: number, yaw: number, a: ShotAsk): void => {
    const g: Gesture = { ...STILL, talk: a.talk ?? 0, curtsy: a.curtsy ?? 0, lookYaw: a.lookYaw ?? 0 };
    const t = a.t ?? 1.5;
    if (a.clip) k.motion.play(a.clip, t - (a.at ?? 0));
    if (a.blink) k.motion.blink(t - 0.09);
    // Живость считает своё время сама: два вызова — чтобы клип и моргание встали на свою секунду.
    k.pose(t - 0.016, a.phase ?? 0, a.walk ?? 0, g, g);
    const q = k.pose(t, a.phase ?? 0, a.walk ?? 0, g, g);
    k.body.pose({ x, y: 0, z: 0, yaw, lift: q.lift, turns: q.turns });
    k.body.write();
    k.body.mesh.visible = true;
  };

  const light = (k: ConsortKit, night: boolean): void => {
    k.u.uTint.value.setRGB(night ? 0.52 : 1, night ? 0.4 : 1, night ? 0.3 : 1);
    k.u.uRim.value.setRGB(night ? 0.12 : 0.26, night ? 0.08 : 0.25, night ? 0.05 : 0.22);
    k.u.uRimDir.value.set(-0.7, 0.3, 0.65).normalize();
  };

  const draw = (w: number, h: number, x: number, y: number, cam: THREE.PerspectiveCamera): void => {
    renderer.setViewport(x, y, w, h);
    renderer.setScissor(x, y, w, h);
    renderer.setScissorTest(true);
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
    renderer.render(scene, cam);
  };

  const shot = (a: ShotAsk): { triangles: number; calls: number } => {
    const w = innerWidth;
    const h = innerHeight;
    renderer.setSize(w, h, false);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const looks = a.looks ?? [...CONSORT_IDS];
    for (const k of kits.values()) k.body.mesh.visible = false;
    let triangles = 0;
    let calls = 0;
    renderer.setScissorTest(false);
    renderer.setClearColor(BG);
    renderer.clear();
    const view = a.view ?? 'front';
    if (view === 'face') {
      const k = kit(looks[0]);
      if (a.debug) {
        const solid = (c: number[]): THREE.DataTexture => {
          const t = new THREE.DataTexture(new Uint8Array([...c, 255]), 1, 1);
          t.needsUpdate = true;
          return t;
        };
        k.u.bodyMap.value = solid([200, 40, 40]);
        k.u.faceMap.value = solid([40, 200, 40]);
      }
      light(k, a.light === 'night');
      pose(k, 0, a.yaw ?? 0, a);
      const head = k.body.at('head', [0, 0.02, 0.06]);
      const aim = a.aim ?? [0, -0.02, 0];
      camera.fov = a.fov ?? 14;
      camera.position.set(head[0] + aim[0], head[1] + aim[1] + 0.02, head[2] + 1.25);
      camera.lookAt(head[0] + aim[0], head[1] + aim[1], head[2]);
      draw(w, h, 0, 0, camera);
      triangles = k.body.triangles;
      calls = renderer.info.render.calls;
    } else {
      const angle = view === 'sheet' ? (a.angle ?? 'front') : view;
      const yaw = YAW[angle];
      const cols = looks.length;
      const cw = Math.floor(w / cols);
      const fullH = view === 'sheet' ? Math.floor(h * 0.56) : h;
      looks.forEach((id, i) => {
        const k = kit(id);
        light(k, a.light === 'night');
        for (const o of kits.values()) o.body.mesh.visible = false;
        pose(k, 0, yaw, a);
        // Фигура в рост.
        camera.fov = 24;
        camera.position.set(0, 0.88, 4.6);
        camera.lookAt(0, 0.86, 0);
        draw(cw, fullH, i * cw, h - fullH, camera);
        calls += renderer.info.render.calls;
        if (view === 'sheet') {
          // Голова и плечи под ней.
          const head = k.body.at('head', [0, 0.0, 0]);
          camera.fov = 16;
          camera.position.set(head[0], head[1], 1.4);
          camera.lookAt(head[0], head[1] - 0.04, head[2]);
          draw(cw, h - fullH, i * cw, 0, camera);
        }
        triangles += k.body.triangles;
      });
    }
    renderer.setScissorTest(false);
    return { triangles, calls };
  };

  const w = window as unknown as { __consort: { shot: typeof shot; kits: typeof kits }; __consortReady: boolean };
  w.__consort = { shot, kits };
  const first: ShotAsk = { view: (p.get('view') as ShotAsk['view']) ?? 'sheet', light: p.get('light') === 'night' ? 'night' : 'day' };
  shot(first);
  w.__consortReady = true;
}
