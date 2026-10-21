// Звук сценок жителей (docs/city_v3.md, ЖГ-2): слышно только вблизи, у каждой сценки — свой узор, тише трактира.
import { describe, expect, it } from 'vitest';
import { SKIT_IDS } from '@/render/city/skits';
import type { HeardSkit } from '../ear';
import { AMB_MIX } from './ambience';
import { SKIT_MIX, SkitSounds } from './skits';
import { seeded } from './rng';
import type { Kit } from './synth';

/** Поддельный контекст: узлы глотают всё, источники (генераторы и буферы) считаются; громкости пиков — записываются. */
function fakeKit(): { kit: Kit; sources: () => number; peaks: number[] } {
  let sources = 0;
  const peaks: number[] = [];
  // Громкость — только у усилителей (`gain`): частоты и добротности фильтров — не громкость.
  const param = (loud: boolean): Record<string, unknown> => {
    const p: Record<string, unknown> = { value: 0 };
    for (const k of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'setTargetAtTime']) {
      p[k] = (v: number) => {
        if (loud) peaks.push(v);
        return p;
      };
    }
    return p;
  };
  const node = (gain = false): unknown =>
    new Proxy({} as Record<string | symbol, unknown>, {
      get(t, k) {
        if (k in t) return t[k];
        if (k === 'connect' || k === 'disconnect' || k === 'start' || k === 'stop') return () => undefined;
        if (k === 'type' || k === 'buffer' || k === 'loop') return undefined;
        t[k] = param(gain && k === 'gain');
        return t[k];
      },
      set(t, k, v) {
        t[k] = v;
        return true;
      },
    });
  const ctx = {
    sampleRate: 22050,
    createOscillator: () => (sources++, node()),
    createBufferSource: () => (sources++, node()),
    createGain: () => node(true),
    createBiquadFilter: () => node(),
    createStereoPanner: () => node(),
    createBuffer: (_c: number, n: number) => ({ length: n, duration: n / 22050, getChannelData: () => new Float32Array(n) }),
  } as unknown as BaseAudioContext;
  const buf = { duration: 2 } as AudioBuffer;
  const kit: Kit = { ctx, rnd: seeded(5), lite: false, white: buf, brown: buf, plucks: new Map(), space: null };
  return { kit, sources: () => sources, peaks };
}

const heard = (id: string, gain: number, k = 0.3): HeardSkit => ({ id, gain, pan: 0, k });

describe('звук сценок жителей', () => {
  it('у каждой сценки свой звук вблизи; издали и без сценок — тишина', () => {
    for (const id of SKIT_IDS) {
      const f = fakeKit();
      const s = new SkitSounds(f.kit, {} as AudioNode);
      for (let t = 0; t < 20; t += 0.25) s.tick(t, t + 0.25, [heard(id, 1, (t / 20) * 0.9)]);
      expect(f.sources(), `${id} вблизи звучит`).toBeGreaterThan(0);
      const quiet = fakeKit();
      const q = new SkitSounds(quiet.kit, {} as AudioNode);
      // Граница: громкость ниже порога слышимости — край слышимости, дальше `SKIT_HEAR.far` (вид даёт 0).
      for (let t = 0; t < 20; t += 0.25) q.tick(t, t + 0.25, [heard(id, 0.01)]);
      expect(quiet.sources(), `${id} издали молчит`).toBe(0);
    }
    const none = fakeKit();
    new SkitSounds(none.kit, {} as AudioNode).tick(0, 30, []);
    expect(none.sources()).toBe(0);
  });

  it('ближе — громче: пики сценки растут с близостью', () => {
    const loud = (gain: number): number => {
      const f = fakeKit();
      const s = new SkitSounds(f.kit, {} as AudioNode);
      for (let t = 0; t < 12; t += 0.25) s.tick(t, t + 0.25, [heard('preacher', gain)]);
      return Math.max(...f.peaks);
    };
    expect(loud(1)).toBeGreaterThan(loud(0.4) * 1.8);
  });

  it('сценки тише трактира и рынка: подробность вблизи, а не новый слой фона', () => {
    for (const id of SKIT_IDS) {
      expect(SKIT_MIX[id], id).toBeGreaterThan(0);
      expect(SKIT_MIX[id], id).toBeLessThanOrEqual(AMB_MIX.tavern);
    }
  });
});
