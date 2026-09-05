// Стенд-витрина. Открывается по ?showcase=… и заменяет собой игру:
//
//   ?showcase=building&type=hut&tiers=0,1,2
//     одно здание в ряд: столбцы — визуальные ступени. Свет, земля и масштаб —
//     те же, что в игре.
//   ?showcase=units&action=stand
//     ряд фигур: три покроя горожан, восемь видов бойцов и конь отдельно.
//     units=spearman,swordsman показывает только названных; action=stand|walk|
//     guard|strike|hit|fall — что они делают; count=40 вместо ряда ставит строй
//     из сорока бойцов — по нему и меряется бюджет.
//   ?showcase=village&levels=10
//     целый посёлок из синтетического состояния, через настоящую TribeScene:
//     дороги, стена, жители и бойцы — как в партии. levels — уровень всех
//     построек разом (1 — как на старте партии, 10 — потолок); buildings=hut:10,smithy:3
//     правит отдельные. workers=none оставляет всех жителей свободными: у костра
//     толпа, признаков работы у зданий нет. По умолчанию посёлок укомплектован —
//     по местам, а не по населению: иначе кузнецов на кузницу не хватает.
//
// Общие параметры: silhouette=1 (постройки чёрным на белом), season=winter,
// solar=0.25 (0 — рассвет, 0.25 — полдень, 0.5 — закат), clean=1 (без подписи).
// perf=8 — замер частоты кадров: камера крутится восемь секунд, стенд считает
// кадры и шлёт итог на dev-сервер (POST /__perf → snaps/perf.jsonl). Так стенд
// открывают на телефоне в локальной сети, а число остаётся в репозитории у разработчика.
// На выложенной сборке такого адреса нет: тогда итог остаётся на экране, а тап по
// подписи кладёт отчёт целиком в буфер обмена. Стенд собирается и в продакшен —
// отдельным чанком, который в игру не попадает.
// Подпись и бюджет кадра дублируются в document.body.dataset.showcase — их читает
// инструмент проверки, которому сама канва недоступна.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { BuildingTypeId, GameState, Season, TroopId } from '@/game/types';
import { createInitialState } from '@/game/state';
import { BUILDINGS } from '@/game/data/buildings';
import { SEASON_DAYLIGHT, SEASON_DAYS } from '@/game/data/seasons';
import { DAY_LENGTH, MAX_BUILDING_LEVEL } from '@/game/constants';
import { createBuildingGroup, footprintOf, levelScale, type Tier } from './buildings';
import { TROOPS } from '@/game/data/troops';
import { Figure, FigurePool, PARTS, type PartName } from './figures';
import { ACTIONS, poseFigure, type Action } from './poses';
import { FOLK_KINDS, dressMount, dressSoldier, dressVillager } from './units';
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

/**
 * Замер с телефона, открытого не по dev-серверу, отдать некуда: подпись становится
 * кнопкой и кладёт отчёт целиком в буфер обмена. Тап подтверждается рамкой.
 */
function enableCopy(caption: HTMLDivElement): void {
  caption.style.pointerEvents = 'auto';
  caption.style.cursor = 'pointer';
  caption.onclick = (): void => {
    void navigator.clipboard?.writeText(document.body.dataset.perf ?? '').then(() => {
      caption.style.outline = '2px solid #f3e9d8';
    });
  };
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
      void fetch(`/__snap?name=${encodeURIComponent(this.name ?? 'snap')}`, { method: 'POST', body: blob })
        .then(() => {
          document.body.dataset.snapped = this.name ?? '';
        })
        // На выложенной сборке принимать снимок некому — это не ошибка.
        .catch(() => {});
    }, 'image/png');
  }
}

// ---------- Одно здание сеткой ----------

function mountBuilding(root: HTMLElement, p: URLSearchParams, c: Common): void {
  const type = (p.get('type') ?? 'hut') as BuildingTypeId;
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

  // Ряд раскладывается в системе камеры: столбцы — вправо.
  const right = new THREE.Vector3(Math.cos(AZIMUTH), 0, -Math.sin(AZIMUTH));
  const cols = tiers.length;
  const spots: DecalSpot[] = [];
  tiers.forEach((tier, ci) => {
    const g = createBuildingGroup(type, tier);
    const scale = levelScale(TIER_TOP[tier]) * PLAN_SCALE;
    g.scale.setScalar(scale);
    g.position.copy(right).multiplyScalar((ci - (cols - 1) / 2) * spacing);
    // Фасадом (+z модели) в камеру — как здание первого кольца смотрит на площадь.
    g.rotation.y = AZIMUTH;
    scene.add(g);
    const [w, d] = footprintOf(type, tier);
    spots.push({ x: g.position.x, z: g.position.z, radius: (Math.max(w, d) / 2) * scale });
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
    `${type}\nстолбцы: ступени ${tiers.map((t) => ['1–3', '4–7', '8–10'][t]).join(' / ')}` +
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
 * Дружина на стенде: крупному посёлку — полная дружина, стартовому — пара
 * копейщиков. Уровень 8 — порог третьей визуальной ступени.
 */
const ARMY_FOR = (levels: number): Partial<Record<TroopId, number>> =>
  levels >= 8
    ? { spearman: 4, archer: 3, swordsman: 3, shieldman: 2, rider: 2, legionary: 2 }
    : levels >= 4
      ? { spearman: 4, archer: 2 }
      : { spearman: 2 };

/** Доля суток по фазе солнца — обратная к derived.solarPhase. */
function dayFractionFor(solar: number, season: Season): number {
  const light = SEASON_DAYLIGHT[season];
  return solar < 0.5 ? (solar / 0.5) * light : light + ((solar - 0.5) / 0.5) * (1 - light);
}

export function synthState(
  level: number,
  season: Season,
  solar: number,
  extra?: string | null,
  staffed = true,
): GameState {
  const s = createInitialState();
  // Второй игровой год: первая зима мягче, а стенду нужна обычная.
  const seasonIdx = SEASON_ORDER.indexOf(season) + SEASON_ORDER.length;
  s.time = (seasonIdx * SEASON_DAYS + 1) * DAY_LENGTH + dayFractionFor(solar, season) * DAY_LENGTH;

  // Все постройки одного уровня — так стенд показывает посёлок на любой точке партии.
  const levels: Partial<Record<BuildingTypeId, number>> = {};
  for (const def of BUILDINGS) levels[def.id] = Math.min(def.maxLevel ?? MAX_BUILDING_LEVEL, level);
  // Ручная добавка: buildings=hut:10,smithy:3 поверх общего уровня.
  for (const part of (extra ?? '').split(',').filter(Boolean)) {
    const [type, lvl] = part.split(':');
    levels[type as BuildingTypeId] = Number(lvl ?? 1);
  }
  for (const [type, level] of Object.entries(levels) as [BuildingTypeId, number][]) {
    const existing = s.buildings.find((b) => b.type === type);
    if (existing) existing.level = level;
  }

  // «Укомплектованный» посёлок должен быть укомплектован по-настоящему — с дымом
  // у кузницы и грузом у каждого двора, — поэтому в каждое здание ставим по
  // человеку на уровень. Больше и не надо: признак занятости зажигается от
  // одного рабочего, а сама толпа на сцене всё равно не рисуется.
  let hands = 0;
  for (const b of staffed ? s.buildings : []) {
    if (!BUILDINGS.find((d) => d.id === b.type)?.job) continue;
    s.workers[b.id] = b.level;
    hands += b.level;
  }
  // Плюс десяток свободных рук у костра — их-то стенд и показывает.
  s.pop = hands + 10;

  for (const [troop, n] of Object.entries(ARMY_FOR(level)) as [TroopId, number][]) s.army[troop] = n;
  s.tutorialDone = true;
  return s;
}

/**
 * Замер частоты кадров. Прогрев полторы секунды, потом камера крутится seconds
 * секунд, а стенд считает кадры по afterRender — настоящие кадры цикла, не
 * renderOnce. Итог: средняя частота, худшие 5 % кадров, устройство и бюджет.
 */
interface PerfTarget {
  /** Автоповорот камеры: замер идёт на движении, а не на статичном кадре. */
  spin(on: boolean): void;
  stats(): { calls: number; triangles: number };
  afterRender: (() => void) | null;
}

function runPerf(scene: PerfTarget, seconds: number, name: string, done: (line: string, copy?: boolean) => void): void {
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
      // Меньше десяти кадров в секунду — это не медленная сцена, а свёрнутая
      // вкладка: в фоне requestAnimationFrame стоит. Ноль кадров в секунду в
      // отчёте выглядит как замер, поэтому говорим прямо, что замера не было.
      if (frames.length < seconds * 10) {
        document.body.dataset.perf = JSON.stringify({ name, seconds, frames: frames.length, failed: 'вкладка была в фоне' });
        done('замер не состоялся: вкладку нельзя сворачивать, в фоне кадры не идут');
        return;
      }
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
      // Dev-сервер отвечает text/plain «ok». Выложенная сборка отдаёт на этот адрес
      // что угодно другое (404 или сам index.html) — значит, забрать замер можно
      // только с экрана, и подпись становится кнопкой «скопировать».
      const noSink = (): void => done(line, true);
      void fetch('/__perf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report) })
        .then((r) => {
          if (!r.ok || !(r.headers.get('content-type') ?? '').startsWith('text/plain')) noSink();
        })
        .catch(noSink);
    }, seconds * 1000);
  }, 1500);
}

function mountVillage(root: HTMLElement, p: URLSearchParams, c: Common): void {
  const level = Math.max(1, Math.min(MAX_BUILDING_LEVEL, Number(p.get('levels') ?? 1)));
  const s = synthState(level, c.season, c.solar, p.get('buildings'), p.get('workers') !== 'none');

  const canvas = makeCanvas(root);
  const scene = new TribeScene(canvas, c.dpr);
  scene.sync(s);
  if (c.silhouette) scene.setSilhouette(true);
  window.addEventListener('resize', () => scene.resize());

  const caption = makeCaption(root, c.clean);
  const head =
    `посёлок · уровень ${level}\n${c.season} · solar ${c.solar}` +
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
    runPerf(scene, perf, `village_l${level}`, (line, copy) => {
      perfLine = copy ? `${line}\nтап по подписи — скопировать отчёт` : line;
      if (copy) enableCopy(caption);
      tick();
    });
  }
  tick();
  setInterval(tick, 500);
  const bench = Number(p.get('bench') ?? 0);
  if (bench > 0) {
    benchmark(`village_l${level}`, () => scene.renderOnce(), bench, () => scene.stats());
  }
  new Snapper(c.snap).schedule(
    canvas,
    () => {
      scene.renderOnce();
      tick();
    },
    () => text,
  );
}

// ---------- Фигуры ----------

/** Что стенд умеет показать: покрои горожан, виды бойцов и конь без всадника. */
interface UnitSpec {
  id: string;
  label: string;
  dress: (f: Figure) => void;
}

function unitCatalog(): UnitSpec[] {
  const folk: UnitSpec[] = [];
  for (let k = 0; k < FOLK_KINDS; k++) {
    folk.push({ id: `folk${k}`, label: `горожанин ${k + 1}`, dress: (f: Figure) => dressVillager(f, k) });
  }
  const troops: UnitSpec[] = TROOPS.map((t) => ({
    id: t.id,
    label: t.one,
    dress: (f: Figure) => dressSoldier(f, t.id),
  }));
  return [...folk, ...troops, { id: 'horse', label: 'конь', dress: dressMount }];
}

/**
 * Ряд фигур или строй из `count` бойцов. Силуэтная проверка — главный критерий
 * формы: на боевом масштабе восемь видов обязаны различаться чёрными пятнами
 * без подписей, поэтому silhouette=1 работает и здесь.
 */
function mountUnits(root: HTMLElement, p: URLSearchParams, c: Common): void {
  const asked = p.get('action') as Action | null;
  const action: Action = asked && ACTIONS.includes(asked) ? asked : 'stand';
  const count = Math.max(0, Number(p.get('count') ?? 0));
  const catalog = unitCatalog();
  const want = p.get('units');
  const picked = want && want !== 'all'
    ? want.split(',').map((id) => catalog.find((u) => u.id === id)).filter((u): u is UnitSpec => !!u)
    : catalog;
  const spacing = Number(p.get('spacing') ?? 0.9);
  // turn=90 разворачивает фигуры боком: силуэт обязан читаться со всех сторон.
  const turn = (Number(p.get('turn') ?? 0) * Math.PI) / 180;

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

  const pool = new FigurePool();
  scene.add(pool.group);
  // Ряд раскладывается в системе камеры: столбцы — вправо, как у зданий.
  const right = new THREE.Vector3(Math.cos(AZIMUTH), 0, -Math.sin(AZIMUTH));
  const figures: Figure[] = [];
  let fitRadius: number;
  let head: string;

  if (count > 0) {
    // Строй: сорок бойцов в кадре — тот самый замер бюджета. Виды идут по кругу,
    // чтобы в кадре были и конные, и щиты, и древки.
    const troops = TROOPS.map((t) => t.id);
    const cols = Math.max(1, Math.round(Math.sqrt(count * 1.7)));
    const step = 0.8;
    for (let i = 0; i < count; i++) {
      const f = new Figure();
      dressSoldier(f, troops[i % troops.length]);
      const col = i % cols;
      const row = Math.floor(i / cols);
      f.position.set((col - (cols - 1) / 2) * step, 0, (row - Math.floor(count / cols) / 2) * step);
      f.rotationY = AZIMUTH + turn;
      pool.add(f);
      figures.push(f);
    }
    fitRadius = (cols * step) / 2 + 1;
    head = `строй · ${count} бойцов · ${action}`;
  } else {
    picked.forEach((spec, i) => {
      const f = new Figure();
      spec.dress(f);
      f.position.copy(right).multiplyScalar((i - (picked.length - 1) / 2) * spacing);
      f.rotationY = AZIMUTH + turn;
      pool.add(f);
      figures.push(f);
    });
    fitRadius = ((picked.length - 1) * spacing) / 2 + spacing * 0.75;
    head = `${picked.map((u) => u.label).join(' · ')}\n${action} · ${c.season}${c.silhouette ? ' · силуэт' : ''}`;
  }
  fitShadow(rig, fitRadius + 2);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 120);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.enablePan = false;
  const target = new THREE.Vector3(0, 0.55, 0);
  controls.target.copy(target);

  const resize = (): void => {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    const aspect = w / h;
    camera.aspect = aspect;
    const narrow = THREE.MathUtils.clamp((0.75 - aspect) / 0.15, 0, 1);
    // Фигуры смотрят снизу-сбоку, почти с земли: так силуэт и виден в бою.
    const polar = Number(p.get('polar') ?? THREE.MathUtils.lerp(1.24, 1.05, narrow));
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
  }

  const caption = makeCaption(root, c.clean);
  let text = head;
  let perfLine = '';
  let afterRender: (() => void) | null = null;
  const clock = new THREE.Clock();
  let t = 0;
  const render = (): void => {
    t += Math.min(0.05, clock.getDelta());
    // Падение — единственная поза со своим ходом: стенд роняет и поднимает, чтобы
    // движение было видно, а в игре долю двигает тот, кто роняет.
    const down = Math.min(1, ((t % 3.2) / 1.6));
    for (const f of figures) {
      if (action === 'fall') f.down = down;
      poseFigure(f, action, t);
    }
    pool.update();
    if (!c.silhouette) applyDayNight(rig, scene, c.solar, seasonVis);
    controls.update();
    renderer.info.reset();
    renderer.render(scene, camera);
    afterRender?.();
    const info = renderer.info;
    const demand = pool.demand();
    const stats = { calls: info.render.calls, triangles: info.render.triangles };
    const parts = PARTS.map((k: PartName) => `${k} ${demand[k]}`).join(' · ');
    text = `${head}\ncalls ${stats.calls} · tris ${stats.triangles}\nдеталей: ${parts}` +
      (perfLine ? `\n${perfLine}` : '');
    publish(caption, text, { mode: 'units', ...stats, instances: demand });
  };
  const loop = (): void => {
    requestAnimationFrame(loop);
    render();
  };
  loop();

  const perf = Number(p.get('perf') ?? 0);
  const name = count > 0 ? `units_x${count}` : 'units_row';
  if (perf > 0) {
    perfLine = 'замер…';
    runPerf(
      {
        spin: (on: boolean): void => {
          controls.autoRotate = on;
          controls.autoRotateSpeed = 4;
        },
        stats: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }),
        set afterRender(cb: (() => void) | null) {
          afterRender = cb;
        },
      },
      perf,
      name,
      (line, copy) => {
        perfLine = copy ? `${line}\nтап по подписи — скопировать отчёт` : line;
        if (copy) enableCopy(caption);
      },
    );
  }
  const bench = Number(p.get('bench') ?? 0);
  if (bench > 0) benchmark(name, render, bench, () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }));

  new Snapper(c.snap).schedule(canvas, render, () => text);
}

/**
 * Кадры подряд, без ожидания вертикальной синхронизации: сколько миллисекунд
 * стоит кадр. Частоту кадров это не заменяет — она упирается в экран, — но
 * сравнивать «до» и «после» этим можно даже в фоновой вкладке, где
 * requestAnimationFrame стоит и мерить нечем. Итог ложится в body.dataset.bench.
 */
function benchmark(
  name: string,
  render: () => void,
  frames: number,
  stats: () => { calls: number; triangles: number },
): void {
  // Ждём настоящего размера окна: в свёрнутой или ещё не показанной вкладке
  // канва нулевая, и замер выйдет замером пустоты.
  let waited = 0;
  const start = (): void => {
    if (window.innerWidth < 2 && waited < 30000) {
      waited += 300;
      setTimeout(start, 300);
      return;
    }
    for (let i = 0; i < 10; i++) render();
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) render();
    const ms = (performance.now() - t0) / frames;
    document.body.dataset.bench = JSON.stringify({
      name,
      ms: Math.round(ms * 1000) / 1000,
      frames,
      ...stats(),
      dpr: window.devicePixelRatio,
      width: window.innerWidth,
      height: window.innerHeight,
      ua: navigator.userAgent,
    });
  };
  setTimeout(start, 1200);
}

export function mountShowcase(p: URLSearchParams): void {
  const root = document.getElementById('root') ?? document.body;
  document.title = 'TRIBE · стенд';
  const c = common(p);
  const mode = p.get('showcase');
  if (mode === 'village') mountVillage(root, p, c);
  else if (mode === 'units') mountUnits(root, p, c);
  else mountBuilding(root, p, c);
}
