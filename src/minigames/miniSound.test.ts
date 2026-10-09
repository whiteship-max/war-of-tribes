/**
 * Звук «Ягод» и «Скота»: через общий рычаг и общий контекст — и больше ни через что (docs/minigames.md, 16.2).
 *
 * Тем же образцом, что звук охоты (`huntSound.test.ts`): проверяется счётчиками, а не ухом.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { setSoundStorage, soundOn } from '@/sound/settings';
import { FieldSound, type FieldHost } from './miniSound';
import type { BeastKind } from './herd';

class Counting implements FieldHost {
  opened = 0;
  heard: string[] = [];
  open(): boolean {
    this.opened++;
    return true;
  }
  pick(ripe: number, green: number): void {
    this.heard.push(`pick:${ripe}/${green}`);
  }
  take(): void {
    this.heard.push('take');
  }
  feed(kind: BeastKind, sated: boolean): void {
    this.heard.push(`feed:${kind}${sated ? ':sated' : ''}`);
  }
  tick(): void {
    this.heard.push('tick');
  }
}

const memory = (on: boolean): void => {
  let saved: string | null = on ? '1' : '0';
  setSoundStorage({ read: () => saved, write: (v) => (saved = v) });
};

describe('звук ягод и скота молчит без жеста и при выключенном звуке', () => {
  it('без жеста молчит; после жеста — звучит, выход открыт один раз', () => {
    memory(true);
    const host = new Counting();
    const s = new FieldSound(host, soundOn);
    s.pick(5, 1);
    expect(host.heard).toEqual([]);
    s.arm();
    s.arm();
    s.pick(5, 1);
    s.take();
    s.feed('cow', true);
    s.tick();
    expect(host.opened).toBe(1);
    expect(host.heard).toEqual(['pick:5/1', 'take', 'feed:cow:sated', 'tick']);
  });

  it('выключен — жест ничего не открывает; выключили посреди игры — замолкает', () => {
    memory(false);
    const off = new Counting();
    const a = new FieldSound(off, soundOn);
    a.arm();
    a.take();
    expect(off.opened).toBe(0);
    expect(off.heard).toEqual([]);
    memory(true);
    const host = new Counting();
    const s = new FieldSound(host, soundOn);
    s.arm();
    memory(false);
    s.feed('sheep', false);
    expect(host.heard).toEqual([]);
  });
});

describe('контекст один, рычаг один', () => {
  const read = (f: string): string =>
    readFileSync(join(__dirname, f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('свой контекст не заводит и настройку не пишет', () => {
    const src = read('miniSound.ts');
    expect(src).not.toMatch(/new (window\.)?AudioContext|webkitAudioContext|new Audio\(/);
    expect(src).toMatch(/openBus\(/);
    expect(src).toContain("from '@/sound/settings'");
    expect(src).not.toMatch(/localStorage|setSoundOn/);
  });

  it('«Ягоды» и «Скот» открывают звук из «Начать» — жестом', () => {
    for (const f of ['berriesPlay.ts', 'herdPlay.ts']) expect(read(f), f).toMatch(/begin\(\): void \{[\s\S]*?\.arm\(\)/);
  });
});
