// Отряд бродяги в реестре (ПН-3, ПН-4у) — половина реестра `net/roster` в куске пути (ПН-5, хвост а): докачивается только тому,
// кому путь открыт (`game/roamlazy`), и в первую загрузку игрока не едет. Реестр зовёт её одним крючком (`roamDoor().keepRoster`) и
// спрашивает, встал ли отряд (`bandRow`); приказы отряда, строка, которую вывел сервер, и видимость отрядов — здесь.
//
// Строка отряда: место выхода и ход выводит сервер (`roster.placeBandNew`, `bandOrder`), партия кладёт её одной дверью хода
// (`sim/roam.setMove`, провайдер — кусок пути). Видимость (ПН-4у): обнаружение считает сервер (`netlify/lib/bandsight.ts`, дверью
// `world/sight`); здесь — только доставка ответа тому, кто его ждёт (`provideSightSink` — кусок `world/bandsight`).
import type { BandOrder, BandRow, BandView, FreeView, RosterResponse, SeenView } from '../../netlify/lib/contract';
import { roamOn } from '@/game/roamflag';
import { bandSink } from '@/game/roamlazy';
import { apiPost } from './api';
import { knownEra } from './era';
import { keepRosterResponse, rosterFailWords } from './roster';

const BAND_KEY = 'tribe.band.v1';

function loadBand(): BandRow | null {
  try {
    const v = JSON.parse(localStorage.getItem(BAND_KEY) ?? 'null') as { era?: number; row?: BandRow } | null;
    return v && (v.era ?? 0) === knownEra() && v.row ? v.row : null;
  } catch {
    return null;
  }
}

/** Свой отряд: строка, которую вывел сервер, — память и кэш на устройстве (той же эпохи, что реестр). */
let band: BandRow | null = loadBand();

function keepBand(row: BandRow | null): void {
  if (!row) return;
  band = row;
  try {
    localStorage.setItem(BAND_KEY, JSON.stringify({ era: knownEra(), row }));
  } catch {
    /* хранилища может не быть — тогда памяти нет */
  }
  // Партия кладёт строку одной дверью хода — сток отдал стор (`game/roamlazy.provideBandSink`).
  bandSink()?.(row);
}

/** Свой отряд: строка, которую вывел сервер. null — не было. */
export const bandRow = (): BandRow | null => band;

/** Последний ответ сервера о видимости: чужие отряды, кто видит свой отряд, минута сервера. */
export interface SightNews {
  bands: BandView[];
  seen: SeenView | null;
  at: number;
}

let sight: SightNews | null = null;
let sightSink: ((v: SightNews) => void) | null = null;

/** Куда отдавать ответ о видимости; пришедший раньше отдаётся сразу. */
export const provideSightSink = (fn: ((v: SightNews) => void) | null): void => {
  sightSink = fn;
  if (fn && sight) fn(sight);
};

/** Вольные замки пула рядом (ПН-10): слово реестра тому, кому путь открыт; кто взял и что сожжено — из записи войн сервера. */
let free: FreeView[] = [];

/** Вольные замки пула рядом из последнего ответа реестра. */
export const freeCastles = (): FreeView[] => free;

/** Ответ реестра: строка отряда, видимость отрядов и вольные замки рядом. Зовёт реестр (`roster.keep`). */
export function keepRoster(res: RosterResponse): void {
  keepBand(res.band ?? null);
  free = res.free ?? [];
  sight = { bands: res.bands ?? [], seen: res.seen ?? null, at: res.now };
  sightSink?.(sight);
}

/**
 * Приказ отряда серверу: принят — строка отряда (она же ляжет в партию через `provideBandSink`), отказ — слова сервера или сети.
 */
export async function bandOrder(o: BandOrder): Promise<BandRow | string> {
  if (!roamOn()) return 'Путь меча ещё не открыт.';
  const res = await apiPost<RosterResponse>('/api/castles', o);
  if (!res.ok) return rosterFailWords(res.why);
  if (res.data.error) return res.data.error;
  keepRosterResponse(res.data);
  return res.data.band ?? 'Приказ не дошёл до отряда. Попробуй ещё раз.';
}
