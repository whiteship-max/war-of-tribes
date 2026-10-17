// Стенд шеренги (docs/polish.md, П-5): `?showcase=army` — по бойцу каждого вида тем же обликом толпы, что в роликах
// (`Crowd`: запекание, шейдер, гербы сторон), крупно и рядами — глазами сверить силуэты, доспех, оружие, разброс и
// клипы. Стенд, а не отчёт: ничего не утверждает.
//
//   ?showcase=army&lod=2|1|0                  облик (вблизи, средний, вдали); по умолчанию вблизи
//   &clip=idle|march|run|guard|strike|shoot|fall|cheer|block|flee|charge   клип; &t=секунда клипа (иначе — идёт)
//   &looks=spearman,knight,militia:archer     кто в шеренге (вид или вид:род); по умолчанию — все
//   &side=1                                   чужая сторона (красный); &rows=2 — наши и чужие рядами
//   &yaw=0.4 &dist=9 &pitch=0.22 &copies=3   камера и сколько бойцов вида в ряд (разброс в строю)
//   &face=1.57                                бойцы повёрнуты от камеры на столько (сбоку виден ход коня)
//   &arms=heater-quarterly-azure-or-lion-gules   наш герб (`heraldry/arms`); &quality=low|medium|high
//
// Кадр — через дверь `render/loop`; счёт кадра — в `document.body.dataset.replay` (его читает `npm run tw:shots`).
import * as THREE from 'three';
import type { UnitKind } from '@/battle/types';
import { KIND_OF } from '@/game/battle/kinds';
import { TROOP_IDS } from '@/game/data/troops';
import { armsCode, BANDIT_ARMS, DEFAULT_ARMS } from '@/heraldry/arms';
import { FrameLoop, pixelRatio } from '../loop';
import { configureRenderer, configureSky, createLightRig, fitShadow } from '../lighting';
import { PALETTE } from '../palette';
import { qualityOf } from '../quality';
import { Crowd } from './crowd';
import { TW_BUDGET, TW_SPEC } from './spec';
import { CLIP_INDEX, CLIPS, figureFrame, type ClipId, type Troupe, type TroupeUnit } from './troupe';

/** Все, кто бывает в строю: виды племени своим родом, ополчение стрелками и пешими, стая. */
function allFaces(): { id: string; kind: UnitKind }[] {
  return [
    ...TROOP_IDS.map((id) => ({ id, kind: KIND_OF[id] })),
    { id: 'militia', kind: 'archer' as UnitKind },
    { id: 'militia', kind: 'infantry' as UnitKind },
    { id: 'wolf', kind: 'infantry' as UnitKind },
  ];
}

export function mountArmyLineup(root: HTMLElement, p: URLSearchParams): void {
  const q = qualityOf(p.get('quality')) ?? 'medium';
  const num = (k: string, d: number): number => (p.has(k) ? Number(p.get(k)) : d);
  const pin = Math.max(0, Math.min(2, Math.round(num('lod', 2)))) as 0 | 1 | 2;
  const clip = (CLIPS.includes(p.get('clip') as ClipId) ? p.get('clip') : 'idle') as ClipId;
  const want = p.get('looks')?.split(',').map((s) => s.trim()).filter(Boolean);
  const faces = allFaces().filter((f) => !want || want.some((w) => w === f.id || w === `${f.id}:${f.kind}`));
  const copies = Math.max(1, Math.round(num('copies', 1)));
  const rows = p.get('rows') === '2' ? 2 : 1;
  const theirs = p.get('side') === '1';

  // Отряд на вид и сторону: в ряд `copies` бойцов — у каждого своё зерно разброса (`Crowd`).
  const units: TroupeUnit[] = [];
  const unitOf: number[] = [];
  const faceOf: number[] = [];
  const lx: number[] = [];
  const lz: number[] = [];
  const place: { x: number; z: number }[] = [];
  // Портрет узкий: по два вида в ряд (или все копии вида в ряд), ряды уходят вглубь.
  const cols = copies > 1 ? copies : Math.min(2, faces.length);
  const horses = faces.some((f) => f.kind === 'cavalry' || f.kind === 'heavy');
  const sx = horses ? 2.4 : 1.6;
  const sz = horses ? 3.2 : 2.2;
  const perSide = Math.ceil((faces.length * copies) / cols);
  let n = 0;
  for (let r = 0; r < rows; r++) {
    faces.forEach((f, fi) => {
      const ours = rows === 2 ? r === 0 : !theirs;
      units.push({ id: units.length, ours, kind: f.kind, face: f.id, first: n, figures: copies, ranks: 1, depth: 0, fleeAt: null, banner: null });
      for (let c = 0; c < copies; c++) {
        const k = fi * copies + c;
        place.push({ x: (k % cols) * sx - ((cols - 1) * sx) / 2, z: -(Math.floor(k / cols) + r * perSide) * sz });
        unitOf.push(units.length - 1);
        faceOf.push(fi);
        lx.push(0);
        lz.push(0);
        n++;
      }
    });
  }
  const troupe: Troupe = {
    units,
    unitOf: Int32Array.from(unitOf),
    faceOf: Int16Array.from(faceOf),
    faceIds: faces,
    lx: Float32Array.from(lx),
    lz: Float32Array.from(lz),
    scale: new Float32Array(n).fill(1),
    tone: new Float32Array(n),
    deathAt: new Float32Array(n).fill(Infinity),
  };

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block';
  root.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(pixelRatio(num('dpr', 2)));
  configureRenderer(renderer);
  renderer.info.autoReset = false;
  const scene = new THREE.Scene();
  configureSky(scene);
  (scene.fog as THREE.Fog).near = 60;
  (scene.fog as THREE.Fog).far = 140;
  const rig = createLightRig(scene, 2048);
  fitShadow(rig, 16);
  rig.sun.position.set(-8, 14, 10);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: PALETTE.grass }));
  ground.receiveShadow = true;
  scene.add(ground);
  const ours = p.get('arms') ?? armsCode(DEFAULT_ARMS);
  const crowd = new Crowd(troupe, TW_SPEC[q], { ours, theirs: armsCode(BANDIT_ARMS) });
  scene.add(crowd.group);
  const frame = figureFrame(n);
  const camera = new THREE.PerspectiveCamera(num('fov', 40), 1, 0.3, 400);
  const extentZ = Math.min(...place.map((v) => v.z));
  const target = new THREE.Vector3(0, 0.7, extentZ / 2);
  const yaw = num('yaw', 0.35);
  const pitch = num('pitch', 0.22);
  const dist = num('dist', 2.6 + Math.max(cols * sx * 1.7, -extentZ * 1.15));
  const resize = (): void => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();
  camera.position.set(target.x + Math.sin(yaw) * Math.cos(pitch) * dist, target.y + Math.sin(pitch) * dist, target.z + Math.cos(yaw) * Math.cos(pitch) * dist);
  camera.lookAt(target);
  const t0 = performance.now();
  const fixed = p.has('t') ? num('t', 0) : null;
  const face = num('face', 0);
  FrameLoop.run(() => {
    const t = fixed ?? (performance.now() - t0) / 1000;
    for (let i = 0; i < n; i++) {
      frame.x[i] = place[i].x;
      frame.z[i] = place[i].z;
      frame.y[i] = 0;
      // Лицом к камере (или повёрнуты на `face` от неё — сбоку виден ход коня), у каждого чуть своё: шеренга, а не ряд кукол.
      frame.yaw[i] = yaw + face + (i % 3) * 0.12 - 0.12;
      frame.clip[i] = CLIP_INDEX[clip];
      frame.time[i] = t + i * 0.37;
      frame.shown[i] = 1;
    }
    crowd.update(frame, null, pin);
    renderer.info.reset();
    renderer.render(scene, camera);
    const info = renderer.info.render;
    const b = TW_BUDGET[q];
    document.body.dataset.replay = JSON.stringify({
      t,
      k: 1,
      figures: { lineup: n },
      calls: info.calls,
      triangles: info.triangles,
      crowdTriangles: crowd.triangles(),
      textureMB: (crowd.bones.bytes / 1048576).toFixed(1),
      budget: b,
    });
  });
  (window as unknown as { twStand: unknown }).twStand = { crowd, looks: crowd.looks() };
}
