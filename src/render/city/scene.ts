// Сцена игры — город (docs/city.md), единственный вид с 02.10.2026. Наследник общей оболочки сцены
// (`render/Scene.ts`): всё, что у сцены выстрадано, — потеря контекста и её лечение, возвращение из фона,
// сторож кадров и плавности, дверь кадра, общий судья пальца, панорама и щипок, одалживание холста ролику
// о бое, — там, одним кодом. Своё у города — мир (план, модели, земля, лес, вода), камера в метрах, свет на
// весь мыс, касание по коробкам мест и подсветка выбранного.
//
// Ленивый кусок: едет до игры (`main.tsx`) и кладёт свой класс в `SCENES`.
import * as THREE from 'three';
import type { BuildingTypeId, GameState, ResourceId } from '@/game/types';
import { armySize, buildingAttention, buildingProduction, buildingTitle, population, productionPerDay, storageCap, type Attention } from '@/game/derived';
import { RESOURCE_IDS } from '@/game/constants';
import type { SmokeSource } from '../weather';
import { hearCity } from '@/sound/ear';
import { WORK_SIGN, workBusy } from '../worksigns';
import type { V3 } from './geom';
import { CityLife, type Anchor } from './life';
import { feastClock, forcedMood, lookOf, moodOf, rhythmAt, CALM_MOOD, type CityMood } from './rhythm';
import { marchesOnHome, useWorld } from '@/world/store';
import type { CityBustle } from './alive';
import type { CityGarrison } from './garrison';
import type { CityDeeds } from './deeds';
import type { SiteTags } from './tags';
import type { CityLabels, LabelSpot } from './labels';
import { labelsOn, takeCamAsk } from '../sitetags';
import { newsOf, seenOf, waveAfter, WAVE_REAL, type CityPops, type Seen, type Yard, type YieldTally } from './pops';
import { TAP_TARGET } from '@/gestures';
import { markerSvg, SCENES, TribeScene, type BuildingView, type SceneLook } from '../Scene';
import { RIG, applyDayNight, fitShadow, windowNight } from '../lighting';
import { disposeGeometries } from '../kit';
import type { HitBox } from '../pick';
import { buildCity, CITY_SPEC, type CityBuild, type CityShare } from './index';
import { lowerWater } from './water';
import { LAMP_SPEC } from '../glow/lamps';
import { lightScene } from '../glow/rig';
import {
  CITY_KEY,
  CITY_AZIMUTH,
  CITY_STEP_MAX,
  FLY_S,
  SHOW_GLOW_S,
  cityFog,
  cityFraming,
  cityLeash,
  cityShadowHalf,
  citySunAt,
  flyAt,
  INSIDE_SHADOW_AHEAD,
  labelsAlpha,
  shadowSnap,
  showDist,
  type CamPose,
} from './camera';
import { cityPick, screenBox, type Pickable } from './pick';
import { mainSite, ownerCode, type Site } from './sites';
import { heightAt } from './layout';
import type { CityPrecip } from './precip';
import { CLEAR, ZONES, easeWeather, flashAt, lyingSnow, forcedFlashes, forcedWeather, flashGlow, weatherAt, windTo, zoneOf, type Weather } from '../climate';
import { lowerQuality, type Quality } from '../quality';
import { serverNow } from '@/net/clock';
import type { Inside, InsideSky } from './inside';
import type { Tower } from './layout';

/** Облака над городом бегут со скоростью верхнего ветра, м/с: пятно тени в двести метров проходит за полминуты. */
const CLOUD_SPEED = 7;
/** Сырость держится после дождя: мостовая сохнет минутами (отсчёты назад, секунды, и сколько остаётся сырости). */
const DRY: readonly (readonly [number, number])[] = [
  [60, 0.85],
  [180, 0.6],
  [360, 0.35],
];
/**
 * Постоянная перелива погоды в кадре, с (docs/polish.md, П-3): погода региона и так переходит за минуты (`climate.BLEND`),
 * а скачок — смена погоды адресом, региона или вход в игру — не щёлкает, а наплывает за несколько секунд.
 */
const WX_EASE = 2.5;
/** Пелена дождя вдали идёт по ветру: скорость её полос, м/с, — от силы ветра. */
const VEIL_SPEED = 3;
const FLASH_SKY = new THREE.Color(0.78, 0.82, 0.95);
const MIST_SKY = new THREE.Color(0.86, 0.86, 0.84);
const TMP_C = new THREE.Color();
const TMP_V = new THREE.Vector3();

/** Небо и дымка под облаками: к серому и темнее в дождь. */
function greyen(c: THREE.Color, k: number, dark: number): void {
  const l = c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
  c.lerp(TMP_C.setRGB(l * 0.95, l * 0.97, l), k).multiplyScalar(dark);
}

/**
 * Значок над крышей: доля высоты экрана (спрайт без перспективы — читается на любом приближении). Около двадцати
 * точек на экране телефона (прежний вид — тридцать пять — удалён, docs/ui_audit.md, 16). Нажимать его не нужно
 * (касание берёт постройка, `cityPick`), он только говорит, где забота, — и не закрывает крыши.
 */
const MARKER_SCREEN = 0.017;

/**
 * Вид изнутри покоев (docs/city_v3.md, Г-4): город за окном — как с камеры в стольких метрах (дымка, коробка теней, дождь
 * вокруг), взгляд — на столько метров вперёд по земле, тень — раз в столько кадров (из окна видны дома, а не шаг прохожего).
 */
const INSIDE_DIST = 190;
const INSIDE_AIM = 130;
const INSIDE_SHADOW_EVERY = 6;


export class CityScene extends TribeScene {
  /** Собранный город; до его прихода в кадре — дымка. */
  private town: CityBuild | null = null;
  /** Коробки 24 построек — с моделей, приходят вместе с городом. */
  private sites: Site[] = [];
  /** Город встал в сцену на полных слоях — стенду, чтобы снимать. */
  readonly ready: Promise<void>;
  protected stepMax = CITY_STEP_MAX;

  /**
   * Город для ролика осады и боя у города (docs/polish.md, П-6): тот же план, текстуры и карты; пока город не встал —
   * ничего. Спрашивают ролики (`ui/battle/townShare`) — у общей оболочки сцены этого метода нет: первая загрузка не растёт.
   */
  cityShare(): CityShare | null {
    return this.town?.share ?? null;
  }
  /** Люди, стража, дым, флаги, птицы, скот — встают вместе с городом. */
  private folk: CityLife | null = null;
  /**
   * Телеги, утки, лодки, стяги — своим куском (`alive.ts`), который сцена тянет после первого кадра города
   * (docs/city.md, 13): город встаёт, не дожидаясь их.
   */
  private bustle: CityBustle | null = null;
  /** Стража бойцами роликов (`garrison.ts`, docs/polish.md, П-5) — своим куском вместе с суетой. */
  private garrison: CityGarrison | null = null;
  private bustleWanted = false;
  /**
   * Отклик на дела игрока — стройка лесами, праздник готовности, найм строем, добыча над дворами (docs/city.md, 14):
   * своим куском (`deeds.ts`), вместе с суетой после первого кадра города.
   */
  private deeds: CityDeeds | null = null;
  private pops: CityPops | null = null;
  /** Ярлыки у лесов: места кнопки «Ускорить» над стройками (`tags.ts`, docs/gems.md). */
  private tags: SiteTags | null = null;
  /** Подписи построек (`labels.ts`, ОР-1; меток издали нет — ЗН-3) — тем же куском, что отклик. */
  private labels: CityLabels | null = null;
  /**
   * Полёт камеры (ОР-1): «Показать в городе». `at` — начало по часам сцены, с (полёт идёт настоящим временем, а
   * не суммой шагов кадра: у шага кадра потолок, и на редких кадрах полёт растянулся бы); `was` — где полёт поставил камеру
   * прошлым кадром: палец её сдвинул — полёт уступает ему.
   */
  private fly: { from: CamPose; to: CamPose; at: number; was: CamPose } | null = null;
  /** Показанная постройка подсвечивается до этой минуты часов сцены, с. */
  private shown: { type: BuildingTypeId; until: number } | null = null;
  /** Показать просили до того, как город встал: покажется, когда встанет. */
  private showDue: BuildingTypeId | null = null;

  private tally: YieldTally | null = null;
  /** Что отклик видел в прошлом чтении партии (`pops.seenOf`) и когда это было настоящим временем, мс. */
  private seen: { was: Seen; real: number } | null = null;
  /** Добыча отлучки ждёт куска отклика (`welcome` раньше его прихода), игровых секунд. */
  private welcomeDue = 0;
  private lastState: GameState | null = null;
  /** Погода (docs/city.md, 15): регион игрока, погода этого кадра, вспышка и осадки (своей докачкой). */
  private region: string | null = null;
  private wx: Weather = CLEAR;
  /** Когда погода кадра последний раз шла к погоде часов (мс страницы); 0 — следующий кадр встаёт сразу. */
  private wxAt = 0;
  /** Сдвиг полос пелены по ветру, м: копится кадрами — поворот ветра не прыгает всем полем. */
  private veilAt = new THREE.Vector2();
  private wet = 0;
  private flash = 0;
  /** Снег на земле зимой (`climate.lyingSnow`): в поясе севера — всю зиму, на Сицилии — после снегопада. */
  private lying = 1;
  private precip: CityPrecip | null = null;
  /** Погода адресом (`?weather=rain`) — стенду и проверке на телефоне; адрес перечитывается, только когда сменился. */
  private forcedAt = '';
  private forcedWx: Weather | null = null;
  private get forced(): Weather | null {
    const q = typeof location === 'undefined' ? '' : location.search;
    if (q !== this.forcedAt) {
      this.forcedAt = q;
      this.forcedWx = forcedWeather(q);
    }
    return this.forcedWx;
  }
  /**
   * Покои правителя (`inside.ts`): пока стоят, кадр — изнутри донжона, камера — камера комнаты, город за окнами — упрощённым
   * уровнем (`simplify`). `aim` — точка взгляда на земле: за ней идут солнце с коробкой теней, огни и дождь.
   */
  private inside: Inside | null = null;
  private aim = new THREE.Vector3();
  /** Середина коробки теней изнутри (`INSIDE_SHADOW_AHEAD`), до сетки текселей. */
  private shadowAt = new THREE.Vector3();
  private sky: InsideSky = {
    daylight: 1,
    night: 0,
    nightK: 0,
    sky: new THREE.Color(),
    haze: new THREE.Color(),
    sunDir: new THREE.Vector3(0, 1, 0),
    sun: new THREE.Color(),
    hemi: new THREE.Color(),
    rain: 0,
    snow: 0,
    mist: 0,
    cloud: 0,
    wind: 0,
    windX: 1,
    windZ: 0,
    flash: 0,
  };
  /** Фаза солнца этого кадра — распорядку дня города (`rhythm.rhythmAt`). */
  private solar = 0.15;
  /**
   * Враг идёт к городу (мир, `marchesOnHome`) — тревога в виде. Подписка на стор мира — здесь, в куске города, а не в полотне
   * игры: первая загрузка не растёт.
   */
  private threat = false;
  private unThreat: (() => void) | null = null;
  /** Состояние города в виде (`rhythm.moodOf`) и работающие постройки — места людей днём. */
  private mood: CityMood = CALM_MOOD;
  private stations: Anchor[] = [];
  private stationKey = '';
  /** Сколько народу на улицах и стражи на стене и какие дворы работают — из партии (`sync`). */
  private crowd: { people: number; guards: number; busy: BuildingTypeId[] } = { people: 40, guards: 6, busy: [] };

  constructor(canvas: HTMLCanvasElement, pixelRatio: number | null = null, opts: SceneLook = {}) {
    super(canvas, pixelRatio, opts);
    const spec = CITY_SPEC[this.quality];
    const sun = this.rig.sun;
    sun.shadow.mapSize.set(spec.shadowMap, spec.shadowMap);
    sun.shadow.radius = this.quality === 'high' ? 3 : 2;
    sun.shadow.normalBias = 0.06;
    sun.shadow.bias = -0.0006;
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 1400;
    // Кольцо выбора лежит на земле города: тест глубины — против склонов, отступ — против мерцания.
    const ring = this.selection.material as THREE.MeshBasicMaterial;
    ring.polygonOffset = true;
    ring.polygonOffsetFactor = -4;
    // Город встаёт на слоях 256², `ready` — когда пришли и полные (стенду — снимать на них).
    const threat = (w: ReturnType<typeof useWorld.getState>): boolean => marchesOnHome(w.marches, w.info?.homeId).length > 0;
    this.setThreat(threat(useWorld.getState()));
    this.unThreat = useWorld.subscribe((w, was) => {
      if (w.marches !== was.marches || w.info !== was.info) this.setThreat(threat(w));
    });
    this.ready = buildCity(this.quality).then((c) => {
      this.mount(c);
      return c.full;
    });
  }

  /** Город собран: встаёт целиком, на место дымки. Сцену могли выгрузить, пока он собирался. */
  private mount(c: CityBuild): void {
    if (this.disposed) {
      disposeGeometries(c.group);
      c.dispose();
      return;
    }
    this.town = c;
    // Покои — вид изнутри: город пересобран, пока они открыты, — им же и правится (`Inside.attach`).
    if (this.inside) this.inside.attach?.(c.group);
    this.sites = c.sites;
    this.scene.add(c.group);
    this.folk = new CityLife({ plan: c.plan, chimneys: c.chimneys, flagTops: c.flagTops, quality: this.quality });
    this.scene.add(this.folk.group);
    // Люди, стража и суета — под огнями ночи: у факела ворот стража тёплая, а не синяя (docs/polish.md, П-9).
    lightScene(this.folk.group, c.uniforms);
    this.folk.set(this.crowd.people, this.crowd.guards, this.workSmoke());
    // Распорядок и состояние города (docs/city_v3.md, ЖГ-1): вечером — у трактира, в голод — очередь у амбара.
    this.folk.setPlaces(mainSite(this.sites, 'tavern'), mainSite(this.sites, 'storage'));
    this.stationKey = '';
    if (this.lastState) this.moodNow(this.lastState);
    this.bustleWanted = true;
    for (const view of this.buildings.values()) this.place3(view);
    if (this.selected !== null) this.setSelected(this.selected);
    if (this.showDue) this.showBuilding(this.showDue);
  }

  /** Дым работы: над трубой работающей кузницы (`worksigns.workBusy`, правило посёлка). */
  private workSmoke(): SmokeSource[] {
    const c = this.town;
    if (!c) return [];
    const out: SmokeSource[] = [];
    for (const type of this.crowd.busy) {
      const m = mainSite(this.sites, type);
      if (!m) continue;
      // Труба этого здания — ближайшая к его середине в его следе.
      let best: V3 | null = null;
      let bd = Math.max(m.hf, m.hr) + 1;
      for (const ch of c.chimneys) {
        const d = Math.hypot(ch[0] - m.x, ch[2] - m.z);
        if (d < bd) {
          bd = d;
          best = ch;
        }
      }
      if (best) out.push({ x: best[0], y: best[1], z: best[2], puffs: 9, top: 16 });
    }
    return out;
  }

  // ---------- Камера ----------

  protected override applyFraming(aspect: number): void {
    if (this.inside) {
      this.inside.camera.aspect = aspect;
      this.inside.camera.updateProjectionMatrix();
    }
    const f = cityFraming(aspect);
    this.camera.fov = f.fov;
    this.camera.near = 1;
    this.zoom = f.zoom;
    this.polar = f.polar;
    this.dist = Math.min(Math.max(this.dist, f.zoom.min), f.zoom.max);
    if (!this.userMoved) {
      this.target.set(f.target.x, f.target.y, f.target.z);
      this.dist = f.dist;
    }
    this.place();
  }

  /** Камера по своим числам; дымка, дальняя плоскость и коробка теней идут за расстоянием и целью. */
  protected override place(): void {
    if (this.inside) {
      this.placeInside(this.inside);
      return;
    }
    this.camera.position.setFromSpherical(new THREE.Spherical(this.dist, this.polar, CITY_AZIMUTH + this.spinTurn)).add(this.target);
    this.camera.lookAt(this.target);
    const fog = this.scene.fog as THREE.Fog | null;
    const f = cityFog(this.dist);
    if (fog) {
      fog.near = f.near;
      fog.far = f.far;
    }
    this.camera.far = f.far + 200;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    fitShadow(this.rig, cityShadowHalf(this.dist));
    // Ухо фона: приблизил к улицам — слышны рынок и кузница, отдалил — ветер и гул (docs/audio.md, раздел 4).
    hearCity(this.dist, this.zoom.min, this.zoom.max);
  }

  /**
   * Камера города — на месте и взгляде камеры комнаты, со своей ближней плоскостью в метре (`inside.INSIDE_DEPTH`); дымка,
   * коробка теней и ухо — как у камеры в `INSIDE_DIST` метрах от цели (улицы издали — ветер и гул).
   */
  private placeInside(room: Inside): void {
    const rc = room.camera;
    rc.updateMatrixWorld();
    this.camera.position.copy(rc.position);
    this.camera.quaternion.copy(rc.quaternion);
    this.camera.fov = rc.fov;
    this.camera.near = 1;
    const fwd = rc.getWorldDirection(TMP_V);
    const len = Math.hypot(fwd.x, fwd.z) || 1;
    this.aim.set(rc.position.x + (fwd.x / len) * INSIDE_AIM, 0, rc.position.z + (fwd.z / len) * INSIDE_AIM);
    this.shadowAt.set(rc.position.x + (fwd.x / len) * INSIDE_SHADOW_AHEAD, 0, rc.position.z + (fwd.z / len) * INSIDE_SHADOW_AHEAD);
    const f = cityFog(INSIDE_DIST);
    const fog = this.scene.fog as THREE.Fog | null;
    if (fog) {
      fog.near = f.near;
      fog.far = f.far;
    }
    // Изнутри даль открыта до края земли (`Inside.far`, Г-7).
    this.camera.far = Math.max(f.far + 200, room.far ?? 0);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    fitShadow(this.rig, cityShadowHalf(INSIDE_DIST));
    hearCity(this.zoom.max, this.zoom.min, this.zoom.max);
  }

  /** Куда смотрит кадр по земле: цель камеры города или точка взгляда из покоев. */
  private get eye(): THREE.Vector3 {
    return this.inside ? this.aim : this.target;
  }

  /** На каком расстоянии смотрит кадр: дымке, дождю и огням. */
  private get seeDist(): number {
    return this.inside ? INSIDE_DIST : this.dist;
  }

  /** Донжон города — в нём покои (`render/chambers`); пока город не встал — нет. */
  keep(): Tower | null {
    return this.town?.plan.towers.find((t) => t.kind === 'keep') ?? null;
  }

  /**
   * Войти в покои: кадр — изнутри, пальцы берёт слой покоев поверх холста, город за окнами — упрощённым уровнем. Пока
   * город не встал, входить некуда (`false`).
   */
  enterInside(room: Inside): boolean {
    if (this.disposed || !this.town) return false;
    this.inside = room;
    room.camera.aspect = this.camera.aspect;
    room.camera.updateProjectionMatrix();
    room.setLevel(this.dprLevel);
    this.simplify();
    room.attach?.(this.town.group);
    // Ярлыки «Ускорить» и надписи добычи — вид города сверху: в покоях их нет (`deeds.css`).
    this.canvas.parentElement?.classList.add('city-inside');
    this.place();
    return true;
  }

  /** Выйти из покоев: камера города — на прежних цели и расстоянии, уровни города — свои. */
  leaveInside(room: Inside): void {
    if (this.inside !== room) return;
    this.inside = null;
    this.simplify();
    room.detach?.();
    this.canvas.parentElement?.classList.remove('city-inside');
    this.applyFraming(this.camera.aspect);
  }

  /**
   * Город за окном — упрощённым видом: заливка — только в проёмах окон (`draw`), тень — реже (`INSIDE_SHADOW_EVERY`),
   * настоящих огней — уровнем ниже (из окна они в десятках метров, а кадр несёт ещё и комнату). Осадки и вода опускаются
   * только сторожем и только вниз (`precip.setLevel`, `lowerWater`) — их покои не трогают, чтобы выход вернул город как был.
   */
  private simplify(): void {
    const level = this.inside ? (lowerQuality(this.dprLevel) ?? 'low') : this.dprLevel;
    this.town?.rig.setCap(LAMP_SPEC[level].real);
  }

  protected override shadowEvery(): number {
    return this.inside ? INSIDE_SHADOW_EVERY : super.shadowEvery();
  }

  /**
   * Кадр изнутри — двумя проходами (`inside.ts`): буфер — небом города, комната, потом город без фона (фон-цвет three
   * чистит буфер сам) и без значков над крышами и кольца выбора — вида сверху. Город встаёт только в проёмах окон.
   */
  protected override draw(): void {
    const room = this.inside;
    if (!room) {
      super.draw();
      return;
    }
    const r = this.renderer;
    const bg = this.scene.background as THREE.Color;
    r.setClearColor(bg, 1);
    r.clear(true, true, false);
    r.autoClear = false;
    r.render(room.scene, room.camera);
    const ring = this.selection.visible;
    this.selection.visible = false;
    for (const v of this.buildings.values()) if (v.marker) v.marker.visible = false;
    this.scene.background = null;
    r.render(this.scene, this.camera);
    this.scene.background = bg;
    for (const v of this.buildings.values()) if (v.marker) v.marker.visible = true;
    this.selection.visible = ring;
    r.autoClear = true;
  }

  protected override leash = (): void => {
    const p = cityLeash(this.target.x, this.target.z);
    this.target.x = p.x;
    this.target.z = p.z;
  };

  // ---------- Свет ----------

  protected override applyDayNight(solar: number): void {
    this.solar = solar;
    this.light = applyDayNight(this.rig, this.scene, solar, this.seasonVis, CITY_KEY, RIG.next);
    // Риг посёлка ставит лампу в сорока единицах от середины: городу — над целью камеры, далеко,
    // чтобы коробка теней шла за кадром.
    const sun = this.rig.sun;
    // Изнутри покоев — коробка от стены донжона вперёд и на сетке текселей (Г-9); снаружи — над целью камеры, как было.
    const c = this.inside ? shadowSnap(this.shadowAt, sun.position, (2 * cityShadowHalf(INSIDE_DIST)) / sun.shadow.mapSize.x) : this.eye;
    const at = citySunAt(c, sun.position);
    sun.position.set(at.x, at.y, at.z);
    sun.target.position.set(c.x, c.y, c.z);
    sun.target.updateMatrixWorld();
    // Узкие улицы глубже открытого посёлка: заполняющему свету — треть сверху (стенд, круг 2).
    this.rig.hemi.intensity *= 1.35;
    this.weather(solar);
  }

  override setRegion(region: string | null): void {
    this.region = region;
  }

  /** Погода кадра встаёт на погоду часов сразу, без перелива: стенду — снять её, не дожидаясь. */
  jumpWeather(): void {
    this.wxAt = 0;
    this.precip?.groundNow();
  }

  /** Сторож плавности опустил уровень: осадки режут счёт сразу, вместе с плотностью (`precip.setLevel`). */
  override lowerTo(next: Quality): void {
    super.lowerTo(next);
    this.precip?.setLevel(this.dprLevel);
    // Вода — тем же уровнем: рябь, круги дождя и огни в ней режутся сразу, без пересборки (docs/polish.md, П-8).
    lowerWater(this.scene, CITY_SPEC[this.dprLevel].detail);
    // Огни — тем же уровнем: настоящих меньше, остальные гаснут наплывом в пятна; в покоях — ещё на ступень ниже
    // (`simplify`). Покои — тем же уровнем: сторож у сцены один.
    this.simplify();
    this.inside?.setLevel(this.dprLevel);
  }

  /**
   * Погода кадра — функция региона и общих часов (`climate.weatherAt`): тучи гасят солнце и серят небо, дождь темнит,
   * утренний туман белит дымку, молния мягко высвечивает небо и город. Сырость — тоже от часов: дождь последних минут.
   */
  private weather(solar: number): void {
    const now = serverNow();
    const f = this.forced;
    const goal = f ?? weatherAt(this.region, now, this.season, solar);
    // Погода кадра идёт к погоде часов плавно: скачок цели наплывает за несколько секунд.
    const real = performance.now();
    const k = this.wxAt === 0 ? 1 : 1 - Math.exp(-Math.min(1, (real - this.wxAt) / 1000) / WX_EASE);
    this.wxAt = real;
    const w = (this.wx = easeWeather(this.wx, goal, k));
    let wet = w.rain;
    if (!f) for (const [back, keep] of DRY) wet = Math.max(wet, weatherAt(this.region, now - back * 1000, this.season, solar).rain * keep);
    this.wet = wet;
    this.lying = lyingSnow(this.region, now, f);
    // Вспышка: адресом «гроза» — раз в девять секунд, иначе — молнии региона.
    this.flash = f
      ? forcedFlashes(f.storm, now - 3000, now + 1).reduce((v, x) => v + flashGlow((now - x.at) / 1000) * x.power, 0)
      : flashAt(this.region, this.season, now);
    const dim = Math.max(w.rain, w.snow);
    this.rig.sun.intensity *= 1 - 0.6 * w.cloud - 0.15 * dim;
    // Под тучами свет рассеянный: прямого меньше, неба — больше (тени мягчеют, кадр не проваливается в темень).
    this.rig.hemi.intensity *= 1 + 0.18 * w.cloud - 0.1 * dim;
    const bg = this.scene.background as THREE.Color;
    const fog = (this.scene.fog as THREE.Fog).color;
    for (const c of [bg, fog]) greyen(c, 0.65 * w.cloud, 1 - 0.24 * w.rain - 0.1 * w.storm + 0.05 * w.snow);
    if (w.fog > 0) fog.lerp(TMP_C.copy(MIST_SKY).multiplyScalar(0.35 + 0.65 * this.light.daylight), w.fog * 0.55);
    if (this.flash > 0) {
      this.rig.hemi.intensity += this.flash * 1.3;
      bg.lerp(FLASH_SKY, this.flash * 0.5);
      fog.lerp(FLASH_SKY, this.flash * 0.3);
    }
  }

  // ---------- Кадр ----------

  protected override settled(): boolean {
    return this.town !== null;
  }

  /** Шейдер города за кадром (ночь, снег, осень, солнце, подсветка выбранного), огни, жизнь и значки. */
  protected override animate(dt: number, t: number): void {
    this.stepFly(t);
    const c = this.town;
    // Покои: камера комнаты шагает первой — город берёт её место и взгляд (`placeInside`).
    if (this.inside && c) {
      this.inside.frame(dt, t, this.skyNow());
      this.placeInside(this.inside);
    }
    if (c) {
      const u = c.uniforms;
      const night = windowNight(this.light);
      u.cNight.value = night;
      u.cBlue.value = this.light.nightK;
      // Зима сезона партии — голые кроны и сухой камыш; снег на кровлях и земле — по климату региона; лёд — по холоду пояса.
      const winter = this.seasonVis.snow;
      const ice = winter * ZONES[zoneOf(this.region)].frost;
      u.cSnow.value = winter * this.lying;
      u.cWinter.value = winter;
      u.cIce.value = ice;
      u.cAutumn.value = Math.max(0, Math.min(1, this.seasonVis.turn));
      u.cTime.value = t;
      u.cSunDir.value.copy(this.rig.sun.position).sub(this.rig.sun.target.position).normalize();
      u.cSky.value.copy((this.scene.fog as THREE.Fog).color);
      // Показанная постройка («Показать в городе») светится сильнее и чаще выбранной — пока не кончилась подсветка.
      const shown = this.shown && t < this.shown.until ? this.shown.type : null;
      if (this.shown && !shown) {
        this.shown = null;
        this.labels?.light(null);
      }
      const sel = shown ?? (this.selected !== null ? (this.buildings.get(this.selected)?.type ?? 'campfire') : null);
      u.cSel.value = sel !== null ? ownerCode(sel) : 0;
      u.cSelGlow.value = shown ? 0.42 + Math.sin(t * 6) * 0.22 : 0.18 + Math.sin(t * 3) * 0.1;
      // Погода в шейдерах: на «Низком» — без теней облаков и кругов на воде (сырость и туман — даром).
      const w = this.wx;
      const lo = this.quality === 'low';
      const dir = windTo(w.from);
      const aloft = windTo(ZONES[zoneOf(this.region)].from);
      u.cWet.value = this.wet;
      u.cCloud.value = lo ? 0 : w.cloud;
      u.cCloudAt.value.set(aloft.x * CLOUD_SPEED * t, aloft.z * CLOUD_SPEED * t);
      u.cMist.value = w.fog;
      u.cRain.value = lo ? 0 : w.rain;
      // Пелена вдали — дождь и снег; её полосы идут по ветру. Блик солнца на мокром — где солнце видно сквозь тучи.
      u.cVeil.value = Math.max(w.rain * 0.9, w.snow * 0.7);
      this.veilAt.x += dir.x * VEIL_SPEED * (0.5 + w.wind) * dt;
      this.veilAt.y += dir.z * VEIL_SPEED * (0.5 + w.wind) * dt;
      u.cVeilAt.value.copy(this.veilAt);
      u.cSunLit.value = this.light.daylight * Math.max(0, 1 - 1.1 * w.cloud) * (1 - night);
      u.cWindDir.value.set(dir.x, dir.z);
      u.cWind.value = w.wind;
      this.folk?.setWind(dir.x, dir.z, w.wind);
      // Дождь и снег прячут даль, туман — ещё и ближнее.
      const fog = this.scene.fog as THREE.Fog | null;
      if (fog) {
        const base = cityFog(this.seeDist);
        const dim = Math.max(w.rain, w.snow);
        fog.near = base.near * (1 - 0.25 * dim - 0.5 * w.fog);
        fog.far = base.far * (1 - 0.2 * dim - 0.35 * w.fog);
      }
      if (this.precip && fog) {
        this.precip.update({
          t,
          rain: w.rain,
          snow: w.snow,
          windX: dir.x,
          windZ: dir.z,
          wind: w.wind,
          center: this.eye,
          dist: this.seeDist,
          camera: this.camera,
          bufferHeight: this.renderer.domElement.height,
          light: Math.max(0.22, this.light.daylight),
          flash: this.flash,
          night,
          sky: fog.color,
          fogNear: fog.near,
          fogFar: fog.far,
        });
      }
      // Огни ночи (docs/polish.md, П-9): загораются по одному, мерцают; настоящие — ближние к взгляду.
      c.rig.update(t, dt, night, this.eye.x, this.eye.z, this.camera, this.renderer.domElement.height);
      this.folk?.update(dt, t, night, this.seasonVis.snow, rhythmAt(this.solar));
      this.garrison?.update(t, this.camera);
      // Колесо лесопилки крутится и брызжет — от времени (ручей не мёрзнет).
      c.mill?.update(t);
      // Суета судит о льде: на реке без льда утки и лодки остаются и зимой.
      this.bustle?.update(t, night, ice);
      if (this.deeds) {
        // Точкам пыли и вспышек — размер в метрах: three делит на расстояние и множит на полвысоты буфера.
        const scale = 1 / Math.tan((this.camera.fov * Math.PI) / 360);
        this.deeds.update(t, night, scale, { x: this.camera.position.x, z: this.camera.position.z });
      }
      this.pops?.update(this.camera, this.canvas.clientWidth, this.canvas.clientHeight, t);
      this.tags?.update(this.camera, this.canvas.clientWidth, this.canvas.clientHeight);
      if (!this.inside) this.labels?.update(this.camera, this.canvas.clientWidth, this.canvas.clientHeight, labelsAlpha(this.dist, this.zoom, labelsOn()));
      // Первый кадр города нарисован — теперь докачка суеты.
      if (this.bustleWanted) {
        this.bustleWanted = false;
        this.loadBustle(c);
      }
    }
    // Значки покачиваются — взгляд цепляется без лишних цветов.
    for (const view of this.buildings.values()) {
      if (view.marker) view.marker.position.y = view.markerY + Math.sin(t * 2.2 + view.markerY) * 0.6;
    }
  }

  /** Что город видит этим кадром — покоям: свет в окна и погода у окна (числа прошлого кадра света и погоды). */
  private skyNow(): InsideSky {
    const k = this.sky;
    const w = this.wx;
    k.daylight = this.light.daylight;
    k.night = windowNight(this.light);
    k.nightK = this.light.nightK;
    k.sky.copy(this.scene.background as THREE.Color);
    k.haze.copy((this.scene.fog as THREE.Fog).color);
    k.sunDir.copy(this.rig.sun.position).sub(this.rig.sun.target.position).normalize();
    k.sun.copy(this.rig.sun.color).multiplyScalar(this.rig.sun.intensity);
    k.hemi.copy(this.rig.hemi.color).multiplyScalar(this.rig.hemi.intensity);
    const dir = windTo(w.from);
    k.rain = w.rain;
    k.snow = w.snow;
    k.mist = w.fog;
    k.cloud = w.cloud;
    k.wind = w.wind;
    k.windX = dir.x;
    k.windZ = dir.z;
    k.flash = this.flash;
    return k;
  }

  /** Кусок суеты: пришёл, когда сцену ещё не выгрузили и город тот же, — встаёт; не пришёл — город живёт без него. */
  private loadBustle(c: CityBuild): void {
    // Осадки — своей докачкой, на каждом уровне (на «Низком» — проще: меньше струй, без брызг). Поле высот — из кровель,
    // земли и воды: на них кончается капля и ложатся брызги.
    import('./precip')
      .then(({ CityPrecip }) => {
        if (this.disposed || this.town !== c) return;
        const p = new CityPrecip(this.quality, c.uniforms);
        p.setLevel(this.dprLevel);
        p.ground(['city-buildings', 'city-ground', 'city-water'].map((n) => c.group.getObjectByName(n)).filter((m): m is THREE.Mesh => m instanceof THREE.Mesh));
        this.precip = p;
        this.scene.add(p.group);
      })
      .catch(() => undefined);
    import('./alive')
      .then(({ CityBustle }) => {
        if (this.disposed || this.town !== c) return;
        this.bustle = new CityBustle({ plan: c.plan, quality: this.quality });
        this.bustle.setArms(this.lastState?.profile.arms);
        lightScene(this.bustle.group, c.uniforms);
        this.scene.add(this.bustle.group);
      })
      .catch(() => undefined);
    // Стража — те же бойцы, что в роликах: своим куском; не пришёл — стоят прежние фигуры стражи.
    import('./garrison')
      .then(({ CityGarrison }) => {
        if (this.disposed || this.town !== c || !this.folk) return;
        this.garrison = new CityGarrison(this.folk, this.quality, this.lastState?.profile.arms);
        lightScene(this.garrison.group, c.uniforms);
        this.scene.add(this.garrison.group);
      })
      .catch(() => undefined);
    // Отклик — своим куском, тем же правилом: не пришёл — город стоит без лесов и надписей, игра идёт как шла.
    import('./deeds')
      .then(({ CityDeeds, CityPops, SiteTags, CityLabels, YieldTally }) => {
        if (this.disposed || this.town !== c || !this.folk) return;
        this.deeds = new CityDeeds({ sites: this.sites, quality: this.quality, street: this.folk.street() });
        this.scene.add(this.deeds.group);
        this.pops = new CityPops(this.canvas.parentElement, this.quality, markerSvg, new THREE.Vector3());
        this.tags = new SiteTags(this.canvas.parentElement, new THREE.Vector3());
        this.labels = new CityLabels(this.canvas.parentElement, new THREE.Vector3());
        this.labels.light(this.shown?.type ?? null);
        this.tally = new YieldTally();
        if (this.lastState) this.respond(this.lastState);
        if (this.welcomeDue > 0) this.welcome(this.welcomeDue);
      })
      .catch(() => undefined);
  }

  /**
   * Отклик на партию: леса у построек, которые улучшаются; праздник у той, чья стройка кончилась; выход обученных по
   * заказам найма; добыча дворов за прожитое партией время. Первое чтение только запоминает: уровни и найм, бывшие до
   * входа, — не новость.
   */
  private respond(s: GameState): void {
    const deeds = this.deeds;
    if (!deeds) return;
    const t = this.sceneNow();
    deeds.setWorks(s.buildings.filter((b) => b.workRequired > 0).map((b) => b.type));
    // Ярлык «Ускорить» — у лесов: над главной точкой строящейся постройки, чуть ниже надписей добычи.
    this.tags?.set(
      s.buildings
        .filter((b) => b.workRequired > 0)
        .flatMap((b) => {
          const m = mainSite(this.sites, b.type);
          return m ? [{ type: b.type, x: m.x, y: m.y1 + 1.2, z: m.z }] : [];
        }),
    );
    this.labels?.set(this.labelSpots(s));
    const prev = this.seen;
    const real = performance.now();
    this.seen = { was: seenOf(s), real };
    if (!prev) return;
    const news = newsOf(prev.was, s);
    for (const type of news.done) deeds.done(type, t);
    if (news.trained > 0) deeds.muster(news.trained, t);
    // Волна — когда партия прожила отлучку (страница спала): и игрового времени, и настоящего прошло больше порога (под
    // скоростью проверки игровых секунд за шаг много, а настоящих — полсекунды).
    this.yieldFor(s, news.dt, news.dt > waveAfter() && real - prev.real > WAVE_REAL * 1000);
  }

  /**
   * «Сейчас» на часах сцены — для чтения партии между кадрами: часы сцены идут кадрами (`clock.getDelta`), и после
   * долгого кадра или возврата из фона их последнее показание отстало бы — праздник начался бы в прошлом.
   */
  private sceneNow(): number {
    const c = this.clock;
    return c.running ? c.elapsedTime + Math.max(0, performance.now() - c.oldTime) / 1000 : c.elapsedTime;
  }

  /** Выработка дворов (вольный сбор — площади у костра) за `dt` игровых секунд — надписями над постройками. */
  private yieldFor(s: GameState, dt: number, wave: boolean): void {
    const tally = this.tally;
    const pops = this.pops;
    if (!tally || !pops || !(dt > 0)) return;
    const yards: Yard[] = [];
    const free = productionPerDay(s);
    for (const b of s.buildings) {
      const perDay = buildingProduction(s, b);
      yards.push({ type: b.type, perDay });
      for (const r of RESOURCE_IDS) free[r] -= perDay[r];
    }
    const camp = yards.find((y) => y.type === 'campfire');
    if (camp) for (const r of RESOURCE_IDS) camp.perDay[r] += Math.max(0, free[r]);
    const cap = storageCap(s);
    const full = new Set<ResourceId>(RESOURCE_IDS.filter((r) => s.resources[r] >= cap - 1));
    const t = this.sceneNow();
    const list = tally.feed(yards, dt, t, full, wave);
    const placed = list.flatMap((pop) => {
      const m = mainSite(this.sites, pop.type);
      return m ? [{ x: m.x, y: m.y1 + 2.5, z: m.z, pop }] : [];
    });
    // Волна — по дальности от середины кадра: от того, на что смотрят, к краям.
    if (wave) placed.sort((a, b) => Math.hypot(a.x - this.target.x, a.z - this.target.z) - Math.hypot(b.x - this.target.x, b.z - this.target.z));
    pops.add(placed, wave, t);
  }

  /**
   * Игрок вернулся и закрыл окно «С возвращением» (`GameCanvas`): добыча отлучки — одной волной над дворами. Партия
   * догнана при чтении (`save.enter`), здесь — только показ: выработка дворов за `gameSec` игровых секунд отлучки.
   */
  override welcome(gameSec: number): void {
    if (!this.deeds || !this.lastState) {
      this.welcomeDue = gameSec;
      return;
    }
    this.welcomeDue = 0;
    this.yieldFor(this.lastState, gameSec, true);
  }

  // ---------- Постройки ----------

  protected override syncWorld(s: GameState): void {
    // Герб державы на стягах башен (П-2): кусок оживления мог ещё не приехать — тогда возьмёт при следующем кадре стора.
    this.bustle?.setArms(s.profile.arms);
    this.folk?.setLivery(s.profile.arms);
    this.garrison?.setArms(s.profile.arms);
    // Модели у города свои и одни навсегда (docs/city.md, раздел 5): уровни игры их не меняют. Здание
    // игры здесь — пустая группа на главном месте постройки: к ней цепляется значок, по её типу —
    // касание и подсветка.
    const seen = new Set<number>();
    for (const b of s.buildings) {
      seen.add(b.id);
      let view = this.buildings.get(b.id);
      if (!view) {
        const group = new THREE.Group();
        this.scene.add(group);
        view = { group, type: b.type, marker: null, markerKind: null, markerY: 0 };
        this.buildings.set(b.id, view);
        this.place3(view);
      }
      this.setMarker(view, buildingAttention(s, b));
    }
    for (const [id, view] of this.buildings) {
      if (seen.has(id)) continue;
      this.scene.remove(view.group);
      this.buildings.delete(id);
    }
    if (this.selected !== null) this.setSelected(this.selected);
    // Улицы — по населению, стена — по войску; дым работы — по правилу посёлка (`workBusy`).
    this.crowd = {
      // Посёлок в тридцать душ — уже семьдесят прохожих: город с первого дня живой (docs/city.md, 13.1).
      people: 40 + population(s),
      guards: 4 + armySize(s) * 0.5,
      busy: s.buildings.filter((b) => WORK_SIGN[b.type]?.smoke && workBusy(s, b, false)).map((b) => b.type),
    };
    this.folk?.set(this.crowd.people, this.crowd.guards, this.workSmoke());
    this.moodNow(s);
    this.lastState = s;
    this.respond(s);
  }

  /**
   * Враг идёт к городу (набег на карте, `world/store.marchesOnHome`): люди прячутся, стража на стенах — тревога в виде
   * (docs/city_v3.md, ЖГ-1).
   */
  private setThreat(on: boolean): void {
    if (on === this.threat) return;
    this.threat = on;
    if (this.lastState) this.moodNow(this.lastState);
  }

  /**
   * Состояние города в виде и места работы — из партии: праздник после победы, тревога, голод, мор, мораль
   * (`rhythm.moodOf`); у работающих построек (есть люди на местах) днём стоят работники. Адрес `?mood=` — стенду.
   */
  private moodNow(s: GameState): void {
    const until = feastClock.observe(s);
    this.mood = (typeof location !== 'undefined' ? forcedMood(location.search) : null) ?? moodOf(s, this.threat, until);
    // Трактир и амбар живут своим распорядком, в храме служат внутри — у них работников у фасада нет.
    const busy = s.buildings.filter((b) => (s.workers[b.id] ?? 0) > 0 && b.type !== 'tavern' && b.type !== 'storage' && b.type !== 'church').map((b) => b.type);
    const key = busy.join(',');
    if (key !== this.stationKey) {
      this.stationKey = key;
      this.stations = busy.map((type) => mainSite(this.sites, type)).filter((m): m is NonNullable<typeof m> => m !== null).slice(0, 6);
      this.folk?.setStations(this.stations);
    }
    this.folk?.setMood(this.mood, lookOf(this.mood));
  }

  /** Группа здания — на главное место его постройки, значок — над крышей. */
  private place3(view: BuildingView): void {
    const m = mainSite(this.sites, view.type);
    if (!m) return;
    view.group.position.set(m.x, 0, m.z);
    view.markerY = m.y1 + 4;
    if (view.marker) view.marker.position.y = view.markerY;
  }

  protected override setMarker(view: BuildingView, kind: Attention | null): void {
    super.setMarker(view, kind);
    const sprite = view.marker;
    if (!sprite || sprite.material.sizeAttenuation === false) return;
    // Значок — постоянного размера на экране: город смотрят и с полукилометра, и с улицы.
    sprite.material.sizeAttenuation = false;
    sprite.scale.setScalar(MARKER_SCREEN);
  }

  override setSelected(id: number | null): void {
    this.selected = id;
    const view = id !== null ? this.buildings.get(id) : undefined;
    const m = view ? mainSite(this.sites, view.type) : null;
    // Кольцо — у постройки одним местом; у Жилищ, башен и стены их много — их подсвечивает шейдер целиком.
    const many = view ? this.sites.filter((s) => s.type === view.type).length > 1 : false;
    if (!view || !m || many) {
      this.selection.visible = false;
      return;
    }
    const r = Math.max(m.hf, m.hr) * 1.15 + 1.5;
    let y = -Infinity;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      y = Math.max(y, heightAt(m.x + Math.cos(a) * r, m.z + Math.sin(a) * r));
    }
    this.selection.position.set(m.x, y + 0.35, m.z);
    // Кольцо — 0.86..1.06 в своих единицах: масштаб — радиус в метрах.
    this.selection.scale.setScalar(r);
    this.selection.visible = true;
  }

  // ---------- Ориентация (ОР-1, docs/ui_v2.md, 5.9) ----------

  /**
   * Подписи построек: имя — на теле главного места (`mainSite`), метка — точкой в подписи и только вблизи (ЗН-3). Метка —
   * того, что ждёт игрока и не беда (`labels.Mark`); беда — бляхой (`ROOF_NEW`), и метки у неё нет.
   */
  private labelSpots(s: GameState): LabelSpot[] {
    return s.buildings.flatMap((b) => {
      const m = mainSite(this.sites, b.type);
      if (!m) return [];
      const kind = buildingAttention(s, b);
      return [
        {
          type: b.type,
          name: buildingTitle(s, b.type),
          mark: kind === 'upgrade' || kind === 'slot' ? kind : null,
          body: { x: m.x, y: (m.y0 + m.y1) / 2, z: m.z },
        },
      ];
    });
  }

  /** Камера сейчас. */
  private pose(): CamPose {
    return { x: this.target.x, z: this.target.z, dist: this.dist };
  }

  private flyTo(to: CamPose): void {
    const from = this.pose();
    this.fly = { from, to: { ...to, dist: Math.min(Math.max(to.dist, this.zoom.min), this.zoom.max) }, at: this.sceneNow(), was: from };
    this.userMoved = true;
  }

  /**
   * Шаг полёта камеры (`camera.flyAt`): цель и расстояние — к концу полёта, через поводок панорамы. Палец сдвинул камеру
   * между кадрами — полёт уступает ему: игрок ведёт сам.
   */
  private stepFly(t: number): void {
    // Просьба интерфейса (`sitetags.askCam`): в покоях её нет — кнопки города там не стоят.
    const ask = this.inside ? null : takeCamAsk();
    if (ask) this.showBuilding(ask.type as BuildingTypeId);
    const f = this.fly;
    if (f && !this.inside) {
      const p = this.pose();
      if (p.x !== f.was.x || p.z !== f.was.z || p.dist !== f.was.dist) this.fly = null;
      else {
        const k = (t - f.at) / FLY_S;
        const next = flyAt(f.from, f.to, k);
        this.target.x = next.x;
        this.target.z = next.z;
        this.dist = next.dist;
        this.leash();
        this.place();
        f.was = this.pose();
        if (k >= 1) this.fly = null;
      }
    }
  }

  /**
   * «Показать в городе»: камера летит к главному месту постройки (`showDist` — по её размеру) и подсвечивает её — вся
   * постройка светится (`cSel`) и подпись золотом, пока не кончится `SHOW_GLOW_S` после полёта. Город не встал — покажет,
   * когда встанет.
   */
  private showBuilding(type: BuildingTypeId): void {
    if (!this.town) {
      this.showDue = type;
      return;
    }
    this.showDue = null;
    const m = mainSite(this.sites, type);
    if (!m) return;
    this.flyTo({ x: m.x, z: m.z, dist: showDist(m) });
    this.shown = { type, until: this.sceneNow() + FLY_S + SHOW_GLOW_S };
    this.labels?.light(type);
  }

  // ---------- Касание ----------

  private pickables(): Pickable[] {
    const out: Pickable[] = [];
    for (const [id, view] of this.buildings) {
      const sites = this.sites.filter((s) => s.type === view.type);
      if (sites.length > 0) out.push({ id, sites });
    }
    return out;
  }

  protected override pickAt(clientX: number, clientY: number): number | null {
    return cityPick(this.pickables(), this.camera, this.canvas.getBoundingClientRect(), clientX, clientY);
  }

  /** Область главного места на экране — подсветке обучения; мелкое раздувается до пальца. */
  protected override hitBoxOf(id: number): HitBox | null {
    const view = this.buildings.get(id);
    if (!view) return null;
    const m = mainSite(this.sites, view.type);
    if (!m) return null;
    return screenBox(id, [m], this.camera, this.canvas.getBoundingClientRect(), TAP_TARGET);
  }

  /** Стена — подсветка всего контура: обучению нечего показать звеном. */
  protected override wallSpot(id: number): HitBox | null {
    const view = this.buildings.get(id);
    if (!view || view.type !== 'palisade') return null;
    return screenBox(id, this.sites.filter((s) => s.type === 'palisade'), this.camera, this.canvas.getBoundingClientRect(), TAP_TARGET);
  }

  // ---------- Память и уборка ----------

  override textureBytes(): number {
    const s = this.rig.sun.shadow.mapSize.x;
    return s * s * 8 + (this.town?.textureBytes ?? 0);
  }

  override dispose(): void {
    this.unThreat?.();
    this.unThreat = null;
    this.garrison?.dispose();
    this.garrison = null;
    this.folk?.dispose();
    this.folk = null;
    this.bustle?.dispose();
    this.bustle = null;
    this.deeds?.dispose();
    this.deeds = null;
    this.precip?.dispose();
    this.precip = null;
    this.pops?.dispose();
    this.pops = null;
    this.tags?.dispose();
    this.tags = null;
    this.labels?.dispose();
    this.labels = null;
    this.town?.dispose();
    this.town = null;
    super.dispose();
  }
}

// Своё место в реестре сцен (`Scene.SCENES`): игра берёт класс сцены оттуда — другой сцены у неё нет.
Object.assign(SCENES, { game: CityScene });
