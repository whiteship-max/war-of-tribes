// Стенд вида «город»: `?showcase=city&quality=high|medium|low&view=game|street|gate|square|top|house
// &solar=0.25&season=summer`. Свой рендерер, свет — общий риг (`lighting.ts`, числа ночи `next`),
// кадр — только через дверь `render/loop.ts`. Крючки для снимков: `window.__stand` (счётчики) и
// `document.body.dataset.ready = '1'`, когда город собран.
import * as THREE from 'three';
import { FrameLoop, pixelRatio } from '../loop';
import { applyDayNight, configureRenderer, configureSky, createLightRig, fitShadow, RIG, windowNight } from '../lighting';
import { SeasonVisuals } from '../season';
import { qualityOf, type Quality } from '../quality';
import type { Season } from '@/game/types';
import { buildCity, CITY_SPEC, type CityBuild } from './index';
import { heightAt } from './layout';

const DEG = Math.PI / 180;

/** Камера города: цель, расстояние, высота над горизонтом и азимут (от юга к востоку), поле зрения. */
export interface CityView {
  at: [number, number, number];
  dist: number;
  elev: number;
  azim: number;
  fov: number;
}

/** Ракурс игры — главный (docs/city.md, раздел 6): ворота внизу экрана, замок вверху. */
export const CITY_VIEWS: Record<string, CityView> = {
  game: { at: [2, 6, -6], dist: 300, elev: 48, azim: 14, fov: 38 },
  street: { at: [4, 4, 70], dist: 55, elev: 32, azim: 18, fov: 40 },
  gate: { at: [0, 6, 120], dist: 75, elev: 30, azim: 12, fov: 40 },
  square: { at: [0, 8, 0], dist: 95, elev: 40, azim: 16, fov: 40 },
  house: { at: [5, 6, 62], dist: 26, elev: 22, azim: 30, fov: 40 },
  top: { at: [0, 0, -20], dist: 520, elev: 89, azim: 0, fov: 40 },
};

/** Азимут солнца: спереди-слева от камеры игры, как у посёлка (`lighting.KEY_AZIMUTH`). */
const cityKey = (azim: number): number => (azim - 55) * DEG;

export function mountCity(root: HTMLElement, p: URLSearchParams): void {
  const q: Quality = qualityOf(p.get('quality')) ?? 'medium';
  const spec = CITY_SPEC[q];
  const season = (p.get('season') as Season) ?? 'summer';
  const solar = Number(p.get('solar') ?? 0.2);
  const dpr = Number(p.get('dpr') ?? 2);
  const base = CITY_VIEWS[p.get('view') ?? 'game'] ?? CITY_VIEWS.game;
  const num = (k: string, d: number): number => (p.has(k) ? Number(p.get(k)) : d);
  const atS = p.get('at')?.split(',').map(Number);
  const view: CityView = {
    at: atS && atS.length === 3 ? (atS as [number, number, number]) : base.at,
    dist: num('dist', base.dist),
    elev: num('elev', base.elev),
    azim: num('azim', base.azim),
    fov: num('fov', base.fov),
  };

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block;touch-action:none';
  root.appendChild(canvas);
  const caption = document.createElement('div');
  caption.style.cssText =
    'position:fixed;left:8px;top:8px;padding:4px 8px;font:12px/1.3 monospace;color:#f3e9d8;' +
    'background:rgba(26,20,16,.7);border-radius:6px;pointer-events:none;white-space:pre';
  caption.hidden = p.get('clean') === '1';
  root.appendChild(caption);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(pixelRatio(dpr));
  configureRenderer(renderer);
  if (q === 'low') renderer.shadowMap.type = 0 as THREE.ShadowMapType;
  renderer.info.autoReset = false;
  const scene = new THREE.Scene();
  configureSky(scene);
  const rig = createLightRig(scene, spec.shadowMap);
  rig.sun.shadow.radius = q === 'high' ? 3 : 2;
  rig.sun.shadow.normalBias = 0.06;
  rig.sun.shadow.bias = -0.0006;
  const sc = rig.sun.shadow.camera;
  sc.near = 10;
  sc.far = 1200;
  fitShadow(rig, 175);
  const seasonVis = new SeasonVisuals();
  seasonVis.update(season, 10);
  const camera = new THREE.PerspectiveCamera(view.fov, 1, 1, 4000);
  const target = new THREE.Vector3(...view.at);
  const place = (): void => {
    const e = view.elev * DEG;
    const a = view.azim * DEG;
    camera.position.set(target.x + Math.sin(a) * Math.cos(e) * view.dist, target.y + Math.sin(e) * view.dist, target.z + Math.cos(a) * Math.cos(e) * view.dist);
    camera.lookAt(target);
    const fog = scene.fog as THREE.Fog;
    fog.near = view.dist * 0.75;
    fog.far = view.dist * 2.4 + 260;
  };
  const resize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();
  place();

  let city: CityBuild | null = null;
  const sunAt = new THREE.Vector3();
  const stand = {
    renderer,
    scene,
    camera,
    city: null as CityBuild | null,
    beforeRender: null as null | (() => void),
    afterRender: null as null | (() => void),
    frame(): void {
      const light = applyDayNight(rig, scene, solar, seasonVis, cityKey(view.azim), RIG.next);
      // Риг посёлка ставит лампу в 40 единицах: городу нужна коробка теней на весь мыс.
      sunAt.copy(rig.sun.position).normalize().multiplyScalar(500);
      const center = new THREE.Vector3(0, 8, -15);
      rig.sun.position.copy(center).add(sunAt);
      rig.sun.target.position.copy(center);
      rig.sun.target.updateMatrixWorld();
      // Узкие улицы города глубже открытого посёлка: заполняющему свету — треть сверху.
      rig.hemi.intensity *= 1.35;
      if (city) {
        city.uniforms.cNight.value = windowNight(light);
        city.uniforms.cSnow.value = seasonVis.snow;
        city.uniforms.cAutumn.value = season === 'autumn' ? 1 : 0;
      }
      renderer.info.reset();
      stand.beforeRender?.();
      renderer.render(scene, camera);
      stand.afterRender?.();
      const info = renderer.info.render;
      caption.textContent = `город · ${q} · ${info.calls} вызовов · ${info.triangles} треуг.`;
    },
    stats(): { calls: number; triangles: number; geometries: number; textures: number; programs: number } {
      return {
        calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
        programs: renderer.info.programs?.length ?? 0,
      };
    },
    memory(): { bytes: number } {
      let bytes = 0;
      scene.traverse((o) => {
        const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
        if (!g) return;
        for (const a of Object.values(g.attributes)) bytes += (a as THREE.BufferAttribute).array.byteLength;
        if (g.index) bytes += g.index.array.byteLength;
      });
      return { bytes };
    },
    textureBytes(): number {
      const s = rig.sun.shadow.mapSize.x;
      return (city?.textureBytes ?? 0) + s * s * 8;
    },
    counts(): Record<string, number> {
      return city?.counts ?? {};
    },
    view,
    place,
  };
  (window as unknown as { __stand: unknown }).__stand = stand;
  FrameLoop.run(() => stand.frame());
  void buildCity(q).then((c) => {
    city = c;
    stand.city = c;
    scene.add(c.group);
    target.y = view.at[1] || heightAt(view.at[0], view.at[2]);
    place();
    document.body.dataset.ready = '1';
  });
}
