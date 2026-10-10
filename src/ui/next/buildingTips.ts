// Подсказки окна постройки нового интерфейса — чистые функции (правило 18: числа — из функций игры, тест
// сверяет строку с ними, `building.test.ts`).
import type { Building, GameState } from '@/game/types';
import { BUILDING_BY_ID } from '@/game/data/buildings';
import { ORDER_TEXT } from '@/game/data/order';
import {
  bondedCount,
  buildingHousing,
  buildingSlots,
  buildingStat,
  buildingTitle,
  handsCount,
  townHallBuildMult,
  workerCount,
} from '@/game/derived';
import { dec } from '@/game/num';
import type { UpgradeGain } from '@/ui/parts/upgrade';
import { count } from '@/ui/parts/plural';
import type { TipContent } from './tip';

/**
 * Чем постройка занята сейчас — числами игры. У рабочего здания это люди на местах, у пассивного — то, что оно уже
 * даёт городу. `null` — сказать числом нечего. Строка ратуши (`TownBuild`) и подсказка окна постройки говорят одно.
 */
export function buildingFacts(s: GameState, b: Building): string | null {
  const slots = buildingSlots(b);
  if (slots > 0) {
    // Невольники стоят на тех же местах: занятые места — это все руки, а не одни вольные.
    const bonded = bondedCount(s, b.id);
    return bonded > 0
      ? `Рабочих: ${handsCount(s, b.id)}/${slots} · ${ORDER_TEXT.bondedIcon} ${bonded}`
      : `Рабочих: ${workerCount(s, b.id)}/${slots}`;
  }
  const facts: string[] = [];
  if (b.type === 'town_hall') facts.push(`стройка ×${dec(townHallBuildMult(s), 2)}`);
  const housing = buildingHousing(b);
  if (housing) facts.push(`жильё ${housing}`);
  const storage = buildingStat(b, 'storage');
  if (storage) facts.push(`вместимость +${storage}`);
  const defence = buildingStat(b, 'defense');
  if (defence) facts.push(`оборона +${defence}`);
  const morale = buildingStat(b, 'morale');
  if (morale) facts.push(`мораль +${morale}`);
  return facts.length > 0 ? facts.join(' · ') : null;
}

/**
 * Описание постройки по значку шапки окна — два слоя (docs/voice.md, 3): строка вкуса курсивом и строка дела, а за
 * ней — что постройка даёт сейчас, числами `buildingFacts` (без слова «сейчас»: строка числа — как в ратуше).
 */
export function buildingTip(s: GameState, b: Building): TipContent {
  const def = BUILDING_BY_ID[b.type];
  const now = buildingFacts(s, b);
  return {
    title: buildingTitle(s, b.type),
    lore: def.flavor,
    body: now ? `${def.description} ${now[0].toUpperCase()}${now.slice(1)}.` : def.description,
  };
}

/**
 * Подсказка по значку рабочих: сколько занято из скольких, сколько свободных рук в племени, дадут ли что-то
 * свободные места и сколько мест прибавит следующий уровень — замером `upgradeGains`, а не числом рядом.
 */
export function workerTip(job: string, hands: number, slots: number, free: number, gains: UpgradeGain[] | null, spareHelps: boolean): TipContent {
  const parts = [`Свободных рук в городе: ${free}.`];
  if (hands < slots && !spareHelps) parts.push('Выработка на потолке, новые руки ничего не дадут.');
  const more = gains?.find((g) => g.id === 'slots');
  if (more) parts.push(`Следующий уровень даст ещё ${count(more.after - more.before, 'место', 'места', 'мест')}.`);
  return { title: `${job} · ${hands} из ${slots}`, body: parts.join(' ') };
}
