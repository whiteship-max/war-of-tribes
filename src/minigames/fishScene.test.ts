/**
 * «Рыбалка» в сцене (docs/minigames.md, раздел 17): берег у моря или у реки по клетке дома, солнце сбоку-спереди,
 * удилище у глаза (`fishRig.ts`) и звук (`fishSound.ts`) — через общий рычаг и общий контекст.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { applyDayNight, createLightRig } from '@/render/lighting';
import { SeasonVisuals } from '@/render/season';
import { DEFAULT_ON, setSoundStorage, soundOn } from '@/sound/settings';
import { SICILY } from '@/world/spawn';
import { cellOf } from '@/world/atlas/project';
import { WORLD_ORIGIN } from '@/world/data/tuning';
import { SHORE_REACH, shoreAt } from '@/ui/parts/weather';
import { SHORE_YAW, SOLAR, sunYaw } from './fishPlay';
import { CHARGED, FishRig, REST, SETTLE_S, WHIP_S, type RigInput } from './fishRig';
import { FishSound, type FishHost } from './fishSound';

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

describe('рыбалка: берег и солнце', () => {
  it('все двенадцать мест Сицилии — у моря; глубь материка — у реки', () => {
    for (const s of SICILY) expect(shoreAt(s), `${s.x},${s.y}`).toBe('sea');
    // Москва и Париж: до моря больше дня пути (`SHORE_REACH`).
    for (const [lon, lat] of [
      [37.62, 55.75],
      [2.35, 48.86],
    ] as const) {
      const c = cellOf(lon, lat);
      expect(shoreAt({ x: Math.floor(c.col) + WORLD_ORIGIN.x, y: Math.floor(c.row) + WORLD_ORIGIN.y }), `${lon},${lat}`).toBe('river');
    }
    expect(SHORE_REACH).toBeGreaterThan(0);
  });

  it('рыскание солнца — то же, что ставит риг света в час промысла; берег повёрнут так, что солнце слева-спереди', () => {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color();
    const rig = createLightRig(scene);
    applyDayNight(rig, scene, SOLAR, new SeasonVisuals());
    const p = rig.sun.position;
    const yaw = Math.atan2(-p.x, -p.z);
    expect(Math.abs(wrap(yaw - sunYaw(SOLAR)))).toBeLessThan(1e-9);
    const left = wrap(sunYaw(SOLAR) - SHORE_YAW);
    expect(left).toBeGreaterThan(0.3);
    expect(left).toBeLessThan(Math.PI / 2);
  });
});

/** Удилище у глаза: несколько кадров рига с одним вводом. */
function runRig(rig: FishRig, input: Partial<RigInput>, seconds: number, from = 0): number {
  let now = from;
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) {
    now += dt;
    rig.update({ now, dt, phase: 'idle', power: 0, tension: 0, reeling: false, rod: 0, pull: null, paid: 0, ...input });
  }
  return now;
}

/** Точка в осях камеры — на экране телефона 390×844 с углом обзора 72°? */
function onScreen(p: THREE.Vector3): boolean {
  const cam = new THREE.PerspectiveCamera(72, 390 / 844, 0.05, 100);
  cam.updateMatrixWorld();
  const q = p.clone().project(cam);
  return p.z < 0 && Math.abs(q.x) <= 1 && Math.abs(q.y) <= 1;
}

describe('рыбалка: удилище у глаза', () => {
  it('в покое хлыст — в кадре телефона, выше середины', () => {
    const rig = new FishRig();
    runRig(rig, {}, 1);
    expect(onScreen(rig.tip)).toBe(true);
    expect(rig.tip.y).toBeGreaterThan(0);
  });

  it('полный замах уводит хлыст за плечо: выше и позади глаза', () => {
    const rig = new FishRig();
    runRig(rig, { phase: 'charge', power: 1 }, 1);
    expect(CHARGED.elev).toBeGreaterThan(Math.PI / 2);
    expect(rig.tip.z).toBeGreaterThan(0);
    expect(rig.tip.y).toBeGreaterThan(1);
  });

  it('хлёст: за `WHIP_S` хлыст уходит вперёд ниже покоя, за `SETTLE_S` возвращается', () => {
    const rig = new FishRig();
    const now = runRig(rig, { phase: 'charge', power: 1 }, 1);
    const restRig = new FishRig();
    runRig(restRig, {}, 1);
    const at = runRig(rig, { phase: 'flight' }, WHIP_S, now);
    expect(rig.tip.y, 'на хлёсте хлыст ниже покоя').toBeLessThan(restRig.tip.y);
    runRig(rig, { phase: 'wait' }, SETTLE_S + 0.6, at);
    expect(rig.tip.distanceTo(restRig.tip)).toBeLessThan(0.15);
    expect(REST.elev).toBeLessThan(CHARGED.elev);
  });

  it('удилище гнётся к леске: чем сильнее натяжение, тем ближе хлыст к направлению лески', () => {
    const pull = new THREE.Vector3(0.6, -0.5, -1).normalize();
    const angleOf = (tension: number): number => {
      const rig = new FishRig();
      runRig(rig, { phase: 'fight', tension, reeling: true, pull }, 1);
      const butt = new THREE.Vector3(...REST.butt);
      return rig.tip.clone().sub(butt).normalize().angleTo(pull);
    };
    const slack = angleOf(0.1);
    const taut = angleOf(0.95);
    expect(taut).toBeLessThan(slack - 0.15);
  });
});

/** Среда звука, которая только считает. */
class Counting implements FishHost {
  opened = 0;
  heard: string[] = [];
  open(): boolean {
    this.opened++;
    return true;
  }
  bed(): void {
    this.heard.push('bed');
  }
  stop(): void {
    this.heard.push('stop');
  }
  swish(): void {
    this.heard.push('swish');
  }
  plop(): void {
    this.heard.push('plop');
  }
  nibble(): void {
    this.heard.push('nibble');
  }
  click(drag: boolean): void {
    this.heard.push(drag ? 'drag' : 'click');
  }
  strain(): void {
    this.heard.push('strain');
  }
  snap(): void {
    this.heard.push('snap');
  }
  creak(): void {
    this.heard.push('creak');
  }
  tick(): void {
    this.heard.push('tick');
  }
  caught(): void {
    this.heard.push('caught');
  }
}

const memory = (on: boolean | null): void => {
  let saved: string | null = on === null ? null : on ? '1' : '0';
  setSoundStorage({ read: () => saved, write: (v) => (saved = v) });
};

const EAR = { x: 0, z: 0, rx: 1, rz: 0 };

describe('звук рыбалки молчит без жеста и при выключенном звуке', () => {
  it('у нового игрока — умолчание игры: звук только после «Начать» и только при включённом умолчании', () => {
    memory(null);
    const host = new Counting();
    const s = new FishSound(host, soundOn);
    s.swish(1);
    expect(host.heard).toEqual([]);
    s.arm(false, 0);
    s.swish(1);
    expect(host.opened).toBe(DEFAULT_ON ? 1 : 0);
    expect(host.heard.length > 0).toBe(DEFAULT_ON);
  });

  it('после жеста — звучит, выход открыт один раз, вода пущена; выход из игры — вода замолкает', () => {
    memory(true);
    const host = new Counting();
    const s = new FishSound(host, soundOn);
    s.plop(0.3, EAR, 0, -5);
    expect(host.heard).toEqual([]);
    s.arm(true, 0.5);
    s.arm(true, 0.5);
    s.swish(0.7);
    s.plop(0.3, EAR, 0, -5);
    s.nibble(EAR, 0, -5);
    s.click(true);
    s.click(false);
    s.strain(0.9);
    s.snap();
    s.creak();
    s.tick();
    s.caught(true);
    expect(host.opened).toBe(1);
    expect(host.heard).toEqual(['bed', 'swish', 'plop', 'nibble', 'drag', 'click', 'strain', 'snap', 'creak', 'tick', 'caught']);
    s.stop();
    s.swish(1);
    expect(host.heard.slice(-1)).toEqual(['stop']);
  });

  it('выключили посреди рыбалки — замолкает на следующем звуке', () => {
    memory(true);
    const host = new Counting();
    const s = new FishSound(host, soundOn);
    s.arm(false, 0);
    memory(false);
    s.swish(1);
    s.click(true);
    s.caught(false);
    expect(host.heard).toEqual(['bed']);
  });

  it('свой контекст не заводит и настройку не пишет; открывает звук «Начать» — жестом', () => {
    const read = (f: string): string =>
      readFileSync(join(__dirname, f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
    const src = read('fishSound.ts');
    expect(src).not.toMatch(/new (window\.)?AudioContext|webkitAudioContext|new Audio\(/);
    expect(src).toMatch(/openBus\(/);
    expect(src).not.toMatch(/localStorage|setSoundOn/);
    expect(read('fishPlay.ts')).toMatch(/begin\(\): void \{[\s\S]*?\.arm\(/);
  });
});
