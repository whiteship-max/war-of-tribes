import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Облако Telegram (CloudStorage) хранилищем быть перестало.
 *
 * Мест хранения было три — устройство, облако, наш сервер, — и это не тройная
 * надёжность, а тройной шанс разойтись: у каждого своя отметка времени, свои
 * условия записи, свои отказы. Осталось два, и роли у них разные: **устройство —
 * рабочая копия** (игра запускается с неё и играется без сети), **сервер —
 * правда** (переживает телефон, чистку данных, переустановку).
 *
 * Тест держит удаление с двух сторон, потому что одной мало:
 *
 * 1. **Со стороны кода**: во всём дереве не осталось ни вызова, ни спящей ветки
 *    к облаку — кроме одной двери, и та открывается только наружу.
 * 2. **Со стороны двери**: эта дверь не мёртвый код. Её зовут, зовут ровно
 *    оттуда, откуда она нужна, и она делает то, ради чего оставлена, — поднимает
 *    партию, которая может лежать только в облаке и больше нигде.
 *
 * Без второй половины «удаление» однажды окажется удалением чьей-то партии:
 * замок, который никто не открывает, от замка, который никто не проверял, по
 * исходнику не отличить.
 */

const SRC = join(__dirname, '..');
const ROOT = join(SRC, '..');

const strip = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

function sources(...dirs: string[]): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules') continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(tsx?|mjs|html)$/.test(name)) files.push(p);
    }
  };
  for (const d of dirs) walk(d);
  return files;
}

/** Единственная дверь и файл, где облако вообще упоминается кодом. */
const DOOR = join(SRC, 'telegram', 'cloud-rescue.ts');
/** Тип Telegram-клиента объявлен в обёртке — это факт о чужом API, а не наш слой. */
const WRAPPER = join(SRC, 'telegram', 'webapp.ts');
const HERE = join(SRC, 'telegram', 'cloud.test.ts');

describe('со стороны кода: от облака не осталось ни вызовов, ни спящих веток', () => {
  it('CloudStorage упоминается ровно в двери, в обёртке и здесь', () => {
    const guilty = sources(SRC, join(ROOT, 'scripts'), join(ROOT, 'netlify'))
      .filter((f) => f !== DOOR && f !== WRAPPER && f !== HERE)
      .filter((f) => /CloudStorage|cloudGet|cloudSet/.test(strip(readFileSync(f, 'utf8'))));
    expect(guilty).toEqual([]);
  });

  it('в облако не пишет никто, и написать нечем: в типе нет setItem', () => {
    // Структурный замок, а не обещание. Телеграм `setItem` отдаёт, а наш тип —
    // нет: пока его нет в типе, `cloudSet` не возвращается правкой одной строки,
    // это ошибка компиляции. Возвращать облако как хранилище надо решением.
    const wrapper = readFileSync(WRAPPER, 'utf8');
    const iface = /interface TgCloudStorageRead \{([\s\S]*?)\n\}/.exec(wrapper);
    expect(iface, 'тип чтения облака переименован или исчез').toBeTruthy();
    expect(iface![1]).not.toMatch(/setItem/);
    expect(iface![1]).toMatch(/getItem/);

    // И сама дверь ничего не записывает: единственный setItem в ней был бы
    // возвратом хранилища.
    expect(strip(readFileSync(DOOR, 'utf8'))).not.toMatch(/setItem/);
  });
});

describe('со стороны двери: подъём — живой путь, а не мёртвый код', () => {
  it('дверь зовут, и зовут ровно из загрузки партии', () => {
    const callers = sources(SRC)
      .filter((f) => f !== DOOR && f !== HERE)
      .filter((f) => /rescueFromCloud\s*\(/.test(strip(readFileSync(f, 'utf8'))));
    expect(callers).toEqual([join(SRC, 'game', 'save.ts')]);
  });

  it('облако спрашивают только при пустом устройстве', () => {
    // Порядок в `loadGame`: сперва диск, и только если его нет — облако. Иначе
    // подъём перебивал бы живую копию, а этого правила («за игрока молча не
    // выбирают») здесь держаться некому: спрашивать будет уже нечего.
    const save = strip(readFileSync(join(SRC, 'game', 'save.ts'), 'utf8'));
    expect(save).toMatch(/json \? null : await rescueFromCloud\(KEY\)/);
  });
});

/** Облако Telegram: полки с кусками по 4000 символов и числом кусков рядом. */
function fakeCloud(shelf: Map<string, string>, version = '7.0'): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      Telegram: {
        WebApp: {
          isVersionAtLeast: () => version >= '6.9',
          CloudStorage: {
            getItem: (k: string, cb: (e: Error | null, v?: string) => void) => cb(null, shelf.get(k)),
          },
        },
      },
    },
  });
}

const putInCloud = (shelf: Map<string, string>, key: string, value: string): void => {
  const parts: string[] = [];
  for (let i = 0; i < value.length; i += 4000) parts.push(value.slice(i, i + 4000));
  shelf.set(`${key}:n`, String(parts.length));
  parts.forEach((p, i) => shelf.set(`${key}:${i}`, p));
};

describe('подъём партии, которой больше негде лежать', () => {
  const cloud = new Map<string, string>();
  const disk = new Map<string, string>();

  beforeEach(() => {
    cloud.clear();
    disk.clear();
    fakeCloud(cloud);
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => disk.get(k) ?? null,
        setItem: (k: string, v: string) => void disk.set(k, v),
        removeItem: (k: string) => void disk.delete(k),
      },
    });
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('чужие куски собираются в целое', async () => {
    const { rescueFromCloud } = await import('./cloud-rescue');
    const long = 'я'.repeat(9500);
    putInCloud(cloud, 'tribe.save.v1', long);
    expect(await rescueFromCloud('tribe.save.v1')).toBe(long);
  });

  it('половина строки не возвращается никогда', async () => {
    const { rescueFromCloud } = await import('./cloud-rescue');
    putInCloud(cloud, 'tribe.save.v1', 'x'.repeat(9000));
    cloud.delete('tribe.save.v1:1');
    // Битый json дальше пойдёт в `deserialize`, тот его не прочтёт, и игрок
    // получит «партия начата заново» вместо честного «в облаке ничего не было».
    expect(await rescueFromCloud('tribe.save.v1')).toBeNull();
  });

  it('пустого устройства мало: облака может не быть вовсе', async () => {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
    const { rescueFromCloud } = await import('./cloud-rescue');
    expect(await rescueFromCloud('tribe.save.v1')).toBeNull();
  });

  it('партия из облака поднимается, ложится на диск и не молчит об этом', async () => {
    const { createInitialState } = await import('@/game/state');
    const { serialize, loadGame } = await import('@/game/save');
    const был = createInitialState();
    был.gold = 4242;
    putInCloud(cloud, 'tribe.save.v1', serialize(был));

    const res = await loadGame();
    expect(res.legacy).toBe(false);
    expect(res.fresh).toBe(false);
    expect(res.state.gold).toBe(4242);
    // Закрепилось сразу: второго подъёма не будет — облако спрашивают только
    // при пустом устройстве, а оно только что перестало быть пустым.
    expect(disk.get('tribe.save.v1')).toBeTruthy();
    // И игрок об этом узнает: партия приехала из места, о котором он не просил.
    expect(res.state.log.some((e) => /облака Telegram/.test(e.text))).toBe(true);
  });

  it('своя копия сильнее облачной, и облако при ней не спрашивают', async () => {
    const { createInitialState } = await import('@/game/state');
    const { serialize, loadGame } = await import('@/game/save');
    const своя = createInitialState();
    своя.gold = 777;
    disk.set('tribe.save.v1', serialize(своя));
    const чужая = createInitialState();
    чужая.gold = 4242;
    putInCloud(cloud, 'tribe.save.v1', serialize(чужая));

    const res = await loadGame();
    expect(res.state.gold).toBe(777);
    expect(res.state.log.some((e) => /облака Telegram/.test(e.text))).toBe(false);
  });
});
