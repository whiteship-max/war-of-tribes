/**
 * Синхронизация прогресса с сервером.
 *
 * Правило, из которого следует всё остальное: **локальное сохранение остаётся
 * рабочей копией, сервер — местом синхронизации, а не условием запуска.** Игра
 * поднимается с диска и играется целиком без сети; всё, что делает этот модуль,
 * происходит потом и в стороне. Ни одна серверная неудача не имеет права
 * помешать играть: ни белым экраном, ни бесконечным ожиданием, ни потерянным
 * ходом. Поэтому здесь нет ни одного ожидания, которого ждёт запуск, и ни одной
 * ветки, которая заканчивалась бы исключением наружу.
 *
 * Второе правило: **сервер — единственная правда, локальная копия — его
 * продолжение.** Отсюда две разные вещи, которые нельзя путать:
 *
 *   - копия выросла из той же серверной записи и просто ушла дальше — это не
 *     расхождение, а обычная игра, в том числе целый вечер без сети. Она
 *     уезжает на сервер сама и молча, и терять здесь нечего;
 *   - обе копии выросли из одной базы врозь (играли с двух устройств) — вот это
 *     расхождение, и решается оно в пользу серверной. Тоже молча.
 *
 * Вопроса игроку нет ни в каком виде, и окна выбора нет: первая минута новой
 * игры не должна начинаться с разбирательства. Но **прогресс и от этого не
 * пропадает**: отвергнутая копия ложится на устройство (`spare`), и достать её
 * можно в «Заданиях», в «Служебном». Тихо стереть её — нельзя; тихо предпочесть
 * серверную — можно, потому что сервер и есть то место, где партия живёт.
 *
 * Чего здесь нет и не появится по дороге: сервер ничего не проверяет и ничего
 * не начисляет. Он хранит две непрозрачные строки и раздаёт своё «сейчас».
 * Алмазов, наград и права судить у него нет — это отдельная работа, и делать
 * её надо целиком, а не намёком отсюда.
 */
import { create } from 'zustand';
import type { ConflictResponse, PullResponse, PushResponse, SaveCard, SaveRecord } from '../../netlify/lib/contract';
import { adoptSave } from '@/game/save';
import type { GameState } from '@/game/types';
import { browserStorage } from '@/world/local/state';
import { tgInitData } from '@/telegram/webapp';
import { apiGet, apiPut, type ApiFail } from './api';
import { serverNow } from './clock';
import { beatLease, claimLease, dropLease, leaseHolder, LEASE_BEAT_MS } from './session';
import { snapshotOf } from './snapshot';

const META_KEY = 'tribe.sync.v1';
const SPARE_KEY = 'tribe.sync.spare.v1';

/** Как часто партия уезжает на сервер. Реже автосохранения на диск — нарочно. */
export const PUSH_MS = 60_000;

/**
 * Где мы сейчас.
 *
 * `off` — синхронизации нет и не будет в этой сессии: играют вне Telegram или
 * на хостинге нет серверной части. Это не поломка, и говорить о ней надо
 * спокойно.
 */
export type SyncState = 'off' | 'busy' | 'ok' | 'offline' | 'taken';

/** Отвергнутая копия. Лежит на устройстве, чтобы её можно было вернуть. */
export interface Spare {
  card: SaveCard;
  at: number;
  game: string;
  world: string | null;
}

export interface SyncStore {
  state: SyncState;
  /** Почему так — одной строкой, словами игрока. */
  why: string;
  /** Когда в последний раз сошлось. */
  lastOk: number | null;
  /** Отвергнутая партия, если она есть. */
  spare: Spare | null;
  /** Забрать ведение партии у другой вкладки. */
  takeOver: () => void;
  /** Вернуть отвергнутую партию. */
  restoreSpare: () => void;
  /** Забыть отвергнутую партию: игрок сказал, что она не нужна. */
  forgetSpare: () => void;
}

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const write = (key: string, value: string | null): void => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* localStorage может быть недоступен */
  }
};

/** Чем эта копия кончилась в прошлый раз: поверх какой серверной записи мы легли. */
interface Meta {
  etag: string | null;
  rev: number;
}

function readMeta(): Meta | null {
  const raw = read(META_KEY);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<Meta>;
    return typeof v.rev === 'number' ? { etag: typeof v.etag === 'string' ? v.etag : null, rev: v.rev } : null;
  } catch {
    return null;
  }
}

const writeMeta = (m: Meta): void => write(META_KEY, JSON.stringify(m));

function readSpare(): Spare | null {
  const raw = read(SPARE_KEY);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<Spare>;
    return typeof v.game === 'string' && v.card ? (v as Spare) : null;
  } catch {
    return null;
  }
}

const keepSpare = (record: SaveRecord, at: number): void =>
  write(SPARE_KEY, JSON.stringify({ card: record.card, at, game: record.game, world: record.world } satisfies Spare));

/** Слова для игрока по причине отказа. Технических подробностей здесь нет. */
const WORDS: Record<ApiFail, string> = {
  offline: 'Нет связи с сервером. Играй дальше — сохраним, когда связь вернётся.',
  auth: 'Telegram не подтвердил вход. Прогресс сохраняется только на этом устройстве.',
  conflict: 'На сервере партию продолжили с другого устройства.',
  busy: 'Слишком часто. Следующая попытка через минуту.',
  server: 'Сервер не принял сохранение. Играй дальше — попробуем ещё раз.',
};

/**
 * Откуда брать нынешнее состояние партии.
 *
 * Отдаётся снаружи, а не импортируется отсюда: стор игры уже зовёт
 * синхронизацию, и обратный импорт замкнул бы кольцо. Заодно видно, что
 * синхронизация про игру не знает ничего — ей отдают строку.
 */
let source: (() => GameState) | null = null;

export const provideGame = (fn: () => GameState): void => {
  source = fn;
};

const mine = (): SaveRecord | null => (source ? snapshotOf(source()) : null);

let timer: ReturnType<typeof setInterval> | null = null;
let pushing = false;

const say = (state: SyncState, why: string): void => useSync.setState({ state, why });

/**
 * Взять серверную партию: положить обе строки на диск и перезапустить игру.
 *
 * `spare` — копия, которую эта серверная запись собой заменяет. Она ложится
 * рядом **только если замена состоялась**: сохранение с сервера может оказаться
 * младше `MIN_SAVE_VERSION` и не прочитаться, и тогда на устройстве всё
 * остаётся как было, а «отклонённая партия» из ниоткуда только сбивала бы с
 * толку — она и есть та, в которую игрок сейчас играет.
 */
function adopt(record: SaveRecord, etag: string | null, spare: SaveRecord | null = null): void {
  if (!adoptSave(record.game)) {
    say('offline', 'Сохранение с сервера не читается этой версией игры. Партия на устройстве не тронута.');
    return;
  }
  if (spare) keepSpare(spare, serverNow());
  if (record.world) browserStorage.write(record.world);
  else browserStorage.clear?.();
  writeMeta({ etag, rev: record.rev });
  // Перезапуск, а не подмена состояния на ходу: партию держат стор игры, стор
  // карты, сцена и таймеры, и заменить их всех разом посреди кадра нечем.
  location.reload();
}

/** Отправить нынешнюю партию поверх записи `baseEtag`. */
async function push(baseEtag: string | null): Promise<void> {
  const record = mine();
  if (!record || pushing) return;
  pushing = true;
  try {
    const res = await apiPut<PushResponse>('/api/save', { baseEtag, record });
    if (res.ok) {
      writeMeta({ etag: res.data.etag, rev: res.data.rev });
      useSync.setState({ state: 'ok', why: '', lastOk: serverNow() });
      return;
    }
    if (res.why === 'conflict') {
      // Пока мы играли, поверх нашей записи легла чужая — то есть партию ведут
      // с другого устройства. Правда лежит на сервере: берём её, а свою кладём
      // рядом отвергнутой. Спрашивать здесь нечего, но и терять нечего тоже.
      const body = res.body as ConflictResponse | null;
      if (body?.record) {
        adopt(body.record, body.etag, record);
        return;
      }
      say('offline', WORDS.offline);
      return;
    }
    if (res.why === 'auth') {
      say('off', WORDS.auth);
      return;
    }
    // «Слишком часто» — это не беда: следующая попытка через `PUSH_MS`, а на диске
    // партия уже лежит. Тревожить этим игрока незачем.
    say(res.why === 'busy' ? 'ok' : 'offline', WORDS[res.why]);
  } finally {
    pushing = false;
  }
}

export const useSync = create<SyncStore>((set, get) => ({
  state: 'off',
  why: '',
  lastOk: null,
  spare: null,

  takeOver: () => {
    claimLease();
    location.reload();
  },

  restoreSpare: () => {
    const sp = get().spare;
    if (!sp) return;
    if (!adoptSave(sp.game)) return;
    if (sp.world) browserStorage.write(sp.world);
    else browserStorage.clear?.();
    // Отметка о том, чему наследует эта копия, **остаётся**: она указывает на
    // ту самую серверную запись, которая её и вытеснила. Значит при следующем
    // запуске возвращённая партия — продолжение серверной (`continue`), и она
    // уедет наверх. Сотри отметку — и правило «сервер главнее» тут же вернуло бы
    // её обратно в отвергнутые, то есть кнопка «Вернуть» не делала бы ничего.
    write(SPARE_KEY, null);
    location.reload();
  },

  forgetSpare: () => {
    write(SPARE_KEY, null);
    set({ spare: null });
  },
}));

/**
 * Часы вкладки: подновляют ведение и раз в `PUSH_MS` отправляют партию.
 *
 * Один таймер на оба дела нарочно. Ведение и отправка связаны: перестав вести
 * партию, вкладка обязана перестать и отправлять — иначе она затрёт на сервере
 * то, что пишет вкладка, которую игрок выбрал.
 */
function startBeat(): void {
  if (timer) return;
  let waited = 0;
  timer = setInterval(() => {
    if (!beatLease()) {
      say('taken', 'Партию продолжили в другой вкладке. Здесь она больше не сохраняется.');
      if (timer) clearInterval(timer);
      timer = null;
      return;
    }
    if (useSync.getState().state === 'off') return;
    waited += LEASE_BEAT_MS;
    if (waited < PUSH_MS) return;
    waited = 0;
    void push(readMeta()?.etag ?? null);
  }, LEASE_BEAT_MS);
  window.addEventListener('beforeunload', dropLease);
}

/** Что делать с двумя копиями при запуске. */
export type Verdict =
  /** На сервере пусто: кладём свою как первую. */
  | 'first'
  /** Своей нет: берём серверную, спорить не с чем. */
  | 'adopt'
  /** Серверная — наша же предыдущая: местная копия её продолжает, кладём поверх. */
  | 'continue'
  /** Две партии выросли врозь: берём серверную, свою откладываем. */
  | 'yield';

/**
 * Всё правило встречи двух копий — одной чистой функцией, чтобы его можно было
 * прочесть целиком и проверить тестом. Ошибиться здесь дороже всего: любая из
 * четырёх веток, поставленная не туда, стирает вечер игры.
 *
 * `knownEtag` — какой серверной записи наследует копия на этом устройстве.
 * Совпал с тем, что лежит на сервере, — значит с прошлого раза туда никто
 * другой не писал, и наша копия честно **продолжает** серверную, сколько бы
 * она за это время ни ушла вперёд. Ровно так выглядит игра без сети, и никакого
 * расхождения в ней нет: одна линия, счётчик побольше. Не совпал (или его нет
 * вовсе — на этом устройстве ещё не синхронизировались) — значит партий стало
 * две.
 *
 * **Пустая отметка — это не совпадение, а незнание, и читается она как
 * расхождение.** Соблазн прочесть её как «наследую тому, что лежит» велик и
 * стоил бы дорого: устройство, ни разу не синхронизировавшееся, молча затирало
 * бы чужую партию своей. Не знаем — уступаем серверу, а свою кладём рядом.
 */
export function decide(a: { hasLocal: boolean; remoteEtag: string | null; knownEtag: string | null }): Verdict {
  if (a.remoteEtag === null) return 'first';
  if (!a.hasLocal) return 'adopt';
  return a.knownEtag !== null && a.knownEtag === a.remoteEtag ? 'continue' : 'yield';
}

/**
 * Запуск синхронизации. Зовётся после того, как партия уже загружена с диска и
 * игра уже идёт: сеть не имеет права стоять на пути к первому кадру.
 *
 * `hadLocal` — было ли на диске сохранение в момент запуска. Разница
 * принципиальная: если своей партии не было, чужую берут молча — терять нечего;
 * если была — спрашивают.
 */
export async function syncBoot(hadLocal: boolean): Promise<void> {
  // Ведение партии — раньше всего остального: вторая вкладка не должна ни
  // писать на диск, ни разговаривать с сервером.
  if (leaseHolder() === 'other') {
    say('taken', 'Игра уже открыта в другой вкладке. Здесь она не сохраняется.');
    return;
  }
  claimLease();
  useSync.setState({ spare: readSpare() });
  startBeat();

  if (!tgInitData()) {
    // Вне Telegram личности нет, выдумывать её нельзя, и складывать прогресс
    // некуда, кроме диска. Это не поломка — так игра и работает в браузере.
    say('off', 'Игра открыта не из Telegram: прогресс лежит только на этом устройстве.');
    return;
  }

  say('busy', '');
  const res = await apiGet<PullResponse>('/api/save');
  if (!res.ok) {
    say(res.why === 'auth' ? 'off' : 'offline', WORDS[res.why]);
    return;
  }
  const { record, etag } = res.data;
  const here = mine();
  if (!here) return;

  switch (decide({ hasLocal: hadLocal, remoteEtag: record ? etag : null, knownEtag: readMeta()?.etag ?? null })) {
    case 'first':
      // На сервере пусто: это первый заход. Кладём свою партию как есть.
      await push(null);
      return;
    case 'adopt':
      // Своей партии на устройстве не было — данные чистили или это новое
      // устройство. Серверную можно брать без вопроса: спорить не с чем.
      if (record) adopt(record, etag);
      return;
    case 'continue':
      // На сервере лежит ровно то, что клали мы. Наша копия — её продолжение,
      // и она уезжает наверх: так и возвращается вечер игры без сети.
      await push(etag);
      return;
    case 'yield':
      // Партии выросли врозь — играли с двух устройств. Правда лежит на
      // сервере; своя копия не пропадает, а ложится рядом отвергнутой и
      // достаётся в «Заданиях» → «Служебное».
      if (record) adopt(record, etag, here);
      return;
  }
}

/** Можно ли этой вкладке писать партию — на диск и на сервер. */
export const mayWrite = (): boolean => useSync.getState().state !== 'taken';
