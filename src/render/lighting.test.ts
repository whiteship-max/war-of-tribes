// Время суток (docs/graphics_world.md, 9.9): у вида `next` — плавный переход, золотой час и
// солнце без скачка на рассвете; у нынешнего — прежний кадр ни на бит иначе.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { KEY_AZIMUTH, RIG, applyDayNight, createLightRig, type LightRig } from './lighting';
import { PALETTE } from './palette';
import { SeasonVisuals } from './season';

const DEG = Math.PI / 180;

function world(): { rig: LightRig; scene: THREE.Scene; season: SeasonVisuals } {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color();
  scene.fog = new THREE.Fog(0xffffff, 22, 40);
  const season = new SeasonVisuals();
  season.jump('summer');
  return { rig: createLightRig(scene, 256), scene, season };
}

/**
 * Прежняя формула дня и ночи — как была до ночи 1, построчно. Нынешний вид обязан давать
 * ровно её: тот же кадр, тот же отчёт `scene`.
 */
function before(solar: number, season: SeasonVisuals) {
  const smooth = (t: number): number => {
    const k = THREE.MathUtils.clamp(t, 0, 1);
    return k * k * (3 - 2 * k);
  };
  const look = RIG.now;
  const elev = Math.sin(solar * Math.PI * 2);
  const daylight = THREE.MathUtils.clamp((elev + 0.35) / 0.5, 0, 1);
  const dusk = THREE.MathUtils.clamp(1 - Math.abs(elev) / 0.3, 0, 1);
  const nightK = smooth(-elev / 0.15);
  const dayT = THREE.MathUtils.clamp(solar, 0, 0.5) / 0.5;
  const elevation = (12 + 40 * season.sunArc * Math.sin(dayT * Math.PI)) * DEG;
  const azimuth = KEY_AZIMUTH + (solar - 0.25) * 1.25;
  const sun = (a: number, e: number) => new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));
  const dir = sun(azimuth, elevation).lerp(sun(KEY_AZIMUTH + 0.6, look.moonElevation * DEG), nightK);
  const sunColor = season.sun.clone().lerp(new THREE.Color(PALETTE.sunDusk), dusk).lerp(new THREE.Color(look.moon), nightK);
  const hemi = new THREE.Color(look.hemiSkyNight).lerp(new THREE.Color(PALETTE.hemiSky), daylight);
  const haze = new THREE.Color(look.fogNight).lerp(season.fog, daylight).lerp(new THREE.Color(PALETTE.skyDusk), dusk * 0.45);
  const sky = new THREE.Color(look.skyNight).lerp(season.sky, daylight).lerp(new THREE.Color(PALETTE.skyDusk), dusk * 0.6);
  return { daylight, dusk, nightK, dir, intensity: look.sun.night + (look.sun.day - look.sun.night) * daylight, sunColor, hemi, haze, sky };
}

describe('время суток: нынешний вид — прежний кадр', () => {
  it('свет, полусфера, небо и дымка — ровно прежняя формула на всех часах', () => {
    const { rig, scene, season } = world();
    for (let i = 0; i < 400; i++) {
      const solar = i / 400;
      const l = applyDayNight(rig, scene, solar, season, KEY_AZIMUTH, RIG.now);
      const b = before(solar, season);
      expect(l.daylight).toBe(b.daylight);
      expect(l.nightK).toBe(b.nightK);
      expect(l.dusk).toBe(b.dusk);
      expect(l.gold ?? 0).toBe(0);
      const d = rig.sun.position.clone().normalize();
      expect(d.distanceTo(b.dir.clone().normalize())).toBeLessThan(1e-9);
      expect(rig.sun.intensity).toBe(b.intensity);
      expect(rig.sun.color.equals(b.sunColor), `солнце ${solar}`).toBe(true);
      expect(rig.hemi.color.equals(b.hemi), `полусфера ${solar}`).toBe(true);
      expect((scene.fog as THREE.Fog).color.equals(b.haze), `дымка ${solar}`).toBe(true);
      expect((scene.background as THREE.Color).equals(b.sky), `небо ${solar}`).toBe(true);
    }
  });
});

describe('время суток: новый вид', () => {
  /** Самый большой шаг лампы (угол, рад) и её силы за шаг часов по всему кругу суток. */
  function steps(look: typeof RIG.next): { angle: number; power: number; color: number; at: number } {
    const { rig, scene, season } = world();
    const N = 4000;
    let prevDir: THREE.Vector3 | null = null;
    let prevPower = 0;
    const prevColor = new THREE.Color();
    let worst = { angle: 0, power: 0, color: 0, at: 0 };
    for (let i = 0; i <= N; i++) {
      const solar = (i % N) / N;
      applyDayNight(rig, scene, solar, season, KEY_AZIMUTH, look);
      const dir = rig.sun.position.clone().normalize();
      const power = rig.sun.intensity;
      if (prevDir) {
        const angle = dir.angleTo(prevDir);
        const dc = Math.abs(rig.sun.color.r - prevColor.r) + Math.abs(rig.sun.color.g - prevColor.g) + Math.abs(rig.sun.color.b - prevColor.b);
        if (angle > worst.angle) worst = { ...worst, angle, at: solar };
        worst.power = Math.max(worst.power, Math.abs(power - prevPower));
        worst.color = Math.max(worst.color, dc);
      }
      prevDir = dir;
      prevPower = power;
      prevColor.copy(rig.sun.color);
    }
    return worst;
  }

  it('лампа не прыгает нигде на круге суток — и на рассвете тоже, где прежний вид прыгает', () => {
    // Область правила — рассвет: у прежнего вида там скачок, и тест его видит.
    const old = steps(RIG.now);
    expect(old.angle, 'прежний вид прыгает на рассвете').toBeGreaterThan(0.3);
    const next = steps(RIG.next);
    // Шаг часов — 1/4000 суток: за него солнце проходит сотые доли радиана.
    expect(next.angle, `самый большой шаг лампы (при ${next.at})`).toBeLessThan(0.02);
    expect(next.power).toBeLessThan(0.02);
    expect(next.color).toBeLessThan(0.02);
  });

  it('золотой час: у горизонта солнце золотое и теплее прежнего, в полдень — то же, что было', () => {
    const { rig, scene, season } = world();
    const warmth = (c: THREE.Color): number => c.r / c.b;
    // Солнце над горизонтом на 0.12 синуса — вечер, за полчаса до заката.
    const evening = 0.5 - Math.asin(0.12) / (2 * Math.PI);
    const l = applyDayNight(rig, scene, evening, season, KEY_AZIMUTH, RIG.next);
    expect(l.gold, 'золото есть').toBeGreaterThan(0.6);
    const goldSun = warmth(rig.sun.color);
    applyDayNight(rig, scene, evening, season, KEY_AZIMUTH, RIG.now);
    expect(goldSun).toBeGreaterThan(warmth(rig.sun.color) * 1.1);
    const noonNext = applyDayNight(rig, scene, 0.25, season, KEY_AZIMUTH, RIG.next);
    expect(noonNext.gold).toBe(0);
    const noon = rig.sun.color.clone();
    applyDayNight(rig, scene, 0.25, season, KEY_AZIMUTH, RIG.now);
    expect(noon.equals(rig.sun.color)).toBe(true);
    // Ночью золота нет.
    expect(applyDayNight(rig, scene, 0.75, season, KEY_AZIMUTH, RIG.next).gold).toBe(0);
  });
});
