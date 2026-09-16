import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LocalWorld } from './local/LocalWorld';
import { lairAnchor, isLair, type GenSettlement } from './gen';
import { lairPower } from './lairs';
import { distance } from './geo';
import { AI_RANGE } from './data/tuning';
import { MIRROR_ON, MIRROR_SPREAD, hostPower, mirrorAt, mirrorCoef, mirrorPower, type MirrorWorld } from './mirror';
import type { PlayerProfile, SettlementId } from './types';

const SRC = path.join(__dirname, '..');
const LOCAL_WORLD = path.join(__dirname, 'local', 'LocalWorld.ts');
const START = 1_700_000_000_000;

const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
};

const strip = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Имена, которыми стенд виден снаружи своего файла. */
const NAMES = /\bMIRROR_ON\b|\bMIRROR_SPREAD\b|\bmirrorPower\b|\bmirrorCoef\b|\bmirrorAt\b|\bhostPower\b|\bMirrorWorld\b/;

const profile = (army: PlayerProfile['army'], warriorPower: number): PlayerProfile => ({
  name: 'Стенд',
  pop: 300,
  defense: 500,
  warriorPower,
  army,
  units: { warrior: 0, scout: 4 },
  stock: { food: 200 },
  stash: 0,
});

interface Inner {
  gen: { settlements: GenSettlement[] };
  save: { home: { x: number; y: number }; seed: number; createdAt: number; profile: PlayerProfile | null };
  powerNow: (s: GenSettlement, now: number) => number;
  alive: (s: GenSettlement, now: number) => boolean;
}

/**
 * Мир с пульсом: слепок кладётся так же, как его кладёт игра, — иначе стенду
 * нечего зеркалить, и проверка «выключено» прошла бы по пустому профилю.
 */
async function world(seed: number, p: PlayerProfile): Promise<Inner> {
  const w = new LocalWorld({ seed, now: () => START, storage: null });
  await w.sync(p);
  return w as unknown as Inner;
}

const hostOf = (w: Inner): MirrorWorld => ({
  lairs: w.gen.settlements,
  home: w.save.home,
  seed: w.save.seed,
  profile: w.save.profile ?? null,
});

describe('стенд зеркального логова', () => {
  /**
   * Для игроков он опущен, и поднимают его у себя, на время замера. Строка
   * стоит здесь затем, чтобы поднятый выключатель не уехал в коммит незамеченным.
   */
  it('MIRROR_ON выключен', () => {
    expect(MIRROR_ON).toBe(false);
  });

  /**
   * Снаружи `world/mirror.ts` стенд виден ровно в одном файле. Разъедься он по
   * коду — и «выключено значит выключено» пришлось бы проверять в каждом месте
   * заново.
   */
  it('о стенде знает один файл мира', () => {
    const seen = walk(SRC)
      .filter((f) => f !== path.join(__dirname, 'mirror.ts') && NAMES.test(strip(readFileSync(f, 'utf8'))))
      .map((f) => path.relative(SRC, f).replace(/\\/g, '/'));
    expect(seen).toEqual(['world/local/LocalWorld.ts']);
  });

  /**
   * И в этом файле — ровно один вход, и тот за выключателем: всё, что стенд
   * умеет, лежит в его собственном модуле. Частных методов у мира под стенд нет
   * нарочно: ветку под постоянной ложью сборщик выбрасывает вместе с модулем, а
   * частный метод класса остаётся в сборке, даже когда его никто не зовёт.
   */
  it('единственный вход — за выключателем, и мир своих кусков стенда не держит', () => {
    const src = strip(readFileSync(LOCAL_WORLD, 'utf8'));
    // Вырезаем импорт и само выражение вызова: внутри них имена законны.
    const start = src.indexOf('const mirror = MIRROR_ON');
    expect(start, 'вход не найден').toBeGreaterThan(0);
    const end = src.indexOf(': null;', start);
    expect(end, 'вход не кончается на `: null;`').toBeGreaterThan(start);
    const entry = src.slice(start, end + ': null;'.length);
    expect(entry).toMatch(/^const mirror = MIRROR_ON\s*\?\s*mirrorPower\([\s\S]*\)\s*:\s*null;$/);

    const cut = src
      .replace(entry, '')
      .replace(/\n\s*import \{ MIRROR_ON, mirrorPower \} from '\.\.\/mirror';/, '\n');
    expect(cut.split('\n').filter((l) => NAMES.test(l))).toEqual([]);
  });

  /**
   * Половины «код заперт» мало: замок, который никто не открывает, от замка,
   * который никто не проверял, по исходнику не отличить. Вторая половина —
   * поведение выключенного стенда: сила логова выводится из опоры и возраста,
   * буква в букву как без него.
   */
  it('выключенный стенд не двигает силу ни одного логова', async () => {
    for (const seed of [11, 42, 77, 101]) {
      const w = await world(seed, profile({ legionary: 60, archer: 40 }, 11));
      const lairs = w.gen.settlements.filter(isLair);
      expect(lairs.length).toBeGreaterThan(0);
      for (const s of lairs) {
        const want = lairPower(
          lairAnchor(w.save.home, s),
          { bornAt: w.save.createdAt, burnedAt: 0 },
          START,
          w.save.profile?.pop ?? 0,
        );
        expect(w.powerNow(s, START), `${seed}/${s.id}`).toBeCloseTo(want, 6);
      }
    }
  });

  /**
   * И живой он тоже: дверь зовут не зря. Сам модуль выключателя не читает — его
   * читает единственное место вызова, — поэтому включённый стенд проверяется
   * прямо здесь, а не поднятым в коммите флагом.
   */
  it('включённый стенд зеркалит войско ближайшего живого логова, и только его', async () => {
    const p = profile({ legionary: 60, archer: 40 }, 11);
    const w = await world(42, p);
    const host = hostOf(w);
    const alive = (s: GenSettlement, t: number): boolean => w.alive(s, t);

    const id = mirrorAt(host, alive, START);
    expect(id).not.toBeNull();
    const near = w.gen.settlements
      .filter((s) => isLair(s) && distance(s, w.save.home) <= AI_RANGE)
      .sort((a, b) => distance(a, w.save.home) - distance(b, w.save.home));
    expect(id).toBe(near[0].id);

    // Зеркало одно: у всех прочих логов стенд молчит.
    for (const s of w.gen.settlements.filter(isLair)) {
      const got = mirrorPower(host, alive, s, START);
      if (s.id === id) expect(got).toBeCloseTo(hostPower(p) * mirrorCoef(42, s.id), 6);
      else expect(got, s.id).toBeNull();
    }
  });

  /** Сожгли зеркало — зеркалом становится следующее ближнее, а не никто. */
  it('сожжённое зеркало уступает место следующему', async () => {
    const p = profile({ legionary: 60, archer: 40 }, 11);
    const w = await world(42, p);
    const host = hostOf(w);
    const burned = new Set<SettlementId>();
    const alive = (s: GenSettlement, t: number): boolean => !burned.has(s.id) && w.alive(s, t);

    const first = mirrorAt(host, alive, START);
    expect(first).not.toBeNull();
    burned.add(first as SettlementId);
    const second = mirrorAt(host, alive, START);
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
    expect(distance(w.gen.settlements.find((s) => s.id === second)!, w.save.home)).toBeGreaterThanOrEqual(
      distance(w.gen.settlements.find((s) => s.id === first)!, w.save.home),
    );
    // Ближних не осталось — стенд молчит, и мир считает по-старому.
    for (const s of w.gen.settlements) if (distance(s, w.save.home) <= AI_RANGE) burned.add(s.id);
    expect(mirrorAt(host, alive, START)).toBeNull();
    for (const s of w.gen.settlements.filter(isLair)) expect(mirrorPower(host, alive, s, START)).toBeNull();
  });

  /** Разброс — ровно тот, что объявлен, и он и вправду по обе стороны единицы. */
  it('коэффициент лежит в объявленном разбросе и бывает с обеих сторон единицы', () => {
    let below = 0;
    let above = 0;
    for (let seed = 1; seed <= 200; seed++) {
      for (const id of ['b1', 'b2', 'l1', 'l7']) {
        const k = mirrorCoef(seed, id);
        expect(k).toBeGreaterThanOrEqual(1 - MIRROR_SPREAD);
        expect(k).toBeLessThanOrEqual(1 + MIRROR_SPREAD);
        if (k < 1) below++;
        else above++;
      }
    }
    expect(below).toBeGreaterThan(200);
    expect(above).toBeGreaterThan(200);
  });

  /** Коэффициент постоянен у логова и свой у каждого: b1 и l1 — не одно и то же. */
  it('коэффициент постоянен у логова и свой у каждого', () => {
    expect(mirrorCoef(42, 'b3')).toBe(mirrorCoef(42, 'b3'));
    expect(mirrorCoef(42, 'b3')).not.toBe(mirrorCoef(42, 'b4'));
    expect(mirrorCoef(42, 'b1')).not.toBe(mirrorCoef(42, 'l1'));
    expect(mirrorCoef(42, 'b3')).not.toBe(mirrorCoef(43, 'b3'));
  });

  /**
   * Опора — то же произведение, каким мир считает силу нашего лагеря, и второго
   * счёта «насколько силён игрок» у стенда нет. Проверяется тем, что она и
   * вправду читается из войска слепка, а не из обороны.
   */
  it('опора — войско слепка, а не оборона', () => {
    const p = profile({ legionary: 60, archer: 40 }, 11);
    expect(hostPower(p)).toBe(100 * 11);
    expect(hostPower({ ...p, defense: 99_999 })).toBe(100 * 11);
    expect(hostPower({ ...p, army: {} })).toBe(0);
  });
});
