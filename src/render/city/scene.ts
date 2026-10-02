// Сцена вида «город» в игре (docs/city.md): `?look=city`. Наследник сцены посёлка: всё, что у сцены
// выстрадано — потеря контекста и её лечение, возвращение из фона, сторож кадров, дверь кадра, общий
// судья пальца, панорама и щипок, одалживание холста ролику о бое, — то же самое, одним кодом. Своё у
// города — мир (план, модели, земля, лес), камера в метрах, свет на весь мыс, касание по коробкам мест
// и подсветка выбранного.
//
// Ленивый кусок: едет до игры только при `?look=city` (`main.tsx`) и кладёт свой класс в `SCENES`.
import * as THREE from 'three';
import type { BuildingTypeId, GameState } from '@/game/types';
import { armySize, buildingAttention, dayFraction, population, seasonOf, solarPhase, type Attention } from '@/game/derived';
import type { SmokeSource } from '../weather';
import { WORK_SIGN, workBusy } from '../worksigns';
import type { V3 } from './geom';
import { CityLife } from './life';
import { gameSeconds } from '@/game/pace';
import { TAP_TARGET } from '@/gestures';
import { SCENES, TribeScene, type BuildingView, type SceneLook } from '../Scene';
import { RIG, applyDayNight, fitShadow, windowNight } from '../lighting';
import { disposeGeometries } from '../kit';
import type { HitBox } from '../pick';
import { buildCity, CITY_SPEC, type CityBuild } from './index';
import { CITY_KEY, CITY_AZIMUTH, CITY_STEP_MAX, cityFog, cityFraming, cityLeash, cityShadowHalf, citySunAt } from './camera';
import { cityPick, screenBox, type Pickable } from './pick';
import { mainSite, ownerCode, type Site } from './sites';
import { heightAt } from './layout';

/** Значок над крышей: доля высоты экрана (спрайт без перспективы — читается на любом приближении). */
const MARKER_SCREEN = 0.028;


export class CityScene extends TribeScene {
  /** Собранный город; до его прихода в кадре — дымка. */
  private town: CityBuild | null = null;
  /** Коробки 24 построек — с моделей, приходят вместе с городом. */
  private sites: Site[] = [];
  /** Город встал в сцену на полных слоях — стенду, чтобы снимать. */
  readonly built: Promise<void>;
  /** Люди, стража, дым, флаги, птицы, скот — встают вместе с городом. */
  private folk: CityLife | null = null;
  /** Сколько народу на улицах и стражи на стене и какие дворы работают — из партии (`sync`). */
  private crowd: { people: number; guards: number; busy: BuildingTypeId[] } = { people: 40, guards: 6, busy: [] };

  constructor(canvas: HTMLCanvasElement, pixelRatio: number | null = null, opts: SceneLook = {}) {
    super(canvas, pixelRatio, { ...opts, look: 'city' });
    this.stepMax = CITY_STEP_MAX;
    // Посёлок своим миром не нужен: земля, костёр-лампа, дым и фигурки — в масштабе посёлка.
    // Точечную лампу костра — вон из сцены: она удорожала бы каждый пиксель города.
    this.scene.remove(this.terrain, this.fireLight, this.figures.group, this.snowfall.points, this.smoke.points, this.chimneys.points, this.signs.group);
    disposeGeometries(this.terrain);
    this.terrain = new THREE.Group();
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
    // Город встаёт на слоях 256², `built` — когда пришли и полные (стенду — снимать на них).
    this.built = buildCity(this.quality).then((c) => {
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
    this.sites = c.sites;
    this.terrain = c.group;
    this.scene.add(c.group);
    this.folk = new CityLife({ plan: c.plan, chimneys: c.chimneys, flagTops: c.flagTops, quality: this.quality });
    this.scene.add(this.folk.group);
    this.folk.set(this.crowd.people, this.crowd.guards, this.workSmoke());
    for (const view of this.buildings.values()) this.place3(view);
    if (this.selected !== null) this.setSelected(this.selected);
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
  }

  protected override leash = (): void => {
    const p = cityLeash(this.target.x, this.target.z);
    this.target.x = p.x;
    this.target.z = p.z;
  };

  // ---------- Свет ----------

  protected override applyDayNight(solar: number): void {
    if (this.silhouette) return;
    this.light = applyDayNight(this.rig, this.scene, solar, this.seasonVis, CITY_KEY, RIG.next);
    // Риг посёлка ставит лампу в сорока единицах от середины: городу — над целью камеры, далеко,
    // чтобы коробка теней шла за кадром.
    const sun = this.rig.sun;
    const at = citySunAt(this.target, sun.position);
    sun.position.set(at.x, at.y, at.z);
    sun.target.position.copy(this.target);
    sun.target.updateMatrixWorld();
    // Узкие улицы глубже открытого посёлка: заполняющему свету — треть сверху (стенд, круг 2).
    this.rig.hemi.intensity *= 1.35;
  }

  // ---------- Кадр ----------

  protected override settled(): boolean {
    return this.town !== null;
  }

  protected override frame(): void {
    this.drawn++;
    const now = performance.now();
    const gap = now - this.lastFrame;
    this.lastFrame = now;
    if (this.needSize || this.drawn % 60 === 0) this.checkSize();
    const dt = Math.min(0.1, this.clock.getDelta());
    if (this.lent) return;
    this.watch(gap);
    const t = this.clock.elapsedTime;
    const gameNow = this.gameTime + gameSeconds((now - this.gameTimeAt) / 1000);
    this.seasonVis.update(this.season, dt);
    this.applyDayNight(solarPhase(dayFraction(gameNow), this.season));
    const c = this.town;
    if (c) {
      const u = c.uniforms;
      const night = windowNight(this.light);
      u.cNight.value = night;
      u.cSnow.value = this.seasonVis.snow;
      u.cAutumn.value = Math.max(0, Math.min(1, this.seasonVis.turn));
      u.cTime.value = t;
      u.cSunDir.value.copy(this.rig.sun.position).sub(this.target).normalize();
      u.cSky.value.copy((this.scene.fog as THREE.Fog).color);
      u.cSel.value = this.selected !== null ? ownerCode(this.buildings.get(this.selected)?.type ?? 'campfire') : 0;
      u.cSelGlow.value = 0.18 + Math.sin(t * 3) * 0.1;
      const fl = c.group.getObjectByName('city-flames') as THREE.Points | undefined;
      if (fl) {
        const fm = fl.material as THREE.PointsMaterial;
        fm.opacity = night;
        fl.visible = night > 0.01;
        fm.size = 3.6 * (1 + Math.sin(t * 11) * 0.08);
      }
      this.folk?.update(dt, t, night, this.seasonVis.snow);
    }
    for (const view of this.buildings.values()) {
      if (view.marker) view.marker.position.y = view.markerY + Math.sin(t * 2.2 + view.markerY) * 0.6;
    }
    if (this.selection.visible) (this.selection.material as THREE.MeshBasicMaterial).opacity = 0.55 + Math.sin(t * 3) * 0.25;
    // Автоповорот стенда (`spin`) идёт и у города: им меряют кадр на телефоне.
    if (this.spinRate !== 0) {
      this.spinTurn += this.spinRate * dt;
      this.place();
    }
    this.renderer.info.reset();
    this.renderer.shadowMap.needsUpdate = (this.frameNo++ & 1) === 0;
    this.beforeRender?.();
    this.renderer.render(this.scene, this.camera);
    this.afterRender?.();
  }

  // ---------- Постройки ----------

  override sync(s: GameState): void {
    this.gameTime = s.time;
    this.gameTimeAt = performance.now();
    this.season = seasonOf(s.time);
    if (!this.synced) {
      this.synced = true;
      this.seasonVis.jump(this.season);
    }
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
        view = { group, tier: 0, type: b.type, box: new THREE.Box3(), scaffold: null, glow: null, marker: null, markerKind: null, markerY: 0 };
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
      people: 20 + population(s) * 0.8,
      guards: 4 + armySize(s) * 0.5,
      busy: s.buildings.filter((b) => WORK_SIGN[b.type]?.smoke && workBusy(s, b, false)).map((b) => b.type),
    };
    this.folk?.set(this.crowd.people, this.crowd.guards, this.workSmoke());
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

  /** Стена — такие же коробки, как всё: её ловит луч в `pickAt`. */
  protected override pickWall(): number | null {
    return null;
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

  /**
   * Сторож плавности города опускает плотность пикселей на этот заход, но **не пишет память устройства**
   * (`gfx.rememberAutoCap`): она общая с посёлком, и тяжёлый кадр города на неделю опустил бы обычный вид
   * игрока (находка проверки, docs/city.md, 11.9). Решение по уровню города — до следующего захода.
   */
  protected override watch(gap: number): void {
    if (!this.steady || !this.settled()) return;
    const next = this.steady.feed(gap);
    if (!next) return;
    this.dprLevel = next;
    this.needSize = true;
  }

  override dispose(): void {
    this.folk?.dispose();
    this.folk = null;
    this.town?.dispose();
    this.town = null;
    super.dispose();
  }
}

// Своё место в реестре сцен (`Scene.SCENES`): игра берёт класс оттуда по виду из адреса.
Object.assign(SCENES, { city: CityScene });
