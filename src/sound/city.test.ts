// Дверь звука города: без жеста и при выключенном звуке — ничего; кусок — после касания и мимо первой загрузки;
// громкости музыки и звуков помнятся; глушат город ролик боя, промысел и предыстория (docs/audio.md, раздел 8).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const opened: string[] = [];
let woke = 0;
vi.mock('./web', () => ({
  openBus: (_v: number, kind: string) => {
    opened.push(kind);
    return { disconnect: () => undefined };
  },
  wakeSound: () => {
    woke++;
    return true;
  },
}));
const started: unknown[] = [];
const ducks: unknown[] = [];
vi.mock('./epoch', () => ({
  startEpoch: (out: unknown) => {
    started.push(out);
    return { duck: (d: unknown) => ducks.push(d), cue: () => undefined, stop: () => undefined };
  },
}));

const { cityAudio } = await import('./city');
const settings = await import('./settings');

const SRC = join(__dirname, '..');
const read = (f: string): string =>
  readFileSync(join(SRC, f), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

function memory(on: boolean | null): void {
  let value: string | null = on === null ? null : on ? '1' : '0';
  settings.setSoundStorage({ read: () => value, write: (v) => (value = v) });
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

describe('звук города: жест, рычаг и докачка', () => {
  beforeEach(() => {
    cityAudio.toggle(false);
    opened.length = 0;
    started.length = 0;
    ducks.length = 0;
    woke = 0;
  });

  it('у нового игрока звук выключен: касание не открывает контекста и не качает кусок', async () => {
    memory(null);
    cityAudio.arm();
    cityAudio.arm();
    await flush();
    expect(opened).toEqual([]);
    expect(started).toEqual([]);
    expect(woke).toBe(0);
  });

  it('звук включён: первое касание открывает два выхода — музыки и звуков — и поднимает кусок один раз', async () => {
    memory(true);
    cityAudio.arm();
    cityAudio.arm();
    await flush();
    cityAudio.arm();
    expect(opened).toEqual(['music', 'fx']);
    expect(started.length).toBe(1);
    // Следующие касания только будят уснувший контекст.
    expect(woke).toBe(2);
  });

  it('выключение гасит город, включение — тот же жест', async () => {
    memory(true);
    cityAudio.arm();
    await flush();
    cityAudio.toggle(false);
    cityAudio.toggle(true);
    await flush();
    expect(started.length).toBe(2);
  });

  it('ролик боя, промысел и предыстория глушат; глушение берёт самое тихое и снимается само', async () => {
    memory(true);
    cityAudio.arm();
    await flush();
    cityAudio.hush('battle', true);
    cityAudio.hush('mini', true);
    cityAudio.hush('mini', true);
    cityAudio.hush('battle', false);
    cityAudio.hush('mini', false);
    expect(ducks).toEqual([
      { music: 1, amb: 1 },
      { music: 0.12, amb: 0.25 },
      { music: 0.12, amb: 0.2 },
      { music: 0.15, amb: 0.2 },
      { music: 1, amb: 1 },
    ]);
  });
});

describe('громкость музыки и звуков', () => {
  it('умолчания негромкие, запись помнится и держится в 0..1, испорченная — умолчание', () => {
    const store = new Map<string, string>();
    settings.setLevelStorage({ read: (k) => store.get(k) ?? null, write: (k, v) => void store.set(k, v) });
    expect(settings.soundLevel('music')).toBe(settings.SOUND_LEVEL_DEFAULT.music);
    expect(settings.soundLevel('fx')).toBe(settings.SOUND_LEVEL_DEFAULT.fx);
    settings.setSoundLevel('music', 0.25);
    settings.setSoundLevel('fx', 7);
    expect(settings.soundLevel('music')).toBe(0.25);
    expect(settings.soundLevel('fx')).toBe(1);
    store.set('tribe.sound.music', 'громко');
    expect(settings.soundLevel('music')).toBe(settings.SOUND_LEVEL_DEFAULT.music);
  });

  it('пишет громкость только раздел настроек — как и рычаг', () => {
    const files = ['App.tsx', 'ui/battle/TwReplay.tsx', 'ui/next/Alerts.tsx', 'sound/city.ts', 'sound/web.ts', 'sound/epoch/index.ts'];
    for (const f of files) expect(read(f), f).not.toContain('setSoundLevel');
    expect(read('ui/parts/Settings.tsx')).toContain('setSoundLevel');
  });
});

describe('устройство: кусок звука мимо первой загрузки, контекст один', () => {
  it('дверь тянет кусок только динамическим импортом, а типы — только как типы', () => {
    const src = read('sound/city.ts');
    expect(src).toMatch(/import\('\.\/epoch'\)/);
    expect(src).not.toMatch(/^import \{[^}]*\} from '\.\/epoch/m);
    const vite = readFileSync(join(SRC, '..', 'vite.config.ts'), 'utf8');
    expect(vite).toContain("name: 'звук города'");
  });

  it('в куске звука нет своего контекста и нет файлов: всё — синтез на выходах движка', () => {
    for (const f of ['ambience.ts', 'compose.ts', 'index.ts', 'music.ts', 'rng.ts', 'synth.ts']) {
      const code = read(`sound/epoch/${f}`);
      expect(code, f).not.toMatch(/new (webkit)?AudioContext|new Audio\(|fetch\(/);
      expect(code, f).not.toMatch(/\.(mp3|ogg|wav|m4a)['"]/);
    }
  });

  it('касание в интерфейсе — жест, кнопка — тихий щелчок; ролик боя глушит город и отпускает', () => {
    const app = read('App.tsx');
    expect(app).toMatch(/addEventListener\('pointerdown', wake/);
    expect(app).toMatch(/cityAudio\.arm\(\)/);
    expect(app).toMatch(/cityAudio\.cue\('tap'\)/);
    const tw = read('ui/battle/TwReplay.tsx');
    expect(tw).toMatch(/cityAudio\.hush\('battle', true\)/);
    expect(tw).toMatch(/cityAudio\.hush\('battle', false\)/);
  });

  it('пауза в фоне — у движка, тем же сводом сигналов, что у двери кадра', () => {
    const web = read('sound/web.ts');
    expect(web).toMatch(/watchAway\(/);
    expect(web).toMatch(/suspend\(\)/);
    expect(web).toMatch(/resume\(\)/);
  });
});
