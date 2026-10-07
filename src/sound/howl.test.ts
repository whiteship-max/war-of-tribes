/**
 * Вой волка идёт через общий переключатель — и больше ни через что.
 *
 * Проверяется счётчиками, а не ухом: ухом правило «выключенный звук не
 * открывает контекста» не проверить вовсе — тишина одинакова, открыт контекст
 * или нет. А открытый контекст на iOS — это аппаратный поток, который вебвью
 * держит, пока его не отпустят.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WolfHowl, type HowlHost } from './howl';
import { DEFAULT_ON, setSoundOn, setSoundStorage, soundOn } from './settings';

const SRC = join(__dirname, '..');

/** Среда, которая только считает: сколько раз открывали звук и сколько выли. */
class Counting implements HowlHost {
  opened = 0;
  howls: number[] = [];
  constructor(private can = true) {}
  open(): boolean {
    this.opened++;
    return this.can;
  }
  howl(seed: number): void {
    this.howls.push(seed);
  }
}

/** Хранилище настройки в памяти — у каждого теста своё. */
const memory = (on: boolean | null): void => {
  let saved: string | null = on === null ? null : on ? '1' : '0';
  setSoundStorage({ read: () => saved, write: (v) => (saved = v) });
};

describe('вой молчит без жеста и при выключенном звуке', () => {
  it('у нового игрока — умолчание игры: выть может только после жеста и только при включённом по умолчанию звуке', () => {
    // Пустое хранилище — то же умолчание, что у музыки (`DEFAULT_ON`; на время теста с игроками — включён), и берётся
    // оно у той же настройки, а не заводится здесь своё.
    memory(null);
    const host = new Counting();
    const howl = new WolfHowl(host, soundOn);
    howl.howl(1);
    expect(host.howls).toEqual([]);
    howl.arm();
    howl.howl(1);
    expect(host.opened).toBe(DEFAULT_ON ? 1 : 0);
    expect(host.howls.length).toBe(DEFAULT_ON ? 1 : 0);
    expect(howl.ready).toBe(DEFAULT_ON);
  });

  it('без жеста не воет и при включённом звуке', () => {
    // В вебвью Telegram звук без жеста не откроется вовсе; а машинка, воющая
    // без жеста, выла бы в закрытый контекст и молча теряла вой.
    memory(true);
    const host = new Counting();
    const howl = new WolfHowl(host, soundOn);
    howl.howl(1);
    expect(host.howls).toEqual([]);
    expect(host.opened).toBe(0);
  });

  it('после жеста звук открывается один раз, а воет столько, сколько просят', () => {
    memory(true);
    const host = new Counting();
    const howl = new WolfHowl(host, soundOn);
    howl.arm();
    howl.arm();
    howl.arm();
    expect(host.opened).toBe(1);
    howl.howl(3);
    howl.howl(4);
    expect(host.howls).toEqual([3, 4]);
  });

  it('выключили звук в настройках — вой замолк сразу, без отдельной команды', () => {
    // Выключают звук, а не дорожку. Машинка спрашивает настройку на каждом вое,
    // поэтому настройкам не нужно знать про волков — и они про них не знают.
    memory(true);
    const host = new Counting();
    const howl = new WolfHowl(host, soundOn);
    howl.arm();
    setSoundOn(false);
    howl.howl(5);
    expect(host.howls).toEqual([]);
    // Включили обратно — воет снова: жест уже был, и контекст открыт им.
    setSoundOn(true);
    howl.howl(6);
    expect(host.howls).toEqual([6]);
  });

  it('звука в среде нет — жест ничего не ломает и вой не уходит в пустоту', () => {
    memory(true);
    const host = new Counting(false);
    const howl = new WolfHowl(host, soundOn);
    howl.arm();
    howl.howl(1);
    expect(host.howls).toEqual([]);
    expect(howl.ready).toBe(false);
  });
});

describe('рычаг один, контекст один, первая загрузка прежняя', () => {
  const read = (f: string): string =>
    readFileSync(join(SRC, f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('машинка воя берёт умолчание у общей настройки, а не своё', () => {
    const src = read('sound/howl.ts');
    expect(src).toContain("from './settings'");
    expect(src).not.toContain('localStorage');
    expect(src).not.toContain('setSoundOn');
  });

  it('звуковой контекст по-прежнему заводится в одном месте', () => {
    // `AudioContext` живёт только в `sound/web.ts`. Вой — первый звук вне
    // музыки, и ровно тут легче всего завести второй контекст «по месту»:
    // синтез ведь, файлов не надо. Поэтому проверяются и машинка, и сцена.
    for (const file of ['sound/howl.ts', 'prologue/scene.ts', 'prologue/Prologue.tsx']) {
      expect(read(file), `${file}: свой звуковой контекст`).not.toMatch(/AudioContext|new Audio\(/);
    }
    expect(read('sound/web.ts')).toMatch(/export function openBus\(/);
    expect(read('sound/howl.ts')).toContain("from './web'");
  });

  it('сцена воет через общую машинку и открывает звук жестом', () => {
    const src = read('prologue/scene.ts');
    expect(src).toContain("from '@/sound/howl'");
    expect(src).toMatch(/wolfHowl\.arm\(\)/);
    expect(src).toMatch(/wolfHowl\.howl\(/);
  });

  it('вой едет чанком предыстории: импортирует его только она', () => {
    /*
     * ПЕРВАЯ ЗАГРУЗКА НЕ РАСТЁТ — И ДЕРЖИТСЯ ЭТО ЗДЕСЬ, А НЕ НА СЛОВО.
     *
     * Первой версией граф воя стоял в `web.ts`, который зовёт деревня, и
     * первая загрузка выросла на полкилобайта. Импорт воя откуда-нибудь, кроме
     * предыстории, — это тот же рост, только тише: сборка не упадёт, а опись
     * покажет лишнее через неделю. Поэтому читается весь `src`.
     */
    const walk = (dir: string): string[] =>
      readdirSync(join(SRC, dir), { withFileTypes: true }).flatMap((e) =>
        e.isDirectory()
          ? walk(`${dir}/${e.name}`)
          : /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)
            ? [`${dir}/${e.name}`]
            : [],
      );
    const files = walk('.').map((f) => f.replace(/^\.\//, ''));
    expect(files.length).toBeGreaterThan(100);
    const users = files.filter((f) => /from\s+['"](@\/sound\/howl|\.\/howl|\.\.\/sound\/howl)['"]/.test(read(f)));
    for (const f of users) expect(f, `${f}: тянет вой в первую загрузку`).toMatch(/^prologue\//);
    expect(users).toContain('prologue/scene.ts');
  });
});
