// Дверь поворота: город и меню — вертикально, промысел и ролик боя — как держат (решение владельца 04.10.2026).
//
// Проверяется настоящий код, а не его описание: окружение двери поддельное — экран, телефон и заставка, — а
// закрепляет макет Телеграма через ту же `tgTurner`, что и в игре. Главное свойство — закрепление по документации
// Телеграма держит ТЕКУЩУЮ ориентацию: звать его, пока телефон боком, нельзя — закрепилась бы горизонталь.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TurnDoor, tgTurner, type TgTurn, type TurnEnv } from './orientation';

/** Макет `Telegram.WebApp`: версия клиента, платформа и счёт вызовов закрепления. */
class FakeTg implements TgTurn {
  locks = 0;
  unlocks = 0;
  /** Закреплено ли сейчас — и в какой ориентации. */
  held: 'portrait' | 'landscape' | null = null;
  constructor(
    private screen: FakeEnv,
    private ver = '8.0',
    public platform = 'android',
  ) {}
  isVersionAtLeast = (v: string): boolean => Number(this.ver) >= Number(v);
  lockOrientation = (): void => {
    this.locks++;
    // Как в документации: закрепляется та ориентация, в которой стоит экран сейчас.
    this.held = this.screen.wide ? 'landscape' : 'portrait';
  };
  unlockOrientation = (): void => {
    this.unlocks++;
    this.held = null;
  };
}

/** Поддельный мир двери: как держат телефон, телефон ли это, что на экране. */
class FakeEnv implements TurnEnv {
  /** Телефон держат боком. */
  wide = false;
  isPhone = true;
  tg: FakeTg | null = null;
  splashOn = false;
  notes: string[] = [];
  landscape = (): boolean => (this.tg?.held ? this.tg.held === 'landscape' : this.wide);
  phone = (): boolean => this.isPhone;
  turner = () => tgTurner(this.tg);
  splash = (show: boolean): void => {
    this.splashOn = show;
  };
  note = (text: string): void => {
    this.notes.push(text);
  };
  /** Повернуть телефон: экран следует за ним, только если ориентация не закреплена. */
  turn(wide: boolean, door: TurnDoor): void {
    this.wide = wide;
    door.check('поворот');
  }
}

function world(opts: { wide?: boolean; ver?: string; platform?: string; phone?: boolean } = {}) {
  const env = new FakeEnv();
  env.wide = opts.wide ?? false;
  env.isPhone = opts.phone ?? true;
  env.tg = new FakeTg(env, opts.ver ?? '8.0', opts.platform ?? 'android');
  const door = new TurnDoor(env);
  door.check('запуск');
  return { env, tg: env.tg, door };
}

describe('город — только вертикально', () => {
  it('телефон вертикально: вертикаль закреплена, заставки нет', () => {
    const { env, tg, door } = world();
    expect(tg.locks).toBe(1);
    expect(tg.held).toBe('portrait');
    expect(door.isLocked).toBe(true);
    expect(env.splashOn).toBe(false);
    // Закреплено — поворот телефона экран не поворачивает, заставка не нужна.
    env.turn(true, door);
    expect(env.splashOn).toBe(false);
    expect(tg.locks).toBe(1);
  });

  it('запуск боком: заставка на городе, и закрепления нет — закрепилась бы горизонталь', () => {
    const { env, tg, door } = world({ wide: true });
    expect(env.splashOn).toBe(true);
    expect(tg.locks).toBe(0);
    expect(tg.held).toBe(null);
    // Повернули вертикально — заставка уходит, вертикаль закрепляется.
    env.turn(false, door);
    expect(env.splashOn).toBe(false);
    expect(tg.locks).toBe(1);
    expect(tg.held).toBe('portrait');
  });

  it('старый клиент (до Bot API 8.0): закреплять нечем, держит заставка', () => {
    const { env, tg, door } = world({ ver: '7.10' });
    expect(tg.locks).toBe(0);
    expect(door.isLocked).toBe(false);
    env.turn(true, door);
    expect(env.splashOn).toBe(true);
    env.turn(false, door);
    expect(env.splashOn).toBe(false);
    expect(tg.locks).toBe(0);
  });

  it('вне клиента (`platform` unknown) Телеграма не просят', () => {
    const { tg } = world({ platform: 'unknown' });
    expect(tg.locks).toBe(0);
  });

  it('компьютер и планшет боком — без заставки', () => {
    const { env } = world({ wide: true, phone: false });
    expect(env.splashOn).toBe(false);
  });
});

describe('промысел и ролик — в любой ориентации', () => {
  it('промысел снимает закрепление, заставки в нём нет; на выходе вертикаль закреплена снова', () => {
    const { env, tg, door } = world();
    const release = door.free('промысел');
    expect(tg.unlocks).toBe(1);
    expect(tg.held).toBe(null);
    expect(door.isLocked).toBe(false);
    // Положили телефон боком — промысел поворачивается, заставки нет.
    env.turn(true, door);
    expect(env.landscape()).toBe(true);
    expect(env.splashOn).toBe(false);
    // Вернули вертикально и вышли — закреплено снова.
    env.turn(false, door);
    release();
    expect(tg.locks).toBe(2);
    expect(tg.held).toBe('portrait');
    expect(env.splashOn).toBe(false);
  });

  it('вышли из промысла боком: заставка, а не закреплённая горизонталь; повернули — вертикаль', () => {
    const { env, tg, door } = world();
    const release = door.free('промысел');
    env.turn(true, door);
    release();
    expect(env.splashOn).toBe(true);
    expect(tg.held).toBe(null);
    expect(tg.locks).toBe(1);
    env.turn(false, door);
    expect(env.splashOn).toBe(false);
    expect(tg.held).toBe('portrait');
  });

  it('запуск боком и сразу ролик: заставка уходит, пока ролик идёт', () => {
    const { env, door } = world({ wide: true });
    expect(env.splashOn).toBe(true);
    const release = door.free('ролик боя');
    expect(env.splashOn).toBe(false);
    release();
    expect(env.splashOn).toBe(true);
  });

  it('две свободы разом: закрепление ждёт, пока отпустят обе; второй отпуск — ничего', () => {
    const { tg, door } = world();
    const a = door.free('промысел');
    const b = door.free('ролик боя');
    a();
    a();
    expect(door.isLocked).toBe(false);
    expect(tg.locks).toBe(1);
    b();
    expect(door.isLocked).toBe(true);
    expect(tg.locks).toBe(2);
  });
});

describe('проводка', () => {
  const read = (p: string): string => readFileSync(join(__dirname, p), 'utf8');

  it('промысел и ролик боя просят свободы, Телеграм заводит дверь', () => {
    expect(read('minigames/Minigame.tsx')).toMatch(/freeTurn\('промысел'\)/);
    expect(read('ui/battle/TwReplay.tsx')).toMatch(/freeTurn\('ролик боя'\)/);
    expect(read('telegram/webapp.ts')).toMatch(/startOrientation\(app\)/);
  });
});
