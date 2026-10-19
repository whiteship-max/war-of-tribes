// Лестница участи словами: как называется ступень и что о ней пишет отчёт.
//
// Считать здесь нечего: числа приходят готовыми из двери участи (`spoils.fate`), и
// модуль только расставляет их по строкам. Слова о людях — уведённых и
// разошедшихся — берутся у `game/data/order.ts`: тон этих строк один на всю игру и
// проверяется тестом, который читает и тот модуль, и этот.
import type { Fate } from '../types';
import { ORDER_TEXT, bondedWord, townsWord } from '@/game/data/order';
import type { FateResult } from '../spoils';
import type { IconName } from '@/ui/icons/alias';

export interface FateMeta {
  /** Название ступени — одно на выбор, окно и отчёт. */
  name: string;
  icon: IconName;
  /** Заголовок отчёта проигравшему, когда город взят приступом. */
  title: string;
}

export const FATE_META: Record<Fate, FateMeta> = {
  plunder: { name: 'Ограбить', icon: 'ui-loot', title: 'Город разграбили' },
  captives: { name: 'Увести людей', icon: 'ui-chain', title: 'Город разграбили и увели людей' },
  burn: { name: 'Сжечь', icon: 'ui-flame', title: 'Город сожгли' },
};

/**
 * Что потерял взятый город — одной строкой для отчёта проигравшему. Начинается с
 * заглавной и кончается точкой; к ней дописывают, кто и как взял город.
 *
 * Про сгоревшую стройку строки нет нарочно: что строилось, знает племя, а не мир, и
 * пишет это оно само — только когда стройка была (`expedition.burnWorks`).
 */
export function lossText(f: Fate, r: FateResult): string {
  const gold = r.lost.gold ?? 0;
  const goods = r.lostTotal - gold;
  const hidden = r.hiddenTotal > 0 ? ` В тайнике уцелело ${r.hiddenTotal}.` : '';
  if (f === 'burn') {
    const pop = r.scattered.pop > 0 ? ` Разошлись ${r.scattered.pop} ${townsWord(r.scattered.pop)}.` : '';
    const bonded = r.scattered.bonded > 0 ? ` Разбежались ${r.scattered.bonded} ${bondedWord(r.scattered.bonded)}.` : '';
    return `Сгорело ${goods} запасов${gold > 0 ? ` и ${gold} золота` : ''}.${hidden}${pop}${bonded}`;
  }
  const people = [
    r.ledBonded.taken > 0 ? `${r.ledBonded.taken} ${bondedWord(r.ledBonded.taken)}` : '',
    r.ledPop.taken > 0 ? `${r.ledPop.taken} ${townsWord(r.ledPop.taken)}` : '',
  ].filter(Boolean);
  const led = people.length > 0 ? ` Увели ${people.join(' и ')}.` : '';
  return `Склад вычистили на ${goods} запасов${gold > 0 ? ` и ${gold} золота` : ''}.${hidden}${led}`;
}

/** Что досталось победителю — одной строкой для отчёта о взятом городе. */
export function gainText(r: FateResult): string {
  const gold = r.taken.gold ?? 0;
  const goods = r.takenTotal - gold;
  const led = r.ledBonded.taken + r.ledPop.taken;
  return (
    (goods > 0 ? ` Взято запасов ${goods}.` : '') +
    (gold > 0 ? ` Золота ${gold}.` : '') +
    (led > 0 ? ` ${ORDER_TEXT.broughtIn(led)}` : '')
  );
}
