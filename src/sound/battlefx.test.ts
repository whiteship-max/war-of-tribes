// Звуки боя ролика TW (docs/battle_tw.md, «Звук»): без жеста молчат, при выключенном звуке ничего не открывают, «тише»
// глушит без записи настройки, ближе — громче, на низком уровне — проще.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BattleFx, FX_NEAR, FX_PER_FRAME, place, type FxBed, type FxCue, type FxHost } from './battlefx';

class Counting implements FxHost {
  opened = 0;
  cues: { c: FxCue; gain: number; pan: number }[] = [];
  beds: FxBed[] = [];
  constructor(private can = true) {}
  open(): boolean {
    this.opened += 1;
    return this.can;
  }
  cue(c: FxCue, gain: number, pan: number): void {
    this.cues.push({ c, gain, pan });
  }
  bed(b: FxBed): void {
    this.beds.push(b);
  }
  stop(): void {}
}

const cue = (kind: FxCue['kind'], x = 0, z = 0): FxCue => ({ kind, x, z, x2: x, z2: z, dur: 1.7, size: 1, ours: true, seed: 1 });
const amb = { fight: [{ x: 0, z: 0, n: 40 }, { x: 0, z: 0, n: 0 }, { x: 0, z: 0, n: 0 }], gallop: { x: 0, z: 0, n: 0 }, roar: 0.3, standing: 600 };
const ear = { x: 0, y: 10, z: -10, rx: 1, rz: 0 };

describe('звуки боя', () => {
  it('без открытия не звучит ничего, и до жеста ничего не открывается', () => {
    const host = new Counting();
    const fx = new BattleFx(host, () => true);
    fx.frame([cue('crash')], amb, ear, 0.016);
    expect(host.opened).toBe(0);
    expect(host.cues.length + host.beds.length).toBe(0);
    fx.arm();
    fx.arm();
    expect(host.opened, 'открытие одно на все жесты').toBe(1);
    fx.frame([cue('crash')], amb, ear, 0.016);
    expect(host.cues.length).toBe(1);
  });

  it('при выключенном звуке ничего не открывает и не звучит', () => {
    const host = new Counting();
    const fx = new BattleFx(host, () => false);
    fx.arm();
    fx.frame([cue('horn')], amb, ear, 0.016);
    expect(host.opened).toBe(0);
    expect(host.cues.length + host.beds.length).toBe(0);
  });

  it('«тише» глушит и звуки, и гул — до снятия', () => {
    const host = new Counting();
    const fx = new BattleFx(host, () => true);
    fx.arm();
    fx.setMuted(true);
    fx.frame([cue('crash'), cue('horn')], amb, ear, 0.016);
    expect(host.cues.length).toBe(0);
    expect(host.beds.every((b) => b.roar === 0 && b.clash === 0 && b.hooves === 0)).toBe(true);
    fx.setMuted(false);
    fx.frame([cue('crash')], amb, ear, 0.016);
    expect(host.cues.length).toBe(1);
    expect(host.beds[host.beds.length - 1].roar).toBeGreaterThan(0);
  });

  it('ближе — громче, сбоку — в своё ухо', () => {
    const at = (d: number): number => place({ x: 0, y: 1, z: 0, rx: 1, rz: 0 }, 0, d).gain;
    // Граница области: до `FX_NEAR` — полная сила, дальше убывает.
    expect(at(FX_NEAR / 2)).toBe(1);
    let last = 1;
    for (const d of [FX_NEAR * 1.5, FX_NEAR * 3, FX_NEAR * 6]) {
      expect(at(d)).toBeLessThan(last);
      last = at(d);
    }
    expect(place({ x: 0, y: 1, z: 0, rx: 1, rz: 0 }, 20, 0).pan).toBeGreaterThan(0);
    expect(place({ x: 0, y: 1, z: 0, rx: 1, rz: 0 }, -20, 0).pan).toBeLessThan(0);
  });

  it('рог слышен через всё поле, грохот вдали — тише', () => {
    const host = new Counting();
    const fx = new BattleFx(host, () => true);
    fx.arm();
    const far = { x: 0, y: 30, z: -300, rx: 1, rz: 0 };
    fx.frame([cue('horn'), cue('crash')], amb, far, 0.016);
    const horn = host.cues.find((c) => c.c.kind === 'horn');
    const crash = host.cues.find((c) => c.c.kind === 'crash');
    expect(horn?.gain).toBeGreaterThanOrEqual(0.45);
    expect(crash?.gain ?? 0).toBeLessThan(horn!.gain);
  });

  it('на низком уровне проще: без свиста и стука стрел, звуков за кадр меньше', () => {
    const many = [cue('whistle'), cue('thud'), ...Array.from({ length: 10 }, () => cue('bows'))];
    const lite = new Counting();
    const a = new BattleFx(lite, () => true, true);
    a.arm();
    a.frame(many, amb, ear, 0.016);
    expect(lite.cues.some((c) => c.c.kind === 'whistle' || c.c.kind === 'thud')).toBe(false);
    expect(lite.cues.length).toBe(FX_PER_FRAME.lite);
    const full = new Counting();
    const b = new BattleFx(full, () => true, false);
    b.arm();
    b.frame(many, amb, ear, 0.016);
    expect(full.cues.length).toBe(FX_PER_FRAME.full);
    expect(full.cues.some((c) => c.c.kind === 'whistle')).toBe(true);
  });

  it('свой контекст не заводит и настройку не пишет: выход — у движка (`openBus`)', () => {
    const src = readFileSync(join(__dirname, 'battlefx.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(src).not.toMatch(/new (window\.)?AudioContext|webkitAudioContext|new Audio\(/);
    expect(src).not.toContain('setSoundOn');
    expect(src).toMatch(/openBus\(/);
    // Чужих файлов нет: звук синтезируется, ни адреса, ни загрузки.
    expect(src).not.toMatch(/fetch\(|\.mp3|\.ogg|\.wav/);
  });
});
