/**
 * Общий реестр замков глазами игры: единственная дверь к тому, где стоят
 * живые игроки.
 *
 * Три правила, из которых следует всё остальное.
 *
 * 1. **Игра работает, когда сервера нет.** Реестр — не условие запуска: не
 *    приехал — карта показывает то, что помнит, и говорит словами, что список
 *    соседей устарел. Ни белого экрана, ни бесконечного ожидания; отсюда же
 *    кэш на устройстве, который переживает и отсутствие сети, и отсутствие
 *    Telegram.
 * 2. **Своё место не выбирают.** Клетку замка называет сервер, и приезжает она
 *    сюда же. Мир читает её отсюда синхронно (`castleCell`), потому что строится
 *    он синхронно, а спросить сеть в конструкторе нельзя.
 * 3. **Пишет только ведущая вкладка.** Ровно как отправка партии: вкладка,
 *    которой сказано «здесь она больше не сохраняется», не пишет и в реестр —
 *    иначе она объявляла бы миру своё имя и свою мощь из состояния, которое
 *    игрок не выбирал.
 *
 * Частота названа константами и другой быть не должна: своё уезжает раз в
 * `ROSTER_PUSH_MS`, чужое приезжает раз в `ROSTER_PULL_MS` и только пока открыта
 * карта. Пульс мира (`PULSE_MS` в `world/store.ts`) реестра не касается вовсе.
 */
import { create } from 'zustand';
import type { CastleClaim, CastleView, RosterResponse } from '../../netlify/lib/contract';
import { tgInitData } from '@/telegram/webapp';
import { realSpan } from '@/game/span';
import { apiGet, apiPut, type ApiFail } from './api';
import { serverNow } from './clock';
import { leaseHolder } from './session';

const KEY = 'tribe.castles.v1';

/** Как часто своя строка уезжает на сервер: имя, мощь и «был в игре». */
export const ROSTER_PUSH_MS = 5 * 60_000;

/** Как часто приезжает список соседей — и только пока открыта карта. */
export const ROSTER_PULL_MS = 60_000;

/**
 * Насколько старый список уже надо называть старым. Втрое дольше промежутка
 * между чтениями: одно пропущенное чтение — это сеть моргнула, три подряд —
 * это уже не «сейчас», и молчать об этом нельзя.
 */
export const ROSTER_STALE_MS = 3 * ROSTER_PULL_MS;

/** Клетка мира. Та же, что у `world/land.Spot`, — по устройству, не по импорту. */
export interface Cell {
  x: number;
  y: number;
}

/** Что лежит на устройстве. Кэш, а не место хранения правды. */
interface Cached {
  /** Когда список приехал, по серверным часам. */
  at: number;
  /** Отпечаток земли, на которой считаны клетки. */
  epoch: number;
  /** Своя клетка. null — замок ещё не поставлен. */
  mine: Cell | null;
  castles: CastleView[];
}

export type RosterState =
  /** Реестра в этой сессии не будет: играют вне Telegram или сервера нет. */
  | 'off'
  /** Спрашиваем. */
  | 'busy'
  /** Список свежий. */
  | 'ok'
  /** Список есть, но старый: сервер не отвечает. */
  | 'stale';

export interface RosterStore {
  state: RosterState;
  /** Почему так — одной строкой, словами игрока. */
  why: string;
  /** Когда список приехал в последний раз. null — ни разу. */
  at: number | null;
  /** Сколько чужих замков в списке. */
  count: number;
}

const WORDS: Record<ApiFail, string> = {
  offline: 'Нет связи. Соседи показаны по памяти.',
  auth: 'Игра открыта не из Telegram, соседей на карте нет.',
  conflict: 'Список соседей обновляется.',
  busy: `Слишком часто. Список обновится через ${realSpan(ROSTER_PULL_MS / 1000)}.`,
  server: 'Список соседей не пришёл. Показаны по памяти.',
  frozen: 'Аккаунт заморожен. Соседи показаны по памяти.',
};

export const useRoster = create<RosterStore>(() => ({ state: 'off', why: '', at: null, count: 0 }));

const read = (): string | null => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};

const write = (value: string): void => {
  try {
    localStorage.setItem(KEY, value);
  } catch {
    /* localStorage может быть недоступен — тогда кэша просто нет */
  }
};

function load(): Cached | null {
  const raw = read();
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<Cached>;
    if (typeof v.at !== 'number' || typeof v.epoch !== 'number' || !Array.isArray(v.castles)) return null;
    const mine = v.mine && typeof v.mine.x === 'number' ? { x: v.mine.x, y: v.mine.y } : null;
    return { at: v.at, epoch: v.epoch, mine, castles: v.castles };
  } catch {
    return null;
  }
}

/** Копия в памяти: её спрашивают на каждом пульсе мира, и лезть за ней на диск незачем. */
let cache: Cached | null = load();

function keep(res: RosterResponse, at: number): void {
  // Земля сменилась — всё, что помнили, относится к другой карте. Приводить
  // тут нечего: клетка 541|822 на новой земле — другое место.
  const next: Cached = { at, epoch: res.epoch, mine: res.mine, castles: res.castles };
  cache = next;
  write(JSON.stringify(next));
  useRoster.setState({ state: 'ok', why: '', at, count: res.castles.length });
}

/** Своя клетка: её назвал сервер. null — не называл ещё ни разу. */
export const castleCell = (): Cell | null => (cache ? cache.mine : null);

/** Чужие замки: что приехало в последний раз. Пусто — реестра не было вовсе. */
export const castles = (): CastleView[] => cache?.castles ?? [];

/** Когда список приехал. null — ни разу за всё время на этом устройстве. */
export const castlesAt = (): number | null => cache?.at ?? null;

/** Список старый: сервер давно не отвечал. Об этом говорят словами, а не молчат. */
export const castlesStale = (now: number): boolean => cache === null || now - cache.at > ROSTER_STALE_MS;

/**
 * Откуда брать то, что игрок сообщает о себе. Отдаётся снаружи, как и у
 * синхронизации партии: реестр про игру не знает — ему приносят три числа.
 */
let claim: (() => CastleClaim) | null = null;

export const provideClaim = (fn: () => CastleClaim): void => {
  claim = fn;
};

const say = (state: RosterState, why: string): void => useRoster.setState({ state, why });

let pushTimer: ReturnType<typeof setInterval> | null = null;
let pullTimer: ReturnType<typeof setInterval> | null = null;
let talking = false;

/**
 * Больше этого мир клетку не ждёт ни при каких условиях.
 *
 * Срок с запасом к сроку запроса (`TIMEOUT_MS` в `api.ts`). Нужен он не от недоверия к сети, а
 * потому, что ждать может оказаться нечего вовсе: `rosterBoot` зовёт стор
 * племени, а мир поднимают и стенды, и отчёты, и тесты — там его никто не
 * звал, и бесконечное ожидание означало бы карту, которая не открывается.
 */
export const ROSTER_WAIT_MS = 9000;

/** Договорились ли уже с сервером — или решили, что его не будет. */
let over = false;
let settled: (() => void) | null = null;
let ready: Promise<void> | null = null;

const done = (): void => {
  over = true;
  settled?.();
  settled = null;
};

/**
 * Ждать, пока клетка замка не станет известна — или пока не станет ясно, что
 * сервера в этой сессии нет. Мир строится синхронно и обязан знать, где ставить
 * замок, **до** постройки: собранный не на том месте, он потом переписывался бы
 * под ногами у игрока.
 *
 * Кончается это ожидание **всегда**: разговором, отказом или сроком. Игры оно
 * не задерживает — деревня к этому времени давно на экране, а карту открывают
 * тапом много позже.
 */
export function rosterReady(): Promise<void> {
  if (over) return Promise.resolve();
  if (!ready) {
    ready = new Promise<void>((resolve) => {
      settled = resolve;
      const timer = setTimeout(done, ROSTER_WAIT_MS) as unknown as { unref?: () => void };
      // В Node таймер держал бы процесс живым до самого срока — отчётам и
      // тестам это ни к чему.
      timer.unref?.();
    });
  }
  return ready;
}

/** Отправить свою строку. Возвращает `true`, если сервер ответил. */
async function push(): Promise<boolean> {
  if (!claim || talking) return false;
  talking = true;
  try {
    const res = await apiPut<RosterResponse>('/api/castles', claim());
    if (res.ok) {
      keep(res.data, serverNow());
      return true;
    }
    say(res.why === 'auth' ? 'off' : cache ? 'stale' : 'off', WORDS[res.why]);
    return false;
  } finally {
    talking = false;
  }
}

/** Забрать список соседей. Ничего не пишет и ведения партии не спрашивает. */
export async function rosterPull(): Promise<void> {
  if (!tgInitData() || talking) return;
  talking = true;
  try {
    const res = await apiGet<RosterResponse>('/api/castles');
    if (res.ok) {
      keep(res.data, serverNow());
      return;
    }
    // Список не приехал — остаётся прежний, и он честно назван старым.
    say(res.why === 'auth' ? 'off' : cache ? 'stale' : 'off', WORDS[res.why]);
  } finally {
    talking = false;
  }
}

/**
 * Начало разговора с реестром. Зовётся после того, как партия уже загружена и
 * игра уже идёт: сеть не имеет права стоять на пути к первому кадру.
 */
export async function rosterBoot(): Promise<void> {
  // Вторая вкладка не пишет ничего — ни на диск, ни на сервер, ни в реестр.
  if (leaseHolder() === 'other') {
    say('off', 'Игра открыта в другой вкладке, соседей ведёт она.');
    done();
    return;
  }
  if (!tgInitData()) {
    // Вне Telegram личности нет, выдумывать её нельзя. Замок тогда стоит там,
    // куда его поставил бы мир сам, и чужих на карте нет — это не поломка.
    say('off', 'Игра открыта не из Telegram, соседей на карте нет.');
    done();
    return;
  }
  say('busy', '');
  await push();
  done();
  if (!pushTimer) {
    pushTimer = setInterval(() => {
      // Потеряла ведение — перестала писать. То же правило, что и у отправки
      // партии: иначе две вкладки объявляли бы миру разное.
      if (leaseHolder() === 'other') return;
      void push();
    }, ROSTER_PUSH_MS);
  }
}

/**
 * Читать список, пока открыта карта. Свой таймер и свой явный останов: за
 * закрытой картой чужие замки никому не нужны, а лишний запрос раз в
 * `ROSTER_PULL_MS` с каждого играющего — это уже нагрузка.
 */
export function startPulling(): void {
  if (pullTimer || !tgInitData()) return;
  void rosterPull();
  pullTimer = setInterval(() => void rosterPull(), ROSTER_PULL_MS);
}

export function stopPulling(): void {
  if (!pullTimer) return;
  clearInterval(pullTimer);
  pullTimer = null;
}

