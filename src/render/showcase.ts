// Стенд-витрина. Открывается по ?showcase=… и заменяет собой игру:
//
//   ?showcase=building&type=hut&eras=stone,iron&tiers=0,1,2
//     одно здание сеткой: столбцы — визуальные ступени, ряды — эпохи (первый ряд
//     ближе к камере). Свет, земля и масштаб — те же, что в игре.
//   ?showcase=village&stage=town&era=state
//     целый посёлок заданной стадии и эпохи из синтетического состояния, через
//     настоящую TribeScene: дороги, стена, жители и бойцы — как в партии.
//
// Общие параметры: silhouette=1 (постройки чёрным на белом), season=winter,
// solar=0.25 (0 — рассвет, 0.25 — полдень, 0.5 — закат), clean=1 (без подписи).
// perf=8 — замер частоты кадров: камера крутится восемь секунд, стенд считает
// кадры и шлёт итог на dev-сервер (POST /__perf → snaps/perf.jsonl). Так стенд
// открывают на телефоне через тоннель, а число остаётся в репозитории у разработчика.
// Подпись и бюджет кадра дублируются в document.body.dataset.showcase — их читает
// инструмент проверки, которому сама канва недоступна.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { BuildingTypeId, EraId, GameState, Season, StageId, TroopId } from '@/game/types';
import { createInitialState } from '@/game/state';
import { BUILDINGS } from '@/game/data/buildings';
import { ERA_TECHS } from '@/game/data/techs';
import { STAGE_BY_ID } from '@/game/data/stages';
import { SEASON_DAYLIGHT, SEASON_DAYS } from '@/game/data/seasons';
import { DAY_LENGTH } from '@/game/constants';
import { ERA_META } from '@/game/derived';
import { addVillager } from '@/game/sim/population';
import { createBuildingGroup, footprintOf, levelScale, type Tier } from './buildings';
import { PLAN_SCALE } from './plan';
import { buildGround } from './terrain';
import { groundDecals, type DecalSpot } from './village';
import { SeasonVisuals } from './season';
import { TribeScene } from './Scene';
import { applyDayNight, configureRenderer, configureSky, createLightRig, fitShadow } from './lighting';

const SEASON_ORDER: Season[] = ['spring', 'summer', 'autumn', 'winter'];

/** Верхний уровень каждой ступени: сетка показывает здание в самом крупном виде ступени. */
const TIER_TOP: [number, number, number] = [3, 7, 10];

/** Стартовый азимут камеры игры — тот же, чтобы силуэты совпадали с тем, что видит игрок. */
const AZIMUTH = Math.atan2(9, 12);

interface Common {
  season: Season;
  solar: number;
  silhouette: boolean;
  clean: boolean;
  /** Плотность пикселей снимка: 2 — как на телефоне. */
  dpr: number;
  snap: string | null;
}

function common(p: URLSearchParams): Common {
  return {
    season: (p.get('season') as Season) ?? 'spring',
    solar: Number(p.get('solar') ?? 0.25),
    silhouette: p.get('silhouette') === '1',
    clean: p.get('clean') === '1',
    dpr: Number(p.get('dpr') ?? 2),
    snap: p.get('snap'),
  };
}

function makeCanvas(root: HTMLElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block;touch-action:none';
  root.appendChild(canvas);
  return canvas;
}

function makeCaption(root: HTMLElement, hidden: boolean): HTMLDivElement {
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;left:8px;top:8px;padding:4px 8px;font:12px/1.3 monospace;color:#f3e9d8;' +
    'background:rgba(26,20,16,.7);border-radius:6px;pointer-events:none;white-space:pre';
  el.hidden = hidden;
  root.appendChild(el);
  return el;
}

function publish(caption: HTMLDivElement, text: string, stats: object): void {
  caption.textContent = text;
  document.body.dataset.showcase = JSON.stringify({ text, ...stats });
}

/**
 * Снимок кадра в файл. `?snap=имя` — стенд выжидает, пока устоятся тени и палитра,
 * сам рендерит несколько кадров (в скрытой вкладке requestAnimationFrame стоит,
 * поэтому на цикл полагаться нельзя), рисует подпись прямо в картинку и отправляет
 * PNG на dev-сервер (`/__snap`, см. vite.config.ts), который кладёт его в snaps/.
 * Снимать надо сразу после render(): после композиции буфер WebGL пуст.
 */
class Snapper {
  constructor(private name: string | null) {}

  /** render — принудительный кадр; caption — подпись на момент снимка. */
  schedule(canvas: HTMLCanvasElement, render: () => void, caption: () => string, delayMs = 700): void {
    if (!this.name) return;
    setTimeout(() => {
      for (let i = 0; i < 4; i++) render();
      this.take(canvas, caption());
    }, delayMs);
  }

  private take(canvas: HTMLCanvasElement, caption: string): void {
    const out = document.createElement('canvas');
    out.width = canvas.width;
    out.height = canvas.height;
    const ctx = out.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(canvas, 0, 0);
    const k = canvas.width / (canvas.clientWidth || canvas.width);
    ctx.font = `${Math.round(12 * k)}px monospace`;
    const lines = caption.split('\n');
    const pad = 6 * k;
    const lineH = 15 * k;
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + pad * 2;
    ctx.fillStyle = 'rgba(26,20,16,0.72)';
    ctx.fillRect(8 * k, 8 * k, w, lineH * lines.length + pad * 2);
    ctx.fillStyle = '#f3e9d8';
    lines.forEach((l, i) => ctx.fillText(l, 8 * k + pad, 8 * k + pad + lineH * (i + 0.8)));
    out.toBlob((blob) => {
      if (!blob) return;
      void fetch(`/__snap?name=${encodeURIComponent(this.name ?? 'snap')}`, { method: 'POST', body: blob }).then(
        () => {
          document.body.dataset.snapped = this.name ?? '';
        },
      );
    }, 'image/png');
  }
}

// ---------- Одно здание сеткой ----------

function mountBuilding(root: HTMLElement, p: URLSearchParams, c: Common): void {
  const type = (p.get('type') ?? 'hut') as BuildingTypeId;
  const eras = (p.get('eras') ?? 'stone,iron').split(',') as EraId[];
  const tiers = (p.get('tiers') ?? '0,1,2').split(',').map(Number) as Tier[];
  const spacing = Number(p.get('spacing') ?? 4.4);
  /** Запас кадра вокруг сетки; меньше — крупнее здания. */
  const margin = Number(p.get('margin') ?? 0.55);

  const canvas = makeCanvas(root);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(c.dpr);
  configureRenderer(renderer);
  // Считаем вызовы честно, вместе с теневым проходом (см. Scene).
  renderer.info.autoReset = false;
  const scene = new THREE.Scene();
  configureSky(scene);
  const rig = createLightRig(scene, Number(p.get('shadow') ?? 1024));
  const ground = buildGround();
  scene.add(ground);
  const seasonVis = new SeasonVisuals();
  seasonVis.update(c.season, 10);

  // Сетка раскладывается в системе камеры: столбцы — вправо, ряды — вглубь.
  const right = new THREE.Vector3(Math.cos(AZIMUTH), 0, -Math.sin(AZIMUTH));
  const back = new THREE.Vector3(-Math.sin(AZIMUTH), 0, -Math.cos(AZIMUTH));
  const cols = tiers.length;
  const rows = eras.length;
  const spots: DecalSpot[] = [];
  eras.forEach((era, ri) => {
    tiers.forEach((tier, ci) => {
      const g = createBuildingGroup(type, 2, tier, era);
      const scale = levelScale(TIER_TOP[tier]) * PLAN_SCALE;
      g.scale.setScalar(scale);
      g.position
        .copy(right)
        .multiplyScalar((ci - (cols - 1) / 2) * spacing)
        .addScaledVector(back, (ri - (rows - 1) / 2) * spacing);
      // Фасадом (+z модели) в камеру — как здание первого кольца смотрит на площадь.
      g.rotation.y = AZIMUTH;
      scene.add(g);
      const [w, d] = footprintOf(type, tier);
      spots.push({ x: g.position.x, z: g.position.z, radius: (Math.max(w, d) / 2) * scale });
    });
  });
  // Под каждым зданием — те же декали, что кладёт посёлок: вытоптанная земля и пятно тени.
  const decals = groundDecals(spots);
  scene.add(decals);

  // Сетка вписывается по ширине: в портрете именно она ограничивает кадр.
  const fitRadius = ((cols - 1) * spacing) / 2 + 2.2 + margin;
  fitShadow(rig, fitRadius + 3);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 120);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.enablePan = false;
  const target = new THREE.Vector3(0, 0.8, 0);
  controls.target.copy(target);

  const resize = (): void => {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    const aspect = w / h;
    camera.aspect = aspect;
    // То же кадрирование, что в Scene.applyFraming: в портрете выше и шире.
    const narrow = THREE.MathUtils.clamp((0.75 - aspect) / 0.15, 0, 1);
    // polar=… и zoom=… позволяют посмотреть ниже и ближе, чем стартовый кадр игры.
    const polar = Number(p.get('polar') ?? THREE.MathUtils.lerp(0.95, 0.62, narrow));
    const fov = THREE.MathUtils.lerp(42, 48, narrow);
    camera.fov = fov;
    const halfH = Math.atan(Math.tan((fov * Math.PI) / 360) * aspect);
    const dist = (fitRadius / Math.tan(halfH)) / Number(p.get('zoom') ?? 1);
    camera.position.setFromSpherical(new THREE.Spherical(dist, polar, AZIMUTH)).add(target);
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    const fog = scene.fog as THREE.Fog | null;
    if (fog) {
      fog.near = dist * 1.6;
      fog.far = dist * 2.6;
    }
  };
  resize();
  window.addEventListener('resize', resize);

  if (c.silhouette) {
    scene.overrideMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
    (scene.background as THREE.Color).setHex(0xffffff);
    scene.fog = null;
    ground.visible = false;
    decals.visible = false;
  }

  const caption = makeCaption(root, c.clean);
  const head =
    `${type} · ряды: ${eras.join(', ')}\nстолбцы: ступени ${tiers.map((t) => ['1–3', '4–7', '8–10'][t]).join(' / ')}` +
    ` · ${c.season} · solar ${c.solar}${c.silhouette ? ' · силуэт' : ''}`;
  let text = head;
  const render = (): void => {
    if (!c.silhouette) applyDayNight(rig, scene, c.solar, seasonVis);
    controls.update();
    renderer.info.reset();
    renderer.render(scene, camera);
    const info = renderer.info;
    const stats = { calls: info.render.calls, triangles: info.render.triangles };
    text = `${head}\ncalls ${stats.calls} · tris ${stats.triangles}`;
    publish(caption, text, { mode: 'building', ...stats });
  };
  const loop = (): void => {
    requestAnimationFrame(loop);
    render();
  };
  loop();
  new Snapper(c.snap).schedule(canvas, render, () => text);
}

// ---------- Целый посёлок ----------

/**
 * Что стоит в посёлке каждой стадии. Уровни подобраны так, чтобы состояние
 * действительно проходило порог стадии (settlementStage), а не только называлось ею.
 */
const PRESETS: Record<StageId, Partial<Record<BuildingTypeId, number>>> = {
  camp: {},
  tribal: { hut: 2, sawmill: 2, gathering: 1, chief_house: 1, hunter_hut: 1 },
  village: { hut: 3, sawmill: 3, gathering: 2, chief_house: 2, hunter_hut: 2, farm: 3, workshop: 2, knowledge: 2, quarry: 2 },
  fortified: {
    hut: 5, sawmill: 4, gathering: 3, chief_house: 4, hunter_hut: 3, farm: 4, workshop: 3, knowledge: 3,
    quarry: 3, pen: 3, smithy: 3, mine: 2, palisade: 1, totem: 2, storage: 3,
  },
  town: {
    hut: 10, sawmill: 9, gathering: 8, chief_house: 10, hunter_hut: 8, farm: 9, workshop: 9, knowledge: 9,
    quarry: 8, pen: 8, smithy: 9, mine: 9, palisade: 8, totem: 8, barracks: 8, tower: 8, market: 8, storage: 8,
  },
};

const ARMY: Record<StageId, Partial<Record<TroopId, number>>> = {
  camp: {},
  tribal: {},
  village: { clubman: 2 },
  fortified: { spearman: 4, archer: 2 },
  town: { spearman: 4, archer: 3, swordsman: 3, shieldman: 2, legionary: 2 },
};

/** Доля суток по фазе солнца — обратная к derived.solarPhase. */
function dayFractionFor(solar: number, season: Season): number {
  const light = SEASON_DAYLIGHT[season];
  return solar < 0.5 ? (solar / 0.5) * light : light + ((solar - 0.5) / 0.5) * (1 - light);
}

export function synthState(stage: StageId, eraId: EraId, season: Season, solar: number, extra?: string | null): GameState {
  const s = createInitialState();
  // Второй игровой год: первая зима мягче, а стенду нужна обычная.
  const seasonIdx = SEASON_ORDER.indexOf(season) + SEASON_ORDER.length;
  s.time = (seasonIdx * SEASON_DAYS + 1) * DAY_LENGTH + dayFractionFor(solar, season) * DAY_LENGTH;

  for (const [id, techs] of ERA_TECHS) {
    s.techs.push(...techs);
    if (id === eraId) break;
  }

  const levels: Partial<Record<BuildingTypeId, number>> = { ...PRESETS[stage] };
  // Ручная добавка: buildings=hut:10,smithy:3 поверх пресета стадии.
  for (const part of (extra ?? '').split(',').filter(Boolean)) {
    const [type, lvl] = part.split(':');
    levels[type as BuildingTypeId] = Number(lvl ?? 1);
  }
  for (const [type, level] of Object.entries(levels) as [BuildingTypeId, number][]) {
    const existing = s.buildings.find((b) => b.type === type);
    if (existing) existing.level = level;
    else s.buildings.push({ id: s.nextId++, type, slot: -1, level, work: 0, workRequired: 0 });
  }

  const pop = Math.max(5, STAGE_BY_ID[stage].pop);
  while (s.villagers.length < pop) addVillager(s, { job: 'idle' });
  // Рассадить по рабочим местам: столько, сколько уровней у здания.
  let i = 0;
  for (const b of s.buildings) {
    const def = BUILDINGS.find((d) => d.id === b.type);
    if (!def?.job) continue;
    for (let k = 0; k < b.level && i < s.villagers.length; k++, i++) {
      s.villagers[i].job = def.job;
      s.villagers[i].workplace = b.id;
    }
  }

  for (const [troop, n] of Object.entries(ARMY[stage]) as [TroopId, number][]) s.army[troop] = n;
  s.tutorialDone = true;
  return s;
}

/**
 * Замер частоты кадров. Прогрев полторы секунды, потом камера крутится seconds
 * секунд, а стенд считает кадры по afterRender — настоящие кадры цикла, не
 * renderOnce. Итог: средняя частота, худшие 5 % кадров, устройство и бюджет.
 */
function runPerf(scene: TribeScene, seconds: number, name: string, done: (line: string) => void): void {
  const frames: number[] = [];
  let last = 0;
  setTimeout(() => {
    scene.spin(true);
    last = performance.now();
    scene.afterRender = (): void => {
      const now = performance.now();
      frames.push(now - last);
      last = now;
    };
    setTimeout(() => {
      scene.afterRender = null;
      scene.spin(false);
      const sorted = [...frames].sort((a, b) => a - b);
      const total = frames.reduce((a, b) => a + b, 0) / 1000;
      const fps = frames.length / Math.max(0.001, total);
      // Худшие 5 % кадров: то, что видно как рывки.
      const worst = sorted.slice(Math.floor(sorted.length * 0.95));
      const low = worst.length ? 1000 / (worst.reduce((a, b) => a + b, 0) / worst.length) : fps;
      const st = scene.stats();
      const report = {
        name,
        fps: Math.round(fps * 10) / 10,
        low5: Math.round(low * 10) / 10,
        frames: frames.length,
        seconds,
        calls: st.calls,
        triangles: st.triangles,
        dpr: window.devicePixelRatio,
        width: window.innerWidth,
        height: window.innerHeight,
        ua: navigator.userAgent,
        at: new Date().toISOString(),
      };
      const line = `fps ${report.fps} · худшие 5 %: ${report.low5} · ${report.width}×${report.height} @${report.dpr}`;
      document.body.dataset.perf = JSON.stringify(report);
      done(line);
      void fetch('/__perf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report) });
    }, seconds * 1000);
  }, 1500);
}

function mountVillage(root: HTMLElement, p: URLSearchParams, c: Common): void {
  const stage = (p.get('stage') as StageId) ?? 'camp';
  const eraId = (p.get('era') as EraId) ?? 'camp';
  const s = synthState(stage, eraId, c.season, c.solar, p.get('buildings'));

  const canvas = makeCanvas(root);
  const scene = new TribeScene(canvas, c.dpr);
  scene.sync(s);
  if (c.silhouette) scene.setSilhouette(true);
  window.addEventListener('resize', () => scene.resize());

  const caption = makeCaption(root, c.clean);
  const head =
    `${STAGE_BY_ID[stage].name} · ${ERA_META[eraId].name}\n${c.season} · solar ${c.solar}` +
    `${c.silhouette ? ' · силуэт' : ''}`;
  let text = head;
  let perfLine = '';
  const tick = (): void => {
    const st = scene.stats();
    text = `${head}\ncalls ${st.calls} · tris ${st.triangles}${perfLine ? `\n${perfLine}` : ''}`;
    publish(caption, text, { mode: 'village', ...st });
  };
  const perf = Number(p.get('perf') ?? 0);
  if (perf > 0) {
    perfLine = 'замер…';
    runPerf(scene, perf, `${stage}_${eraId}`, (line) => {
      perfLine = line;
      tick();
    });
  }
  tick();
  setInterval(tick, 500);
  new Snapper(c.snap).schedule(
    canvas,
    () => {
      scene.renderOnce();
      tick();
    },
    () => text,
  );
}

export function mountShowcase(p: URLSearchParams): void {
  const root = document.getElementById('root') ?? document.body;
  document.title = 'TRIBE · стенд';
  const c = common(p);
  if (p.get('showcase') === 'village') mountVillage(root, p, c);
  else mountBuilding(root, p, c);
}
