// Звук ролика: устройство без файлов.
//
// Проверяется здесь не то, как он звучит — звучать пока нечему, — а три
// обещания, каждое из которых стоит денег или доверия игрока:
//
// 1. слой выводится из такта раскадровки чистой функцией: один журнал — одна
//    последовательность слоёв;
// 2. без жеста игрока не открывается ни контекст, ни одна загрузка;
// 3. выключенный звук не грузит вовсе, а сборка без файлов работает молча.
//
// Всё это видно только по вызовам, поэтому среда подменяется счётчиком.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { simulateBattle } from '@/battle/sim';
import { deploySetup } from '@/battle/setup';
import { ACTS, MUSIC_BY_ACT, buildCast, frameAt, musicAt, musicCues, type Cast } from '@/battle/replay';
import { BattleMusic, type AudioHost } from './music';
import { MUSIC_FORMAT, MUSIC_TRACKS, battleFiles, trackOf, trackUrl } from './manifest';
import { setSoundStorage, setSoundOn, soundOn } from './settings';

const SRC = join(__dirname, '..');

const fight = (seed = 7): Cast =>
  buildCast(
    simulateBattle({
      seed,
      attacker: deploySetup({ spear: 150, infantry: 200, archer: 150, cavalry: 100 }),
      defender: deploySetup({ spear: 200, infantry: 200, archer: 150, cavalry: 50 }),
    }),
    'attacker',
  );

/** Среда, которая ничего не умеет, зато считает, о чём её просили. */
class Counting implements AudioHost {
  opened = 0;
  loaded: string[] = [];
  started = 0;
  layers: (string | null)[] = [];
  mixes: Record<string, number>[] = [];
  stopped = 0;
  /** Есть ли файлы. По умолчанию нет — это и есть нынешняя сборка. */
  constructor(private files = false) {}

  open(): boolean {
    this.opened++;
    return true;
  }

  async load(id: string, url: string): Promise<boolean> {
    this.loaded.push(url);
    return this.files;
  }

  start(): void {
    this.started++;
  }

  mix(levels: Record<string, number>): void {
    this.mixes.push(levels);
    // Кто слышен: единственная дорожка с ненулевой громкостью, если она одна.
    const loud = Object.entries(levels).filter(([, v]) => v > 0);
    this.layers.push(loud.length === 1 ? loud[0][0] : loud.length === 0 ? null : '?');
  }

  stop(): void {
    this.stopped++;
  }
}

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

describe('слой музыки выводится из такта раскадровки', () => {
  it('один журнал — одна последовательность слоёв', () => {
    const a = fight();
    const b = fight();
    expect(b.music).toEqual(a.music);
    // И на каждой секунде тоже: слой — функция времени, а не состояния плеера.
    for (let t = 0; t <= a.seconds; t += 0.25) {
      expect(frameAt(b, t).music).toBe(frameAt(a, t).music);
    }
  });

  it('барабаны — перед сближением, гармония — на отъезде, полный — на бою, тишина — после', () => {
    const cast = fight();
    const at = (act: (typeof ACTS)[number]): string => {
      const win = cast.acts.find((w) => w.act === act)!;
      return frameAt(cast, win.from + (win.to - win.from) / 2).music;
    };
    expect(at('muster')).toBe('drums');
    expect(at('pullback')).toBe('harmony');
    expect(at('melee')).toBe('full');
    expect(at('rout')).toBe('silence');
    // И знамя падает уже на тишине: спуск целиком в последнем такте.
    expect(frameAt(cast, cast.seconds).music).toBe('silence');
  });

  it('смена слоя стоит ровно на границе такта и не повторяется зря', () => {
    const cast = fight();
    expect(cast.music).toEqual(musicCues(cast.acts));
    for (const cue of cast.music) {
      expect(cast.acts.some((w) => w.from === cue.at), `слой встал не на границе такта`).toBe(true);
    }
    // Подряд одинаковых слоёв нет: смена есть смена.
    for (let i = 1; i < cast.music.length; i++) {
      expect(cast.music[i].layer).not.toBe(cast.music[i - 1].layer);
    }
    // До начала ролика тишина, а не первый слой наугад.
    expect(musicAt(cast.music, -1)).toBe('silence');
  });

  it('у каждого такта есть свой слой, и таблица не забывает такты', () => {
    for (const act of ACTS) expect(MUSIC_BY_ACT[act]).toBeTruthy();
  });
});

describe('без жеста игрока звук не запускается', () => {
  it('до жеста не открыт контекст и не начата ни одна загрузка', () => {
    memory(true);
    const host = new Counting();
    const music = new BattleMusic(host, soundOn);
    // Ролик уже идёт и просит слои — но жеста не было.
    music.start();
    music.set('drums');
    music.set('full');
    expect(host.opened).toBe(0);
    expect(host.loaded).toEqual([]);
    expect(host.started).toBe(0);
    expect(music.ready).toBe(false);
    expect(music.state()).toBe('idle');
  });

  it('после жеста контекст открывается ровно один раз', () => {
    memory(true);
    const host = new Counting(true);
    const music = new BattleMusic(host, soundOn);
    music.arm();
    music.arm();
    music.arm();
    expect(host.opened).toBe(1);
    expect(music.ready).toBe(true);
  });

  it('в коде нет ни одного звука мимо жеста: контекст создаётся в одном месте', () => {
    // `AudioContext` живёт только в `web.ts`, и открывается он только из `open()`,
    // который зовёт `arm()`. Заведётся второй — правило станет пожеланием.
    const web = readFileSync(join(SRC, 'sound/web.ts'), 'utf8');
    expect(web).toMatch(/open\(\): boolean/);
    for (const file of ['sound/music.ts', 'ui/battle/BattleReplay.tsx', 'ui/panels/ReportPanel.tsx']) {
      const code = readFileSync(join(SRC, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      expect(code, `${file}: свой звуковой контекст`).not.toMatch(/AudioContext|new Audio\(/);
    }
  });
});

describe('выключенный звук не грузит файлов', () => {
  it('ни одной загрузки и ни одного контекста при выключенном звуке', () => {
    memory(false);
    const host = new Counting(true);
    const music = new BattleMusic(host, soundOn);
    music.arm();
    music.start();
    music.set('full');
    expect(host.opened).toBe(0);
    expect(host.loaded).toEqual([]);
    expect(music.state()).toBe('off');
  });

  it('включение прямо в ролике — тоже жест, и грузит уже оно', () => {
    memory(false);
    const host = new Counting(true);
    const music = new BattleMusic(host, soundOn);
    music.arm();
    expect(host.loaded).toEqual([]);
    setSoundOn(true);
    music.toggle(true);
    expect(host.opened).toBe(1);
    expect(host.loaded.length).toBe(battleFiles().length);
  });

  it('настройка помнится между сеансами, а до неё игра молчит', () => {
    let saved: string | null = null;
    setSoundStorage({ read: () => saved, write: (v) => (saved = v) });
    // Пустое хранилище — музыка выключена. Игру открывают где придётся, и
    // заигравшая без спроса музыка — это неожиданность, а не подарок.
    expect(soundOn()).toBe(false);
    setSoundOn(true);
    expect(saved).toBe('1');
    expect(soundOn()).toBe(true);
    setSoundOn(false);
    expect(soundOn()).toBe(false);
  });

  it('у нового игрока не качается ни байта музыки, пока он её не включит', () => {
    // То же обещание, но проверенное не флажком, а вызовами: пустое хранилище,
    // жест был, а сеть не тронута.
    let saved: string | null = null;
    setSoundStorage({ read: () => saved, write: (v) => (saved = v) });
    const host = new Counting(true);
    const music = new BattleMusic(host, soundOn);
    music.arm();
    music.start();
    expect(host.opened).toBe(0);
    expect(host.loaded).toEqual([]);
  });
});

describe('рычаг на музыку один на всю игру', () => {
  // Читается исходник, а не поведение: второй переключатель работал бы
  // безупречно ровно до того дня, когда правят первый. Именно так и было —
  // звук жил кнопкой в ролике о бое, — и вернуть его туда должно быть трудно.
  const read = (f: string): string =>
    readFileSync(join(SRC, f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('пишет настройку ровно одно место интерфейса — раздел настроек', () => {
    // Список файлов был на двоих — на те, откуда рычаг убирали. Со вторым местом
    // показа (стартовый экран) перечисление перестало годиться: правило обязано
    // ловить и тот файл, о котором никто не подумал.
    //
    // Поэтому читаются целиком **три** папки, а не одна. `ui` — там показывают
    // настройку; `prologue` — там появился третий звук (вой волка), и своя
    // галочка «выть или нет» была бы ровно тем вторым рычагом, ради которого
    // правило и написано; `sound` — там живут машинки, и запись настройки из
    // машинки означала бы, что подсистема правит настройку игрока сама.
    const walk = (dir: string, ext: string[]): string[] =>
      readdirSync(join(SRC, dir), { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(`${dir}/${e.name}`, ext) : ext.some((x) => e.name.endsWith(x)) ? [`${dir}/${e.name}`] : [],
      );
    const files = [...walk('ui', ['.tsx']), ...walk('prologue', ['.ts', '.tsx']), ...walk('sound', ['.ts'])].filter(
      (f) => !f.endsWith('.test.ts') && !f.endsWith('.test.tsx'),
    );
    expect(files.length).toBeGreaterThan(30);
    for (const f of files) {
      // Сама настройка — не рычаг, а его хранилище: `setSoundOn` в ней и объявлен.
      if (f === 'ui/parts/Settings.tsx' || f === 'sound/settings.ts') continue;
      expect(read(f), `${f}: второй рычаг на звук`).not.toContain('setSoundOn');
    }
    expect(read('ui/parts/Settings.tsx')).toContain('setSoundOn');
  });

  it('в раскадровке ролика переключателя звука больше нет', () => {
    const src = read('battle/replay.ts');
    expect(src).not.toContain("'sound'");
    expect(src).not.toContain('SOUND');
  });

  it('выключение гасит обе музыки, включение не тянет боевую', () => {
    // У боевой свой жест — «Смотреть бой». Качать battle.mp3 из настроек
    // значило бы платить мегабайтом за нажатие, которое о бое не просило.
    const src = read('ui/parts/Settings.tsx');
    expect(src).toMatch(/villageMusic\.toggle\(next\)/);
    expect(src).toMatch(/if \(!next\) battleMusic\.toggle\(false\)/);
  });
});

describe('сборка без звуковых файлов работает молча', () => {
  it('нет файлов — нет звука, но и нет сбоя', async () => {
    memory(true);
    const host = new Counting(false);
    const music = new BattleMusic(host, soundOn);
    music.arm();
    music.start();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    // Качать пробовали — и это правильно: файл может появиться завтра.
    expect(host.loaded.length).toBe(battleFiles().length);
    // Играть нечем, и это не ошибка, а состояние.
    expect(music.state()).toBe('silent');
    music.set('full');
    music.stop();
    expect(host.stopped).toBeGreaterThan(0);
  });

  it('звук не попадает в бандл: дорожки берутся по адресу, а не импортом', () => {
    for (const file of ['sound/manifest.ts', 'sound/music.ts', 'sound/web.ts']) {
      const code = readFileSync(join(SRC, file), 'utf8');
      // Импорт файла втянул бы его в чанк — тогда «сборка без звука» перестала
      // бы собираться, а бандл вырос бы на мегабайт музыки.
      expect(code, `${file}: дорожка втянута импортом`).not.toMatch(/from ['"].*\.(mp3|ogg|wav|m4a|webm)['"]/);
      expect(code, `${file}: дорожка втянута через ?url`).not.toMatch(/\.(mp3|ogg|wav|m4a)\?/);
    }
    // Адрес собирается из папки в public — сборка копирует её как есть.
    for (const track of MUSIC_TRACKS) {
      expect(trackUrl(track)).toMatch(/^\/assets\/music\/[a-z]+\.mp3$/);
    }
  });
});

describe('манифест — это заказ, а не украшение', () => {
  it('на каждый звучащий слой есть дорожка, у тишины её нет', () => {
    for (const layer of ['drums', 'harmony', 'full'] as const) {
      const track = trackOf(layer);
      expect(track, `нет дорожки слоя ${layer}`).toBeTruthy();
      expect(track!.file.endsWith(`.${MUSIC_FORMAT}`)).toBe(true);
      expect(track!.note.length, `${layer}: заказ без описания`).toBeGreaterThan(40);
      expect(track!.seconds.max).toBeGreaterThanOrEqual(track!.seconds.min);
    }
    expect(trackOf('silence')).toBeNull();
  });

  it('такты дорожек совпадают с тактами раскадровки', () => {
    const cast = fight();
    for (const track of MUSIC_TRACKS) {
      const win = cast.acts.find((w) => w.act === track.act);
      expect(win, `${track.layer}: такта ${track.act} нет в ролике`).toBeTruthy();
      const seconds = win!.to - win!.from;
      expect(seconds).toBeGreaterThanOrEqual(track.seconds.min - 1e-9);
      expect(seconds).toBeLessThanOrEqual(track.seconds.max + 1e-9);
      // Слой дорожки — тот же, что таблица назначает этому такту.
      expect(MUSIC_BY_ACT[track.act]).toBe(track.layer);
    }
  });
});
