// Уровень карты нового вида (docs/map_tw.md, раздел 7): адрес (`?quality=`) сильнее выбора игрока, «Авто» — по
// устройству. Отдельно от `spec.ts`: этот модуль читает настройки и окно, а таблица уровней едет и в рабочий поток.
import { autoQuality, qualityOf, type DeviceCaps, type Quality } from '@/render/quality';
import { gfx } from '@/render/gfx';

/**
 * Возможности устройства без видеокарты: у 2D-карты WebGL нет, и спрашивать его ради уровня незачем.
 * Без имени видеокарты `autoQuality` решает по указателю и памяти: телефон — средний, настольный —
 * высокий (`render/quality.ts`).
 */
function caps(): DeviceCaps {
  const nav = (typeof navigator === 'undefined' ? {} : navigator) as { deviceMemory?: number; hardwareConcurrency?: number };
  return {
    coarse: typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches,
    memory: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
    cores: typeof nav.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : null,
    gpu: null,
  };
}

/** Уровень карты: адрес (`?quality=`) сильнее выбора игрока, «Авто» — по устройству. */
export function twQuality(search = typeof location === 'undefined' ? '' : location.search): Quality {
  const asked = qualityOf(new URLSearchParams(search).get('quality'));
  if (asked) return asked;
  const chosen = gfx().quality;
  return chosen === 'auto' ? autoQuality(caps()) : chosen;
}
