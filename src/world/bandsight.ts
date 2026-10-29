// Чужие отряды бродяг глазами игрока (ПН-4у, docs/gdd/path_of_sword.md, 3.5.4 и «Решения ПН-4у»): живые и следы, кто видит свой
// отряд, весть «Нас видели». Своим куском: подключает его мир только за `ROAM_ON` (`world/store`), в первую загрузку он не едет.
//
// Кто кого видит, решает сервер (`netlify/lib/bandsight.ts`) той же дверью `world/sight`, что знает игра; сюда приходит его ответ
// (`net/roster.provideSightSink`). Обнаружен — отряд живьём: клетка, люди, колонна или лагерь. Не обнаружен — его нет вовсе. Видели и
// потеряли — **след**: место и давность, тем же правилом, что снимок поселения (`SettlementView.visible`, `seenAt`, `stale`): вне
// обзора показывается последнее увиденное с отметкой давности. След живёт на устройстве своим ключом и эпохой (как строка отряда в
// реестре клиента), не в сохранении мира: мир и карта лорда не меняются ни байтом.
//
// Без сервера (стенд, вторая вкладка) о чужих отрядах не знает никто, а кто видит свой отряд, отряд считает сам — той же дверью по
// замкам, которые помнит реестр (`ownSight`).
import { create } from 'zustand';
import { cityName, type BandView, type CastleView, type SeenBy, type SeenView } from '../../netlify/lib/contract';
import { provideSightSink, castles, type SightNews } from '@/net/roster';
import { knownEra } from '@/net/era';
import { useGame } from '@/game/store';
import { log } from '@/game/sim/log';
import { realTime } from '@/game/pace';
import type { GameState } from '@/game/types';
import { troopTotal } from '@/game/battle/kinds';
import { CASTLE_EYE, bandLook, conspicuity, detectRange, sees } from './sight';
import { roamCell } from './roam';

/** Чужой отряд на карте: живой (`visible`) или след (`stale`) — последнее увиденное и когда. */
export type BandMark = BandView & {
  visible: boolean;
  /** Когда видели в последний раз — часы сервера, мс. */
  seenAt: number;
  stale: boolean;
};

interface BandSight {
  marks: BandMark[];
  /** Кто видит свой отряд — слово сервера; `null` — сервер не говорил (вне Telegram или ещё нет ответа). */
  seen: SeenView | null;
  at: number;
}

export const useBandSight = create<BandSight>(() => ({ marks: [], seen: null, at: 0 }));

/** След живёт двое настоящих суток: дольше место отряда уже ничего не говорит. */
export const TRAIL_MS = realTime(2 * 24 * 3_600_000);
/** Следов на устройстве — не больше этого: свежие вытесняют давние. */
export const TRAIL_MAX = 24;
/** Весть «Нас видели» — не чаще раза в десять минут. */
export const NOTE_GAP_MS = realTime(10 * 60_000);
/** Тот же глаз — не чаще раза в шесть часов: отряд у замка, мимо которого ходит, не слышит о нём каждый заход. */
export const NOTE_SAME_MS = realTime(6 * 3_600_000);

const TRAIL_KEY = 'tribe.bandtrail.v1';
const NOTE_KEY = 'tribe.seennote.v1';

const readKey = <T>(key: string): T | null => {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? 'null') as { era?: number; v?: T } | null;
    return v && (v.era ?? 0) === knownEra() && v.v !== undefined ? v.v : null;
  } catch {
    return null;
  }
};
const writeKey = (key: string, v: unknown): void => {
  try {
    localStorage.setItem(key, JSON.stringify({ era: knownEra(), v }));
  } catch {
    /* хранилища может не быть — тогда памяти нет */
  }
};

/**
 * Новый ответ сервера: обнаруженные — живьём, пропавшие из обзора — следом (последнее увиденное и давность), давние следы уходят.
 * Чистая функция над прежними метками — её держит тест.
 */
export function mergeMarks(prev: readonly BandMark[], news: Pick<SightNews, 'bands' | 'at'>): BandMark[] {
  const live: BandMark[] = news.bands.map((b) => ({ ...b, visible: true, seenAt: news.at, stale: false }));
  const ids = new Set(live.map((b) => b.id));
  const trail = prev
    .filter((m) => !ids.has(m.id) && news.at - m.seenAt <= TRAIL_MS)
    .map((m): BandMark => (m.visible ? { ...m, visible: false, stale: true } : m))
    .sort((a, b) => b.seenAt - a.seenAt)
    .slice(0, TRAIL_MAX);
  return [...live, ...trail];
}

/** Кто видит словами: «город Катания (Андрей)», «отряд Ратко». */
function whoWords(b: SeenBy): string {
  if (b.kind !== 'castle') return `отряд ${b.name || 'без имени'}`;
  const city = cityName(b.city);
  return `${city ? `город ${city}` : 'замок'} (${b.name || 'без имени'})`;
}

/** Строка шапки: «Скрыт» или «Виден: …» — кем, если мы его видим, и сколько ещё глаз без имени. */
export function seenWords(seen: SeenView): string {
  if (seen.count <= 0) return 'Скрыт';
  const rest = seen.count - seen.by.length;
  const named = seen.by.map(whoWords).join(', ');
  if (!named) return rest === 1 ? 'Виден: кто — не разглядеть' : `Виден: ${rest} глаз, кто — не разглядеть`;
  return rest > 0 ? `Виден: ${named} и ещё ${rest}` : `Виден: ${named}`;
}

interface NoteMemory {
  last: number;
  by: Record<string, number>;
}

/** Какие глаза новые для вести: появились с прошлого ответа и давно не звучали. Без имени — одним ключом «?». */
export function freshEyes(seen: SeenView, prev: SeenView | null, memory: NoteMemory, at: number): { named: SeenBy[]; unnamed: boolean } {
  const before = new Set(prev?.by.map((b) => b.id) ?? []);
  const quiet = (id: string): boolean => at - (memory.by[id] ?? -Infinity) >= NOTE_SAME_MS;
  const named = seen.by.filter((b) => !before.has(b.id) && quiet(b.id));
  const was = prev ? prev.count - prev.by.length : 0;
  const unnamed = seen.count - seen.by.length > was && quiet('?');
  return { named, unnamed };
}

/**
 * Весть «Нас видели» — без спама: только о новых глазах, тот же глаз не чаще `NOTE_SAME_MS`, всё вместе не чаще `NOTE_GAP_MS`;
 * память — на устройстве, перезагрузка её не сбрасывает. Строкой летописи и всплывающей строкой. Вернёт текст вести или `null`.
 */
export function noteSeen(seen: SeenView | null, prev: SeenView | null, at: number, memory: NoteMemory): string | null {
  if (!seen || seen.count <= 0 || at - memory.last < NOTE_GAP_MS) return null;
  const { named, unnamed } = freshEyes(seen, prev, memory, at);
  if (named.length === 0 && !unnamed) return null;
  memory.last = at;
  for (const b of named) memory.by[b.id] = at;
  if (unnamed) memory.by['?'] = at;
  const who = named.map(whoWords).join(', ');
  return who ? `Нас видели: ${who}${unnamed ? ' — и ещё кто-то, не разглядели' : ''}.` : 'Нас видели — кто, не разглядели.';
}

function take(news: SightNews): void {
  const was = useBandSight.getState();
  const marks = mergeMarks(was.marks, news);
  writeKey(TRAIL_KEY, marks);
  useBandSight.setState({ marks, seen: news.seen, at: news.at });
  const memory = readKey<NoteMemory>(NOTE_KEY) ?? { last: 0, by: {} };
  const text = noteSeen(news.seen, was.seen, news.at, memory);
  if (!text) return;
  writeKey(NOTE_KEY, memory);
  const g = useGame.getState();
  g.world((s) => log(s, text, 'bad'));
  g.showToast(text);
}

let attached = false;

/** Подключить видимость: следы прошлых заходов — из памяти устройства (все — следами), ответы сервера — сюда. */
export function attach(): void {
  if (attached) return;
  attached = true;
  const kept = readKey<BandMark[]>(TRAIL_KEY) ?? [];
  useBandSight.setState({ marks: kept.map((m) => (m.visible ? { ...m, visible: false, stale: true } : m)) });
  provideSightSink(take);
}

/** Стенд и тесты: положить ответ сервера, как его положил бы реестр. */
export const takeNews = take;

// ---------- Свой отряд ----------

/**
 * Свой отряд в минуту `now`: на сколько клеток его видит круг замка (дверью `world/sight` по виду отряда — местность, лагерь, люди,
 * ход, ночь и сезон партии) и кто его видит — слово сервера, а без сервера — те же правила по замкам, которые помнит реестр.
 */
export function ownSight(s: GameState, now: number, server: SeenView | null): { range: number; seen: SeenView } | null {
  const r = s.roam;
  if (!r?.way) return null;
  const move = { way: r.way, camp: r.camp, ...(r.energy ? { energy: r.energy } : {}) };
  const look = bandLook(move, troopTotal(r.band), s.time, now);
  const c = conspicuity(look);
  const range = detectRange(CASTLE_EYE, c);
  if (server) return { range, seen: server };
  const at = roamCell(r.way, now);
  const by = castles().filter((k: CastleView) => sees({ kind: 'castle', at: { x: k.x, y: k.y } }, at, c));
  const named = by.map((k): SeenBy => {
    const city = cityName(k.city);
    return { kind: 'castle', id: k.id, name: k.name, ...(city ? { city } : {}) };
  });
  return { range, seen: { count: by.length, by: named } };
}
