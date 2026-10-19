// Уровень карты нового вида (docs/map_tw.md, раздел 7): тот же, что у всей игры (`gfx.levelNow`) — адрес (`?quality=`)
// сильнее выбора игрока, «Авто» — уровень города (он знает видеокарту и опущен сторожем, если телефон не потянул).
// Отдельно от `spec.ts`: этот модуль читает настройки и окно, а таблица уровней едет и в рабочий поток.
//
// Сторож плавности карты (К-1, docs/telemetry.md) — здесь же: карта, не тянущая кадра, опускает **свой** кадр (плотность
// холста, убранство, шаг стоя — `mapLevel`), а не выпечку земли и не город.
import { QUALITIES, VILLAGE_STEADY, type Quality } from '@/render/quality';
import { capQuality, gfx, gfxStamp, levelNow, sceneGfx } from '@/render/gfx';
import { Steady } from '@/render/steady';

/**
 * Адрес страницы — один на заход: игра его не меняет (ни `pushState`, ни `replaceState`), а чтение `location.search` —
 * новая строка из DOM на каждый вопрос уровня (К-1, профиль кадра).
 */
const SEARCH = typeof location === 'undefined' ? '' : location.search;
const here = (): string => SEARCH;

/**
 * Уровень игры, прочитанный при последней перемене (`gfx.gfxStamp`). Прежде кадр карты спрашивал `levelNow` по пять раз —
 * плотность, шаг стоя, прибой, облака, дым, — и каждый вопрос читал хранилище, разбирал адрес и, пока города нет,
 * спрашивал устройство (К-1).
 */
let memo: { stamp: number; search: string; level: Quality; asked: boolean } | null = null;

function read(search: string): { level: Quality; asked: boolean } {
  const stamp = gfxStamp();
  if (!memo || memo.stamp !== stamp || memo.search !== search) memo = { stamp, search, level: levelNow(search), asked: sceneGfx(gfx(), search).asked };
  return memo;
}

/** Уровень карты: тот же, что у города (docs/perf.md). По нему печётся земля (`hook.syncLook`). */
export function twQuality(search = here()): Quality {
  return read(search).level;
}

// ---------- Сторож плавности карты ----------

/**
 * Докуда сторож опустил кадр карты за этот заход в игру; null — не опускал. Живёт до перезагрузки страницы, а не неделю,
 * как память сторожа города (`gfx.rememberAutoCap`): цена кадра карты — заливка 2D-холста, а не сцена города, и опущенная
 * карта не повод неделю держать город на низком.
 */
let cap: Quality | null = null;
let guard: Steady<Quality> | null = null;

/**
 * Уровень кадра карты: уровень игры, не выше того, до чего опустил сторож карты. Им — плотность холста (`QUALITY.mapDpr`),
 * шаг стоя (`mapStepFps`), прибой, облака, дым и огни (`alive.ts`, `clouds.ts`). Выпечка земли — по `twQuality`: сменить её
 * посреди рывков значило бы перепечь весь регион ровно тогда, когда телефону и так тяжело.
 */
export function mapLevel(search = here()): Quality {
  return capQuality(twQuality(search), cap);
}

/**
 * Промежуток очередного кадра карты в непрерывном ходе (`FrameLoop.gap`; 0 — первый кадр хода, не судится). Правило — то
 * же, что у города (`quality.VILLAGE_STEADY`): второго судьи «тянет ли телефон» нет. Уровень задан игроком или адресом —
 * сторожа нет, как у города. Вернёт новый уровень кадра, если опустил.
 */
export function watchMap(gap: number, search = here()): Quality | null {
  if (gap <= 0 || read(search).asked) return null;
  const now = mapLevel(search);
  if (!guard) guard = new Steady(QUALITIES, now, VILLAGE_STEADY);
  else if (guard.tier !== now) guard.set(now);
  const next = guard.feed(gap);
  if (next) cap = next;
  return next;
}

/** Сторож с чистого листа — тестам. */
export function resetMapGuard(): void {
  cap = null;
  guard = null;
  memo = null;
}
