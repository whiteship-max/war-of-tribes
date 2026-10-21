// Стенд людей набора персонажа (ЛЦ-2, ЛЦ-3, docs/characters.md): `?showcase=consort` — супруга и гонец без покоев на ровном
// сером фоне, снимки кругов качества, сравнения обликов и единства стиля (`npm run consort:shots`). Кадр рисуется по просьбе
// (`__consort.shot`), одним вызовом, без цепочки кадров: ничего не крутится, пока стенд не попросили.
import * as THREE from 'three';
import { pixelRatio } from '../loop';
import { STILL, type Gesture } from './folk';
import { CONSORT_IDS, makeConsort, type ConsortId } from './consort';
import { HERALD_IDS, makeHerald, type HeraldId } from './herald';
import { CAT_IDS, makeCat, type CatId, type CatKit } from './pet';
import { Cat, type CatBody } from './cat';
import type { FigureUniforms } from './kit/material';
import type { SkinBody } from './kit/skin';
import type { V3 } from '../city/geom';

export interface ShotAsk {
  /** Кто: супруга (по умолчанию) или гонец; облики — `looks` (супруги) и `heralds` (гонца). */
  who?: 'wife' | 'herald';
  looks?: ConsortId[];
  heralds?: HeraldId[];
  /**
   * Ракурс: спереди, три четверти, сбоку, сзади; `face` — лицо крупно; `sheet` — фигуры и головы под ними; `duo` — лицо
   * супруги и лицо гонца рядом (1024 × 512), в одном свете; `pair` — супруга и гонец рядом в рост и головы под ними;
   * `poses` — гонец в рост по клипам: стоит, идёт, кланяется, вручает письмо, говорит.
   */
  view?: 'front' | 'three' | 'side' | 'back' | 'face' | 'sheet' | 'duo' | 'pair' | 'poses' | 'catface' | 'catduo' | 'cats' | 'catposes';
  /** Кот (ЛЦ-4): окрасы; `catface` — морда крупно, `catduo` — лица супруги, гонца и морда кота рядом (1536 × 512), `cats` —
   * окрасы рядом в рост и мордой, `catposes` — кот по клипам. Поза тела, клип и его секунда, взгляд глаз (рад). */
  cats?: CatId[];
  catBody?: CatBody;
  catClip?: 'stretch' | 'groom' | 'sleep';
  catEyes?: number;
  gaze?: [number, number];
  /** Ракурс голов в листе (`sheet`, `pair`). */
  angle?: 'front' | 'three' | 'side' | 'back';
  light?: 'day' | 'night';
  /** Время живости, с; клип стояния супруги (2, 3) — с начала, `at` — секунда клипа. */
  t?: number;
  clip?: 2 | 3;
  at?: number;
  walk?: number;
  phase?: number;
  talk?: number;
  curtsy?: number;
  bow?: number;
  offer?: number;
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

/** Фигура набора на стенде: тело, ручки света, поза кадра и моргание. */
interface Figure {
  body: SkinBody;
  u: FigureUniforms;
  pose(t: number, phase: number, walk: number, g: Gesture, want: Gesture): { turns: Record<string, [number, number, number]>; lift: V3 };
  blink(t: number): void;
  play?(clip: 2 | 3, t: number): void;
  /** Лицо крупно: точка у лица (оси сцены) и сдвиг цели от неё по умолчанию; голова в листе — точка головы. */
  faceAt(): V3;
  faceAim: [number, number, number];
  headAt(): V3;
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
  // Снимки — точка в точку, плотность 1: просьба через дверь кадра (её потолок, `loop.pixelRatio`).
  renderer.setPixelRatio(pixelRatio(1));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
  const figures = new Map<string, Figure>();
  const wife = (id: ConsortId): Figure => {
    let f = figures.get(`wife-${id}`);
    if (!f) {
      const k = makeConsort({ look: id, inside: false });
      // Лицо супруги: как в ЛЦ-2 — от кости головы (снимки кругов ЛЦ-2 сравнимы с этими).
      f = { body: k.body, u: k.u, pose: k.pose, blink: (t) => k.motion.blink(t), play: (c, t) => k.motion.play(c, t), faceAt: () => k.body.at('head', [0, 0.02, 0.06]), faceAim: [0, -0.02, 0], headAt: () => k.body.at('head', [0, 0, 0]) };
      scene.add(k.body.mesh);
      figures.set(`wife-${id}`, f);
    }
    return f;
  };
  const herald = (id: HeraldId): Figure => {
    let f = figures.get(`herald-${id}`);
    if (!f) {
      const k = makeHerald({ look: id, inside: false });
      // Лицо гонца — так же по кадру, как у супруги: цель на 4,3 см ниже глаз (у неё — от кости головы, она там же).
      f = { body: k.body, u: k.u, pose: k.pose, blink: (t) => k.motion.blink(t), faceAt: () => k.body.at('lids', [0, 0, 0.02]), faceAim: [0, -0.043, 0], headAt: () => k.body.at('lids', [0, -0.043, -0.06]) };
      scene.add(k.body.mesh);
      figures.set(`herald-${id}`, f);
    }
    return f;
  };
  const cats = new Map<CatId, { kit: CatKit; brain: Cat }>();
  const cat = (id: CatId): { kit: CatKit; brain: Cat } => {
    let f = cats.get(id);
    if (!f) {
      const kit = makeCat({ look: id, inside: false });
      const brain = new Cat(1);
      brain.dress(kit);
      scene.add(kit.body.mesh);
      f = { kit, brain };
      cats.set(id, f);
    }
    return f;
  };
  const camera = new THREE.PerspectiveCamera(28, 1, 0.02, 50);

  /** Кот в позе: тело мозга, клип с его секунды, взгляд и свет (зрачок — по свету). */
  const posCat = (id: CatId, x: number, yaw: number, a: ShotAsk): CatKit => {
    const { kit, brain } = cat(id);
    const night = a.light === 'night';
    kit.u.uTint.value.setRGB(night ? 0.52 : 1, night ? 0.4 : 1, night ? 0.3 : 1);
    kit.u.uRim.value.setRGB(night ? 0.12 : 0.26, night ? 0.08 : 0.25, night ? 0.05 : 0.22);
    kit.u.uRimDir.value.set(-0.7, 0.3, 0.65).normalize();
    kit.motion.lux = night ? 0.4 : 3;
    brain.poseAt(x, 0, 0, yaw, a.catBody ?? 'sit');
    brain.look.eyes = a.catEyes ?? (a.catBody === 'curl' ? 0 : 1);
    if (a.catBody === 'walk') brain.look.phase = a.phase ?? 0.8;
    if (a.catBody === 'curl') brain.poseAt(x, 0, 0, yaw, 'curl');
    // Клип — с его секунды `at`; взгляд — сдвиг белка по просьбе.
    kit.motion.reset();
    if (a.catClip) kit.motion.start(a.catClip, -(a.at ?? 1));
    const q = brain.pose();
    if (a.gaze) kit.body.gaze(a.gaze[0], a.gaze[1]);
    kit.body.pose(q);
    kit.body.write();
    kit.body.mesh.visible = true;
    return kit;
  };

  /** Морда кота крупно в окне `w × h` с левого края `x`. */
  const catFace = (id: CatId, a: ShotAsk, w: number, h: number, x: number, y = 0): void => {
    const k = posCat(id, 0, a.yaw ?? 0, { ...a, catBody: a.catBody ?? 'sit' });
    const c0 = k.body.at('head', [0, 0.004, 0.04]);
    const c: V3 = a.aim ? [c0[0] + a.aim[0], c0[1] + a.aim[1], c0[2] + a.aim[2]] : c0;
    camera.fov = a.fov ?? 14;
    const d = 0.62;
    const yaw = a.yaw ?? 0;
    camera.position.set(c[0] + Math.sin(yaw) * d, c[1] + 0.012, c[2] + Math.cos(yaw) * d);
    camera.lookAt(c[0], c[1], c[2]);
    draw(w, h, x, y, camera);
  };

  const pose = (k: Figure, x: number, yaw: number, a: ShotAsk): void => {
    const g: Gesture = { ...STILL, talk: a.talk ?? 0, curtsy: a.curtsy ?? 0, bow: a.bow ?? 0, offer: a.offer ?? 0, lookYaw: a.lookYaw ?? 0 };
    const t = a.t ?? 1.5;
    if (a.clip && k.play) k.play(a.clip, t - (a.at ?? 0));
    if (a.blink) k.blink(t - 0.09);
    // Живость считает своё время сама: два вызова — чтобы клип и моргание встали на свою секунду.
    k.pose(t - 0.016, a.phase ?? 0, a.walk ?? 0, g, g);
    const q = k.pose(t, a.phase ?? 0, a.walk ?? 0, g, g);
    k.body.pose({ x, y: 0, z: 0, yaw, lift: q.lift, turns: q.turns });
    k.body.write();
    k.body.mesh.visible = true;
  };

  const light = (k: Figure, night: boolean): void => {
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

  const hideAll = (): void => {
    for (const f of figures.values()) f.body.mesh.visible = false;
    for (const f of cats.values()) f.kit.body.mesh.visible = false;
  };

  /** Лицо крупно в окне `w × h` с левого края `x`. */
  const faceShot = (k: Figure, a: ShotAsk, w: number, h: number, x: number): void => {
    light(k, a.light === 'night');
    pose(k, 0, a.yaw ?? 0, a);
    const c = k.faceAt();
    const aim = a.aim ?? k.faceAim;
    camera.fov = a.fov ?? 14;
    camera.position.set(c[0] + aim[0], c[1] + aim[1] + 0.02, c[2] + 1.25);
    camera.lookAt(c[0] + aim[0], c[1] + aim[1], c[2]);
    draw(w, h, x, 0, camera);
  };

  const shot = (a: ShotAsk): { triangles: number; calls: number } => {
    const w = innerWidth;
    const h = innerHeight;
    renderer.setSize(w, h, false);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const list = a.who === 'herald' ? (a.heralds ?? [...HERALD_IDS]).map(herald) : (a.looks ?? [...CONSORT_IDS]).map(wife);
    hideAll();
    let triangles = 0;
    let calls = 0;
    renderer.setScissorTest(false);
    renderer.setClearColor(BG);
    renderer.clear();
    const view = a.view ?? 'front';
    const catIds = a.cats ?? [...CAT_IDS];
    if (view === 'catface') {
      catFace(catIds[0], a, w, h, 0);
      triangles = cat(catIds[0]).kit.body.triangles;
      calls = renderer.info.render.calls;
    } else if (view === 'catduo') {
      // Лицо супруги, лицо гонца и морда кота — одним светом, каждый в своей трети.
      const third = Math.floor(w / 3);
      const people = [wife(a.looks?.[0] ?? 'b'), herald(a.heralds?.[0] ?? 'b')];
      people.forEach((k, i) => {
        hideAll();
        faceShot(k, { ...a, yaw: 0 }, third, h, i * third);
        calls += renderer.info.render.calls;
        triangles += k.body.triangles;
      });
      hideAll();
      catFace(catIds[0], a, third, h, 2 * third);
      calls += renderer.info.render.calls;
      triangles += cat(catIds[0]).kit.body.triangles;
    } else if (view === 'cats') {
      // Окрасы рядом — рядами: кот в рост в три четверти (слева) и морда (справа).
      const rh = Math.floor(h / catIds.length);
      const bw = Math.floor(w * 0.6);
      catIds.forEach((id, i) => {
        hideAll();
        const k = posCat(id, 0, a.yaw ?? -0.75, { ...a, catBody: a.catBody ?? 'stand' });
        camera.fov = 26;
        camera.position.set(0, 0.36, 1.35);
        camera.lookAt(0, 0.17, -0.03);
        const y = h - (i + 1) * rh;
        draw(bw, rh, 0, y, camera);
        calls += renderer.info.render.calls;
        hideAll();
        catFace(id, { ...a, yaw: a.yaw === undefined ? -0.3 : a.yaw * 0.4, fov: 19 }, w - bw, rh, bw, y);
        calls += renderer.info.render.calls;
        triangles += k.body.triangles;
      });
    } else if (view === 'catposes') {
      // Кот по позам и клипам: стоит, идёт, сидит, умывается, тянется, буханкой, спит клубком.
      const id = catIds[0];
      const list: ShotAsk[] = [
        { catBody: 'stand' },
        { catBody: 'walk' },
        { catBody: 'sit' },
        { catBody: 'sit', catClip: 'groom', at: 0.9 },
        { catBody: 'stand', catClip: 'stretch', at: 1.2 },
        { catBody: 'loaf' },
        { catBody: 'curl', catClip: 'sleep', at: 1.5 },
      ];
      const cols = 4;
      const cw = Math.floor(w / cols);
      const rh = Math.floor(h / 2);
      list.forEach((c, i) => {
        hideAll();
        posCat(id, 0, a.yaw ?? -1.0, { ...a, ...c });
        camera.fov = 24;
        camera.position.set(0, 0.42, 1.45);
        camera.lookAt(0, 0.15, -0.02);
        draw(cw, rh, (i % cols) * cw, h - rh - Math.floor(i / cols) * rh, camera);
        calls += renderer.info.render.calls;
      });
      triangles = cat(id).kit.body.triangles;
    } else if (view === 'face') {
      const k = list[0];
      if (a.debug) {
        const solid = (c: number[]): THREE.DataTexture => {
          const t = new THREE.DataTexture(new Uint8Array([...c, 255]), 1, 1);
          t.needsUpdate = true;
          return t;
        };
        k.u.bodyMap.value = solid([200, 40, 40]);
        k.u.faceMap.value = solid([40, 200, 40]);
      }
      faceShot(k, a, w, h, 0);
      triangles = k.body.triangles;
      calls = renderer.info.render.calls;
    } else if (view === 'duo') {
      // Лицо супруги слева, гонца справа — одним светом, одним кадром (каждый в своей половине).
      const pair = [wife(a.looks?.[0] ?? 'b'), herald(a.heralds?.[0] ?? 'b')];
      pair.forEach((k, i) => {
        hideAll();
        faceShot(k, a, Math.floor(w / 2), h, i * Math.floor(w / 2));
        calls += renderer.info.render.calls;
        triangles += k.body.triangles;
      });
    } else if (view === 'poses') {
      // Клипы гонца рядом, в три четверти: у каждого — своя секунда и свой жест.
      const k = herald(a.heralds?.[0] ?? 'b');
      const clips: ShotAsk[] = [{ t: 2 }, { t: 2, walk: 1, phase: 0.6 }, { t: 2, bow: 1 }, { t: 2, offer: 1 }, { t: 2, talk: 1 }];
      const cw = Math.floor(w / clips.length);
      light(k, a.light === 'night');
      clips.forEach((c, i) => {
        hideAll();
        pose(k, 0, a.yaw ?? -0.62, { ...a, ...c });
        camera.fov = 24;
        camera.position.set(0, 0.95, 4.4);
        camera.lookAt(0, 0.9, 0);
        draw(cw, h, i * cw, 0, camera);
        calls += renderer.info.render.calls;
      });
      triangles = k.body.triangles;
    } else {
      const angle = view === 'sheet' || view === 'pair' ? (a.angle ?? 'front') : view;
      const yaw = YAW[angle];
      const cols = view === 'pair' ? [wife(a.looks?.[0] ?? 'b'), herald(a.heralds?.[0] ?? 'b')] : list;
      const cw = Math.floor(w / cols.length);
      const fullH = view === 'sheet' || view === 'pair' ? Math.floor(h * 0.56) : h;
      cols.forEach((k, i) => {
        light(k, a.light === 'night');
        hideAll();
        pose(k, 0, yaw, a);
        // Фигура в рост.
        camera.fov = 24;
        camera.position.set(0, 0.88, 4.6);
        camera.lookAt(0, 0.86, 0);
        draw(cw, fullH, i * cw, h - fullH, camera);
        calls += renderer.info.render.calls;
        if (view === 'sheet' || view === 'pair') {
          // Голова и плечи под ней.
          const head = k.headAt();
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

  const win = window as unknown as { __consort: { shot: typeof shot; figures: typeof figures }; __consortReady: boolean };
  win.__consort = { shot, figures };
  const first: ShotAsk = { view: (p.get('view') as ShotAsk['view']) ?? 'sheet', light: p.get('light') === 'night' ? 'night' : 'day' };
  shot(first);
  win.__consortReady = true;
}
