/**
 * Звук «Охоты»: через общий рычаг и общий контекст — и больше ни через что (docs/minigames.md, 13).
 *
 * Проверяется счётчиками, а не ухом, как вой (`sound/howl.test.ts`): тишина одинакова, открыт контекст или нет, а
 * открытый контекст на iOS — аппаратный поток.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { setSoundStorage, soundOn } from '@/sound/settings';
import { HUNT_NEAR, HuntSound, placeSound, type HuntHost, type ThudKind } from './huntSound';

/** Среда, которая только считает. */
class Counting implements HuntHost {
  opened = 0;
  heard: string[] = [];
  open(): boolean {
    this.opened++;
    return true;
  }
  twang(): void {
    this.heard.push('twang');
  }
  whistle(): void {
    this.heard.push('whistle');
  }
  thud(kind: ThudKind): void {
    this.heard.push(`thud:${kind}`);
  }
  hoof(): void {
    this.heard.push('hoof');
  }
}

const memory = (on: boolean | null): void => {
  let saved: string | null = on === null ? null : on ? '1' : '0';
  setSoundStorage({ read: () => saved, write: (v) => (saved = v) });
};

const EAR = { x: 0, z: 0, rx: 1, rz: 0 };

describe('звук охоты молчит, пока игрок сам не включил звук', () => {
  it('у нового игрока — ни контекста, ни звука, даже после «Начать»', () => {
    memory(null);
    const host = new Counting();
    const s = new HuntSound(host, soundOn);
    s.arm();
    s.twang(1);
    s.thud('ground', EAR, 1, 1);
    expect(host.opened).toBe(0);
    expect(host.heard).toEqual([]);
  });

  it('без жеста молчит и при включённом звуке; после жеста — звучит, и выход открыт один раз', () => {
    memory(true);
    const host = new Counting();
    const s = new HuntSound(host, soundOn);
    s.twang(1);
    expect(host.heard).toEqual([]);
    s.arm();
    s.arm();
    s.twang(1);
    s.whistle(0.8, EAR, 10, 0);
    s.thud('wood', EAR, 3, 0);
    s.hoof(EAR, 5, 0);
    expect(host.opened).toBe(1);
    expect(host.heard).toEqual(['twang', 'whistle', 'thud:wood', 'hoof']);
  });

  it('выключили посреди охоты — замолкает на следующем звуке', () => {
    memory(true);
    const host = new Counting();
    const s = new HuntSound(host, soundOn);
    s.arm();
    memory(false);
    s.twang(1);
    expect(host.heard).toEqual([]);
  });
});

describe('громкость — по уху охотника', () => {
  it('вблизи в полную силу, вдали тише обратно расстоянию; справа — в правое ухо', () => {
    expect(placeSound(EAR, 0, 3).gain).toBe(1);
    expect(placeSound(EAR, 0, HUNT_NEAR * 4).gain).toBeCloseTo(0.25, 9);
    expect(placeSound(EAR, 10, 0).pan).toBeGreaterThan(0);
    expect(placeSound(EAR, -10, 0).pan).toBeLessThan(0);
    expect(placeSound(EAR, 0, 0).pan).toBe(0);
  });
});

describe('контекст один, рычаг один', () => {
  const read = (f: string): string =>
    readFileSync(join(__dirname, f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('свой контекст не заводит и настройку не пишет: выход — у движка (`openBus`), рычаг — общий', () => {
    const src = read('huntSound.ts');
    expect(src).not.toMatch(/new (window\.)?AudioContext|webkitAudioContext|new Audio\(/);
    expect(src).toMatch(/openBus\(/);
    expect(src).toContain("from '@/sound/settings'");
    expect(src).not.toMatch(/localStorage|setSoundOn/);
  });

  it('сцена открывает звук из «Начать» — жестом', () => {
    expect(read('huntPlay.ts')).toMatch(/begin\(\): void \{[\s\S]*?\.arm\(\)/);
    expect(read('stage.ts')).toMatch(/begin\(\): void \{[\s\S]*?this\.play\.begin\?\.\(\)/);
  });
});
