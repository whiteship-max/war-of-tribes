// Уровень карты нового вида (docs/map_tw.md, раздел 7): тот же, что у всей игры (`gfx.levelNow`) — адрес (`?quality=`)
// сильнее выбора игрока, «Авто» — уровень города (он знает видеокарту и опущен сторожем, если телефон не потянул).
// Отдельно от `spec.ts`: этот модуль читает настройки и окно, а таблица уровней едет и в рабочий поток.
import { type Quality } from '@/render/quality';
import { levelNow } from '@/render/gfx';
import { serverNow } from '@/net/clock';

/** Уровень карты: тот же, что у города (docs/perf.md). */
export function twQuality(search = typeof location === 'undefined' ? '' : location.search): Quality {
  return levelNow(search, serverNow());
}
