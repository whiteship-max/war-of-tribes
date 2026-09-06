// Музыка деревни: круг дорожек.
//
// Проверяется здесь не то, как она звучит, а обещания, каждое из которых стоит
// денег или доверия игрока: без жеста ничего не качается, выключенный звук не
// качает вовсе, качается ровно одна дорожка за раз и не раньше конца текущей,
// одна пьеса не идёт дважды подряд, ролик о бое её глушит и возвращает.
//
// Всё это видно только по вызовам и по часам, поэтому подменены и среда, и
// часы: настоящий `setTimeout` проверял бы vitest, а не музыку.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { VillageMusic, type Timer, type VillageHost } from './village';
import { VILLAGE_FADE, VILLAGE_LEAD, VILLAGE_TRACKS, villageUrl } from './manifest';
import { setSoundStorage, soundOn } from './settings';

const SRC = join(__dirname, '..');

const last = <T,>(items: T[]): T | undefined => items[items.length - 1];

/** Среда, которая ничего не умеет, зато считает, о чём её просили. */
class Counting implements VillageHost {
  opened = 0;
  loaded: string[] = [];
  played: string[] = [];
  dropped: string[] = [];
  volumes: number[] = [];
  stopped = 0;
  /** Сколько загрузок идёт прямо сейчас и сколько их было разом за всё время. */
  inFlight = 0;
  peakInFlight = 0;
  private pending: (() => void)[] = [];

  /** `seconds` — длина каждой дорожки; 0 означает «файла нет». */
  constructor(
    private seconds = 100,
    private slow = false,
  ) {}

  open(): boolean {
    this.opened++;
    return true;
  }

  async load(id: string, url: string): Promise<number> {
    this.loaded.push(url);
    this.inFlight++;
    this.peakInFlight = Math.max(this.peakInFlight, this.inFlight);
    if (this.slow) {
      await new Promise<void>((resolve) => this.pending.push(resolve));
    }
    this.inFlight--;
    return this.seconds;
  }

  /** Отпустить зависшую загрузку — так проверяется медленная сеть. */
  async deliver(): Promise<void> {
    const waiting = this.pending;
    this.pending = [];
    for (const resolve of waiting) resolve();
    await flush();
  }

  play(id: string): void {
    this.played.push(id);
  }

  drop(id: string): void {
    this.dropped.push(id);
  }

  volume(level: number): void {
    this.volumes.push(level);
  }

  stop(): void {
    this.stopped++;
  }
}

/** Часы, которые стоят, пока их не двинут. */
class FakeTimer implements Timer {
  private next = 1;
  private due = new Map<number, { at: number; fn: () => void }>();
  now = 0;

  after(seconds: number, fn: () => void): number {
    const handle = this.next++;
    this.due.set(handle, { at: this.now + seconds, fn });
    return handle;
  }

  cancel(handle: number): void {
    this.due.delete(handle);
  }

  /** Прокрутить часы вперёд, выполняя всё, чему настал срок. */
  async advance(seconds: number): Promise<void> {
    const until = this.now + seconds;
    for (;;) {
      const ready = [...this.due.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at);
      if (ready.length === 0) break;
      const [handle, task] = ready[0];
      this.due.delete(handle);
      this.now = task.at;
      task.fn();
      await flush();
    }
    this.now = until;
  }
}

/** Дать промисам догореть: загрузка асинхронная даже там, где мгновенная. */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
};

/** Настройка в памяти: localStorage в тестах нет. */
function memory(on: boolean): void {
  let value: string | null = on ? '1' : '0';
  setSoundStorage({
    read: () => value,
    write: (v) => {
      value = v;
    },
  });
}

/** Предсказуемый «случайный»: перемешивание обязано быть проверяемым. */
function rolls(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

const start = async (host: Counting, timer = new FakeTimer(), rnd = Math.random) => {
  const music = new VillageMusic(host, timer, soundOn, rnd);
  music.arm();
  await flush();
  return { music, timer };
};

describe('без жеста игрока музыка деревни не запускается', () => {
  it('до жеста не открыт контекст и не начата ни одна загрузка', async () => {
    memory(true);
    const host = new Counting();
    const music = new VillageMusic(host, new FakeTimer(), soundOn);
    // Игра идёт, деревня на экране — но игрок ещё ничего не нажал.
    await flush();
    expect(host.opened).toBe(0);
    expect(host.loaded).toEqual([]);
    expect(music.ready).toBe(false);
    expect(music.state()).toBe('idle');
  });

  it('после жеста контекст открывается ровно один раз', async () => {
    memory(true);
    const host = new Counting();
    const { music } = await start(host);
    music.arm();
    music.arm();
    expect(host.opened).toBe(1);
    expect(music.ready).toBe(true);
    expect(music.state()).toBe('playing');
  });

  it('жест ловится любым нажатием в интерфейсе, а не отдельной кнопкой', () => {
    // У деревни нет своего переключателя: она играет с первой секунды партии,
    // и ждать от игрока «включить музыку» неоткуда.
    const app = readFileSync(join(SRC, 'App.tsx'), 'utf8');
    expect(app).toMatch(/addEventListener\('pointerdown'/);
    expect(app).toMatch(/villageMusic\.arm\(\)/);
  });
});

describe('выключенный звук не грузит файлов', () => {
  it('ни одной загрузки и ни одного контекста', async () => {
    memory(false);
    const host = new Counting();
    const { music } = await start(host);
    expect(host.opened).toBe(0);
    expect(host.loaded).toEqual([]);
    expect(music.state()).toBe('off');
  });

  it('включение — тоже жест, и грузит уже оно', async () => {
    memory(false);
    const host = new Counting();
    const music = new VillageMusic(host, new FakeTimer(), soundOn);
    music.arm();
    await flush();
    expect(host.loaded).toEqual([]);
    memory(true);
    music.toggle(true);
    await flush();
    expect(host.opened).toBe(1);
    expect(host.loaded.length).toBe(1);
  });
});

describe('качается ровно одна дорожка за раз', () => {
  it('к началу игры скачана одна, а не весь круг', async () => {
    memory(true);
    const host = new Counting();
    await start(host);
    expect(host.loaded.length).toBe(1);
    expect(host.played.length).toBe(1);
    expect(host.peakInFlight).toBe(1);
  });

  it('следующая тянется к концу текущей, а не раньше', async () => {
    memory(true);
    const host = new Counting(100);
    const { timer } = await start(host);
    // Дорожка идёт сотню секунд, тянуть следующую положено за двенадцать до
    // конца. На восемьдесят седьмой секунде запросов по-прежнему один.
    await timer.advance(100 - VILLAGE_LEAD - 1);
    expect(host.loaded.length).toBe(1);
    await timer.advance(2);
    expect(host.loaded.length).toBe(2);
    // И вторая дорожка ещё не играет: тянули заранее, а не переключались.
    expect(host.played.length).toBe(1);
  });

  it('перелив идёт до конца дорожки, а не после паузы', async () => {
    memory(true);
    const host = new Counting(100);
    const { timer } = await start(host);
    await timer.advance(100 - VILLAGE_FADE - 1);
    expect(host.played.length).toBe(1);
    await timer.advance(2);
    expect(host.played.length).toBe(2);
    // Отыгравшая отпущена — в памяти держим играющую и следующую, не больше.
    expect(host.dropped).toEqual([host.played[0]]);
  });

  it('за весь круг ни одной пары загрузок разом', async () => {
    memory(true);
    const host = new Counting(60);
    const { timer } = await start(host);
    await timer.advance(60 * 12);
    expect(host.played.length).toBeGreaterThan(8);
    expect(host.peakInFlight).toBe(1);
  });

  it('медленная сеть не рвёт круг: дорожка встанет с паузой, а не пропадёт', async () => {
    memory(true);
    const host = new Counting(60, true);
    const { timer } = await start(host);
    await host.deliver();
    expect(host.played.length).toBe(1);
    // Дорожка кончилась, а сеть ещё не отдала следующую.
    await timer.advance(60);
    expect(host.played.length).toBe(1);
    expect(host.peakInFlight).toBe(1);
    // Отдала — играет сразу, без второго запроса.
    const asked = host.loaded.length;
    await host.deliver();
    expect(host.played.length).toBe(2);
    expect(host.loaded.length).toBe(asked);
  });
});

describe('круг перемешан, но одна пьеса не идёт дважды подряд', () => {
  it('за длинный круг соседи ни разу не совпали', async () => {
    memory(true);
    const host = new Counting(50);
    const { timer } = await start(host, new FakeTimer(), rolls([0.9, 0.1, 0.55, 0.3, 0.77, 0.42]));
    await timer.advance(50 * 40);
    expect(host.played.length).toBeGreaterThan(30);
    for (let i = 1; i < host.played.length; i++) {
      expect(host.played[i], `${host.played[i]} дважды подряд`).not.toBe(host.played[i - 1]);
    }
  });

  it('стык кругов тоже стык: последняя прошлого не открывает следующий', async () => {
    memory(true);
    // Перемешивание, которое всегда возвращает порядок как есть: тогда круг
    // замкнётся сам на себя, и защита от повтора — единственное, что мешает
    // последней дорожке пойти дважды.
    const host = new Counting(50);
    const { timer } = await start(host, new FakeTimer(), () => 0.999999);
    await timer.advance(50 * (VILLAGE_TRACKS.length * 3));
    for (let i = 1; i < host.played.length; i++) {
      expect(host.played[i]).not.toBe(host.played[i - 1]);
    }
  });

  it('порядок именно перемешан, а не всегда один', async () => {
    memory(true);
    const first = new Counting(50);
    const second = new Counting(50);
    const a = await start(first, new FakeTimer(), rolls([0.1, 0.9, 0.4, 0.7]));
    const b = await start(second, new FakeTimer(), rolls([0.8, 0.2, 0.95, 0.35]));
    await a.timer.advance(50 * 8);
    await b.timer.advance(50 * 8);
    expect(second.played).not.toEqual(first.played);
  });
});

describe('ролик о бое глушит деревню и возвращает её', () => {
  it('заглушена на ролике, вернулась после, и это не стоило загрузки', async () => {
    memory(true);
    const host = new Counting(100);
    const { music, timer } = await start(host);
    const asked = host.loaded.length;
    music.duck(true);
    expect(last(host.volumes)).toBe(0);
    // Круг идёт под роликом: заглушить — не остановить.
    await timer.advance(100);
    expect(host.played.length).toBe(2);
    music.duck(false);
    expect(last(host.volumes)).toBe(1);
    // Возврат не стоил ни одного лишнего запроса сверх обычного круга.
    expect(host.loaded.length).toBe(asked + 1);
  });

  it('повторное глушение не сыплет вызовами', async () => {
    memory(true);
    const host = new Counting();
    const { music } = await start(host);
    music.duck(true);
    music.duck(true);
    music.duck(true);
    expect(host.volumes).toEqual([0]);
  });

  it('ролик и деревня разведены в коде: одна глушится, другая играет', () => {
    const replay = readFileSync(join(SRC, 'ui/battle/BattleReplay.tsx'), 'utf8');
    expect(replay).toMatch(/villageMusic\.duck\(true\)/);
    expect(replay).toMatch(/villageMusic\.duck\(false\)/);
  });
});

describe('сборка без звуковых файлов работает молча', () => {
  it('нет файлов — нет музыки, но и нет сбоя и нет шквала запросов', async () => {
    memory(true);
    const host = new Counting(0);
    const { music, timer } = await start(host);
    expect(host.loaded.length).toBe(1);
    expect(host.played).toEqual([]);
    expect(music.state()).toBe('silent');
    // И круг не начинает долбиться в отсутствующие файлы.
    await timer.advance(600);
    expect(host.loaded.length).toBe(1);
  });

  it('музыка деревни не попадает в бандл: дорожки берутся по адресу', () => {
    for (const file of ['sound/village.ts', 'sound/manifest.ts', 'sound/web.ts']) {
      const code = readFileSync(join(SRC, file), 'utf8');
      expect(code, `${file}: дорожка втянута импортом`).not.toMatch(/from ['"].*\.(mp3|ogg|wav|m4a|webm)['"]/);
      expect(code, `${file}: дорожка втянута через ?url`).not.toMatch(/\.(mp3|ogg|wav|m4a)\?/);
    }
    for (const track of VILLAGE_TRACKS) {
      expect(villageUrl(track)).toMatch(/^\/assets\/music\/village-\d\.mp3$/);
    }
  });

  it('настройка звука живёт в localStorage, а не в сохранении партии', () => {
    // Сохранение уезжает в CloudStorage и притащило бы громкость на все
    // устройства сразу, а звук — настройка устройства, а не племени.
    const settings = readFileSync(join(SRC, 'sound/settings.ts'), 'utf8');
    expect(settings).toMatch(/localStorage/);
    for (const file of ['sound/village.ts', 'sound/music.ts', 'sound/web.ts']) {
      const code = readFileSync(join(SRC, file), 'utf8');
      expect(code, `${file}: звук полез в сохранение партии`).not.toMatch(/@\/game\/(save|state|store)/);
    }
  });
});
