/**
 * Замеры плавности с телефонов (docs/telemetry.md): что сервер хранит и как отвечает админу `/perf`.
 *
 * Хранилище `tribe-perf`, запись — сутки одного устройства одного замка: ключ `<ГГГГММДД>/<замок>.<устройство>`.
 * Пачка (`/api/perf`, `contract.readPerf`) вливается в запись своих суток: корзины кадров складываются, события
 * дописываются до потолка. Игрок — только номер замка (`roster.castleIdOf`), устройство — отпечаток его класса
 * (`devId`), а не имя: в записи нет ни ключа `tg-…`, ни имени пользователя, ни строки браузера.
 *
 * Срок — `PERF_LIMITS.keepDays` суток: папки старше уносит `sweepPerf`, его зовёт приём пачки не чаще раза в час.
 * Чистый старт (`/wipeworld`) замеров не стирает: они про телефоны, а не про партию, и уходят сами по сроку.
 */
import { createHash } from 'node:crypto';
import { PERF_LIMITS, PERF_PLACES, type PerfDevice, type PerfDrop, type PerfFreeze, type PerfPlace, type PerfPut } from './contract.js';
import { WRITE_TRIES, parseJson } from './http.js';
import type { Kv } from './kv.js';
import { autoQuality } from '../../src/render/quality.js';

/** Сутки одного устройства одного замка. */
export interface PerfDay {
  v: 1;
  castle: string;
  dev: PerfDevice;
  build: string;
  /** Первая и последняя пачка суток, серверное время. */
  from: number;
  at: number;
  /** Пачек и охваченного времени, мс. */
  n: number;
  span: number;
  q: PerfPut['q'];
  set: PerfPut['set'];
  fps: Partial<Record<PerfPlace, Record<string, number>>>;
  drops: (PerfDrop & { at: number })[];
  freeze: (PerfFreeze & { at: number })[];
  first: number[];
  ready: number[];
  long: { n: number; ms: number; max: number } | null;
  err: number;
}

/** Сколько событий одного рода держит запись суток: сверх — дописываются только числа. */
export const DAY_EVENTS = 30;

/** Сутки по UTC: `20261017`. */
export const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');

/** Отпечаток устройства: те же поля — тот же номер, без имён. Поворот экрана его не меняет — короткая сторона первой. */
export const devId = (d: PerfDevice): string =>
  createHash('sha256')
    .update(JSON.stringify([d.kind, d.os, d.osv, d.app, d.tgp, d.br, d.gpu, d.w, d.h, d.dpr, d.mem, d.cores, d.tgc]))
    .digest('hex')
    .slice(0, 10);

export const perfKey = (now: number, castle: string, dev: PerfDevice): string => `${dayOf(now)}/${castle}.${devId(dev)}`;

const tail = <T>(list: T[], max: number): T[] => (list.length > max ? list.slice(-max) : list);

/** Влить пачку в сутки. Первой пачке суток — новая запись. */
export function mergePerf(day: PerfDay | null, castle: string, p: PerfPut, now: number): PerfDay {
  const d: PerfDay = day ?? {
    v: 1,
    castle,
    dev: p.dev,
    build: p.build,
    from: now,
    at: now,
    n: 0,
    span: 0,
    q: p.q,
    set: p.set,
    fps: {},
    drops: [],
    freeze: [],
    first: [],
    ready: [],
    long: null,
    err: 0,
  };
  d.dev = p.dev;
  d.build = p.build;
  d.at = now;
  d.n++;
  d.span += p.span;
  d.q = p.q;
  d.set = p.set;
  for (const place of PERF_PLACES) {
    const h = p.fps[place];
    if (!h) continue;
    const into = (d.fps[place] ??= {});
    for (const [k, c] of Object.entries(h)) into[k] = (into[k] ?? 0) + c;
  }
  d.drops = tail([...d.drops, ...p.drops.map((x) => ({ ...x, at: now }))], DAY_EVENTS);
  d.freeze = tail([...d.freeze, ...p.freeze.map((x) => ({ ...x, at: now }))], DAY_EVENTS);
  if (p.first !== undefined) d.first = tail([...d.first, p.first], DAY_EVENTS);
  if (p.ready !== undefined) d.ready = tail([...d.ready, p.ready], DAY_EVENTS);
  if (p.long) d.long = d.long ? { n: d.long.n + p.long.n, ms: d.long.ms + p.long.ms, max: Math.max(d.long.max, p.long.max) } : { ...p.long };
  d.err += p.err;
  return d;
}

/** Запись суток из хранилища; испорченная — `null` (её перепишет следующая пачка). */
export function readPerfDay(v: unknown): PerfDay | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as PerfDay;
  return r.v === 1 && typeof r.castle === 'string' && r.dev && typeof r.n === 'number' && r.fps && Array.isArray(r.drops) ? r : null;
}

/** Ответ записи пачки: легла, или сутки устройства уже полны (`perDay`), или запись не выиграна. */
export type PerfWrite = 'ok' | 'full' | 'busy';

/** Влить пачку условной записью по ETag: две пачки одного устройства разом не теряют ни одной. */
export async function writePerf(kv: Kv, castle: string, p: PerfPut, now: number): Promise<PerfWrite> {
  const key = perfKey(now, castle, p.dev);
  for (let i = 0; i < WRITE_TRIES; i++) {
    const found = await kv.getWithMetadata(key);
    const day = readPerfDay(found ? parseJson(String(found.data)) : null);
    if (day && day.n >= PERF_LIMITS.perDay) return 'full';
    const next = mergePerf(day, castle, p, now);
    const put = await kv.setJSON(key, next, found?.etag ? { onlyIfMatch: found.etag } : { onlyIfNew: true });
    if (put.modified) return 'ok';
  }
  return 'busy';
}

/** Унести сутки старше срока. Возвращает, сколько записей удалено. */
export async function sweepPerf(kv: Kv, now: number, keep: number = PERF_LIMITS.keepDays): Promise<number> {
  const edge = dayOf(now - keep * 86_400_000);
  const { directories } = await kv.list({ directories: true });
  let gone = 0;
  for (const dir of directories) {
    if (!/^\d{8}$/.test(dir) || dir >= edge) continue;
    const { blobs } = await kv.list({ prefix: `${dir}/` });
    for (const b of blobs) {
      await kv.delete(b.key);
      gone++;
    }
  }
  return gone;
}

/** Записи последних `days` суток; `castle` — только его. */
export async function perfDays(kv: Kv, now: number, days: number, castle: string | null = null): Promise<PerfDay[]> {
  const out: PerfDay[] = [];
  for (let i = 0; i < days; i++) {
    const { blobs } = await kv.list({ prefix: `${dayOf(now - i * 86_400_000)}/` });
    const keys = blobs.map((b) => b.key).filter((k) => !castle || k.slice(9).startsWith(`${castle}.`));
    for (let j = 0; j < keys.length; j += 16) {
      const got = await Promise.all(keys.slice(j, j + 16).map((k) => kv.getWithMetadata(k)));
      for (const f of got) {
        const d = readPerfDay(f ? parseJson(String(f.data)) : null);
        if (d) out.push(d);
      }
    }
  }
  return out;
}

// ------------------------------------------------ счёт ---

type Hist = Record<string, number>;

const addHist = (into: Hist, h: Hist | undefined): Hist => {
  if (h) for (const [k, c] of Object.entries(h)) into[k] = (into[k] ?? 0) + c;
  return into;
};

export const framesOf = (h: Hist): number => Object.values(h).reduce((a, b) => a + b, 0);

/**
 * Промежуток кадра доли `q` (0.5 — медиана, 0.95 — худшие 5 %), мс: середина корзины, последняя корзина — её край.
 * Кадров нет — `null`.
 */
export function gapAt(h: Hist, q: number): number | null {
  const n = framesOf(h);
  if (!n) return null;
  const want = Math.ceil(n * q);
  let seen = 0;
  for (let b = 0; b <= PERF_LIMITS.bucket; b++) {
    seen += h[b] ?? 0;
    if (seen >= want) return b === PERF_LIMITS.bucket ? b : b + 0.5;
  }
  return PERF_LIMITS.bucket;
}

/** Кадров в секунду по промежутку: не выше потолка двери кадра (60) — дрожь отметок не делает шестьдесят один. */
export const fpsOf = (gap: number | null): number | null => (gap === null ? null : Math.min(60, Math.round(1000 / gap)));

/** «58 · 41»: медиана и худшие 5 % в кадрах в секунду; последняя корзина — «<10». */
export function fpsPair(h: Hist): string {
  const w = (q: number): string => {
    const g = gapAt(h, q);
    return g === PERF_LIMITS.bucket ? '<10' : String(fpsOf(g));
  };
  return `${w(0.5)} · ${w(0.95)}`;
}

/** Доля `q` списка чисел. */
export function quantile(list: number[], q: number): number | null {
  if (!list.length) return null;
  const s = [...list].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(s.length * q) - 1)];
}

// ------------------------------------------------ слова ---

export const PLACE_WORD: Record<PerfPlace, string> = {
  city: 'город',
  map: 'карта',
  battle: 'ролик боя',
  siege: 'ролик осады',
  prologue: 'предыстория',
  berries: 'ягоды',
  herd: 'скот',
  hunt: 'охота',
  fish: 'рыбалка',
};

export const TIER_WORD: Record<string, string> = {
  high: 'высокий',
  medium: 'средний',
  low: 'низкий',
  full: 'полный',
  lite: 'лёгкий',
  base: 'пол',
  auto: 'авто',
};

const OS_WORD: Record<PerfDevice['os'], string> = { ios: 'iOS', android: 'Android', windows: 'Windows', mac: 'macOS', linux: 'Linux', other: 'другая ОС' };

/**
 * Класс устройства — тот же суд, что выбирает игре уровень графики (`quality.autoQuality`): слабый, средний, сильный.
 * Платформа — iPhone, iPad, Android, ПК.
 */
export function classOf(d: PerfDevice): string {
  const q = autoQuality({ coarse: d.kind !== 'desktop', memory: d.mem, cores: d.cores, gpu: d.gpu || null, tg: d.tgc });
  const tier = q === 'low' ? 'слабый' : q === 'medium' ? 'средний' : 'сильный';
  const plat = d.kind === 'desktop' ? 'ПК' : d.os === 'ios' ? (d.kind === 'tablet' ? 'iPad' : 'iPhone') : d.os === 'android' ? 'Android' : OS_WORD[d.os];
  return `${plat} ${tier}`;
}

/** Устройство одной строкой: «Android 14 · телефон 360×800 @3 · Adreno (TM) 618 · 4 ГБ, 8 ядер · Telegram android 8.0». */
export function deviceLine(d: PerfDevice): string {
  const kind = d.kind === 'phone' ? 'телефон' : d.kind === 'tablet' ? 'планшет' : 'ПК';
  const mem = [d.mem !== null ? `${d.mem} ГБ` : '', d.cores !== null ? `${d.cores} ядер` : ''].filter(Boolean).join(', ');
  return [
    `${OS_WORD[d.os]}${d.osv ? ` ${d.osv}` : ''}`,
    `${kind} ${d.w}×${d.h} @${d.dpr}`,
    d.gpu || 'видеокарта скрыта',
    mem,
    d.app === 'tg' ? `Telegram ${d.tgp || '?'} ${d.tgv}`.trim() : `браузер ${d.br}`,
    d.tgc ? `класс ${d.tgc}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

const secs = (ms: number): string => (ms >= 10_000 ? `${Math.round(ms / 1000)} с` : ms >= 1000 ? `${(ms / 1000).toFixed(1)} с` : `${Math.round(ms)} мс`);
const hours = (ms: number): string => (ms >= 3_600_000 ? `${(ms / 3_600_000).toFixed(1)} ч` : `${Math.round(ms / 60_000)} мин`);
const big = (n: number): string => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} млн` : n >= 1e4 ? `${Math.round(n / 1000)} тыс.` : String(n));

/** Место города — по нему классы и худшие устройства. Именем, а не полем: `.city` в коде — имя города (`cityname.test.ts`). */
const TOWN: PerfPlace = 'city';
const MAP: PerfPlace = 'map';

/** Сколько кадров нужно месту, чтобы его худшие 5 % что-то значили: ~10 секунд хода. */
export const MIN_FRAMES = 300;

/** Устройство за все свои сутки — одной сводкой: ключ — замок и отпечаток. */
interface DevSum {
  castle: string;
  dev: PerfDevice;
  q: PerfPut['q'];
  set: PerfPut['set'];
  at: number;
  fps: Partial<Record<PerfPlace, Hist>>;
  drops: PerfDay['drops'];
  freeze: PerfDay['freeze'];
  first: number[];
  ready: number[];
  long: { n: number; ms: number; max: number } | null;
  span: number;
  n: number;
  err: number;
  build: string;
}

export function byDevice(days: PerfDay[]): DevSum[] {
  const map = new Map<string, DevSum>();
  for (const d of [...days].sort((a, b) => a.at - b.at)) {
    const id = `${d.castle}.${devId(d.dev)}`;
    const s = map.get(id) ?? { castle: d.castle, dev: d.dev, q: d.q, set: d.set, at: 0, fps: {}, drops: [], freeze: [], first: [], ready: [], long: null, span: 0, n: 0, err: 0, build: d.build };
    s.q = d.q;
    s.set = d.set;
    s.at = d.at;
    s.build = d.build;
    for (const p of PERF_PLACES) if (d.fps[p]) s.fps[p] = addHist(s.fps[p] ?? {}, d.fps[p]);
    s.drops.push(...d.drops);
    s.freeze.push(...d.freeze);
    s.first.push(...d.first);
    s.ready.push(...d.ready);
    if (d.long) s.long = s.long ? { n: s.long.n + d.long.n, ms: s.long.ms + d.long.ms, max: Math.max(s.long.max, d.long.max) } : { ...d.long };
    s.span += d.span;
    s.n += d.n;
    s.err += d.err;
    map.set(id, s);
  }
  return [...map.values()];
}

const dropLine = (drops: { f: string; t: string; p: PerfPlace }[]): string => {
  const steps = new Map<string, number>();
  const places = new Map<string, number>();
  for (const d of drops) {
    const s = `${TIER_WORD[d.f] ?? d.f}→${TIER_WORD[d.t] ?? d.t}`;
    steps.set(s, (steps.get(s) ?? 0) + 1);
    places.set(PLACE_WORD[d.p], (places.get(PLACE_WORD[d.p]) ?? 0) + 1);
  }
  const list = (m: Map<string, number>): string =>
    [...m]
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${k} ${n}`)
      .join(', ');
  return `${drops.length} — ${list(steps)} (${list(places)})`;
};

/** Сводка `/perf`: места, классы, уровни, понижения, замирания, первый кадр, длинные задачи, ошибки, худшие устройства. */
export function perfSummary(days: PerfDay[], period: number): string {
  const devs = byDevice(days);
  if (!devs.length) return `Замеров за ${period} дн. нет. Они приходят с телефонов в Telegram раз в пять минут и при сворачивании; игрок может выключить их в настройках.`;
  const castles = new Set(devs.map((d) => d.castle)).size;
  const lines = [
    `Замеры за ${period} дн.: устройств ${devs.length}, игроков ${castles}, пачек ${devs.reduce((a, d) => a + d.n, 0)}, игры ${hours(devs.reduce((a, d) => a + d.span, 0))}.`,
    '',
    'Кадры в секунду — медиана · худшие 5 %:',
  ];
  for (const p of PERF_PLACES) {
    const own = devs.filter((d) => d.fps[p]);
    if (!own.length) continue;
    const h = own.reduce((a, d) => addHist(a, d.fps[p]), {} as Hist);
    lines.push(`${PLACE_WORD[p]} ${fpsPair(h)} (устр. ${own.length}, кадров ${big(framesOf(h))})`);
  }
  // По классам — город и карта: карта — ради замера «до и после» свободной камеры (ПН-00, решение С3: худшие 5 % кадров
  // карты у слабого Android не хуже прежнего; docs/gdd/path_of_sword.md, 3.5.7). За те же 7 дней, что вся сводка.
  for (const [place, head] of [
    [TOWN, 'Город по классам устройств:'],
    [MAP, 'Карта по классам устройств:'],
  ] as const) {
    const classes = new Map<string, { h: Hist; n: number }>();
    for (const d of devs) {
      const h = d.fps[place];
      if (!h) continue;
      const c = classes.get(classOf(d.dev)) ?? { h: {}, n: 0 };
      addHist(c.h, h);
      c.n++;
      classes.set(classOf(d.dev), c);
    }
    if (!classes.size) continue;
    lines.push('', head);
    for (const [c, v] of [...classes].sort((a, b) => a[0].localeCompare(b[0]))) lines.push(`${c} ${fpsPair(v.h)} (устр. ${v.n})`);
  }
  const lv = (q: string): number => devs.filter((d) => d.q === q).length;
  lines.push('', `Уровень графики сейчас: высокий ${lv('high')}, средний ${lv('medium')}, низкий ${lv('low')}; выбран рукой у ${devs.filter((d) => d.set !== 'auto').length}.`);
  const drops = devs.flatMap((d) => d.drops);
  lines.push(drops.length ? `Сторож опустил: ${dropLine(drops)}.` : 'Сторож не опускал ни разу.');
  const fr = devs.flatMap((d) => d.freeze);
  if (fr.length) {
    const ms = fr.map((f) => f.ms);
    lines.push(`Замирание при возврате (случаев ${fr.length}): медиана ${secs(quantile(ms, 0.5) ?? 0)}, худшее ${secs(Math.max(...ms))} (пересборок сцены ${fr.filter((f) => f.k === 'rebuild').length}).`);
  } else lines.push('Замираний при возврате не было.');
  const first = devs.flatMap((d) => d.first);
  const ready = devs.flatMap((d) => d.ready);
  if (first.length) {
    lines.push(
      `Первый кадр города: медиана ${secs(quantile(first, 0.5) ?? 0)}, худшие 5 % ${secs(quantile(first, 0.95) ?? 0)}` +
        (ready.length ? `; город встал: медиана ${secs(quantile(ready, 0.5) ?? 0)}.` : '.'),
    );
  }
  const longs = devs.filter((d) => d.long);
  if (longs.length) {
    const n = longs.reduce((a, d) => a + (d.long?.n ?? 0), 0);
    const span = longs.reduce((a, d) => a + d.span, 0);
    lines.push(`Длинные задачи (Android и ПК): ${(n / Math.max(1, span / 60_000)).toFixed(1)} в минуту, самая долгая ${secs(Math.max(...longs.map((d) => d.long?.max ?? 0)))}.`);
  }
  const err = devs.reduce((a, d) => a + d.err, 0);
  lines.push(`Ошибок JS: ${err}${err ? ` (у ${devs.filter((d) => d.err).length} устр.)` : ''}.`);

  // Худшие — по худшим 5 % кадров города; у кого города мало, по самому тяжёлому месту с достатком кадров.
  const worst = devs
    .map((d) => {
      const places = PERF_PLACES.filter((p) => d.fps[p] && framesOf(d.fps[p] as Hist) >= MIN_FRAMES);
      const town = d.fps[TOWN];
      const p = town && framesOf(town) >= MIN_FRAMES ? TOWN : places.sort((a, b) => (gapAt(d.fps[b] as Hist, 0.95) ?? 0) - (gapAt(d.fps[a] as Hist, 0.95) ?? 0))[0];
      return p ? { d, p, gap: gapAt(d.fps[p] as Hist, 0.95) ?? 0 } : null;
    })
    .filter((x): x is { d: DevSum; p: PerfPlace; gap: number } => x !== null)
    .sort((a, b) => b.gap - a.gap)
    .slice(0, 5);
  if (worst.length) {
    lines.push('', 'Худшие устройства (худшие 5 % кадров):');
    worst.forEach((w, i) => lines.push(`${i + 1}. ${fpsPair(w.d.fps[w.p] as Hist)} ${PLACE_WORD[w.p]} — ${classOf(w.d.dev)}: ${deviceLine(w.d.dev)} · замок ${w.d.castle}`));
  }
  lines.push('', '/perf <кто> — устройство и цифры игрока.');
  return lines.join('\n');
}

/** `/perf <кто>`: по каждому его устройству — что за устройство и его цифры. `when` — время словами для админа. */
export function perfOfPlayer(days: PerfDay[], head: string, period: number, when: (ms: number) => string): string {
  const devs = byDevice(days);
  if (!devs.length) return `${head}\nЗамеров за ${period} дн. нет: не заходил с телефона в Telegram, выключил замеры в настройках или ещё не прислал первую пачку.`;
  const lines = [`${head} — замок ${devs[0].castle}, за ${period} дн.`];
  for (const d of devs) {
    lines.push(
      '',
      `Устройство: ${deviceLine(d.dev)} — ${classOf(d.dev)}.`,
      `Версия: ${d.build || '—'}. Последняя пачка ${when(d.at)}; пачек ${d.n}, игры ${hours(d.span)}.`,
    );
    const places = PERF_PLACES.filter((p) => d.fps[p]);
    if (places.length) {
      lines.push('Кадры в секунду — медиана · худшие 5 %:');
      for (const p of places) lines.push(`${PLACE_WORD[p]} ${fpsPair(d.fps[p] as Hist)} (кадров ${big(framesOf(d.fps[p] as Hist))})`);
    }
    lines.push(`Уровень сейчас: ${d.q ? TIER_WORD[d.q] : '—'} (выбор: ${TIER_WORD[d.set]}).`);
    if (d.drops.length) lines.push(`Сторож опустил: ${d.drops.slice(-5).map((x) => `${when(x.at)} ${PLACE_WORD[x.p]} ${TIER_WORD[x.f] ?? x.f}→${TIER_WORD[x.t] ?? x.t}`).join('; ')}.`);
    if (d.freeze.length) lines.push(`Замирание при возврате: ${d.freeze.slice(-5).map((x) => `${secs(x.ms)}${x.k === 'rebuild' ? ' (пересборка)' : ''} ${when(x.at)}`).join('; ')}.`);
    if (d.first.length) lines.push(`Первый кадр города: ${d.first.slice(-5).map(secs).join(', ')}${d.ready.length ? `; город встал: ${d.ready.slice(-5).map(secs).join(', ')}` : ''}.`);
    lines.push(
      `${d.long ? `Длинные задачи: ${d.long.n}, всего ${secs(d.long.ms)}, самая долгая ${secs(d.long.max)}` : 'Длинные задачи: браузер не меряет'}. Ошибок JS: ${d.err}.`,
    );
  }
  return lines.join('\n');
}
