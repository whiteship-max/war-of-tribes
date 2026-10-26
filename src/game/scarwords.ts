// Слова черт армии (ДР-4, docs/siege_v2.md, «Решения ДР-4», Ш9): как черта получена и как уходит — строкой летописи (её пишет шаг
// племени, поэтому слова здесь, в первой загрузке). Разбор в «Дружине» — `ui/parts/scarWords` (кусок «Дружины»). Числа берутся из
// таблицы правил (`scarrules`), своей арифметики у слов нет (правило 18).
import { ARCHERS_SEEN, ARROWS_HEAVY, HORSE_HEAVY, SCAR_BY_ID, type ScarId, type ScarTheme } from './scarrules';

/** Доля словами: «четверти», «пятой части», «десятой части». */
export function part(share: number): string {
  const n = Math.round(1 / share);
  return n === 2 ? 'половины' : n === 3 ? 'трети' : n === 4 ? 'четверти' : n === 5 ? 'пятой части' : n === 10 ? 'десятой части' : `доли ${n}`;
}

/** Где тема: «в лесу», «у реки»… — для боёв темы. */
export const THEME_WHERE: Record<ScarTheme, string> = {
  woods: 'в лесу',
  river: 'у реки',
  hills: 'в холмах',
  horse: `против войска, где конницы не меньше ${part(HORSE_HEAVY)}`,
  siege: 'в осадных боях',
  night: 'ночью',
  winter: 'зимой',
  hunger: 'голодными',
  arrows: `против войска, где лучников не меньше ${part(ARCHERS_SEEN)}`,
};

const COUNT = ['', 'одна', 'две', 'три', 'четыре', 'пять'];
const DEFEATS = ['', 'одно', 'два', 'три', 'четыре', 'пять'];

/** Как черта приходит — словами условия. */
export function gainWords(id: ScarId): string {
  const d = SCAR_BY_ID[id];
  const n = d.gain.need;
  switch (d.gain.by) {
    case 'wins':
      return d.theme === 'horse'
        ? `${COUNT[n]} победы подряд над войском, где конницы не меньше ${part(HORSE_HEAVY)} (стаи зверей не в счёт)`
        : `${COUNT[n]} победы подряд ${THEME_WHERE[d.theme]}`;
    case 'losses':
      return `${DEFEATS[n]} поражения подряд ${THEME_WHERE[d.theme]}`;
    case 'fled':
      return `войско бежало в бою ${THEME_WHERE[d.theme]}`;
    case 'hungry':
      return `${DEFEATS[n]} боя подряд на голодный желудок`;
    case 'arrows':
      return `стрелы выбили не меньше ${part(ARROWS_HEAVY)} войска в одном бою`;
  }
}

/** Как черта уходит — словами. */
export function loseWords(id: ScarId): string {
  const d = SCAR_BY_ID[id];
  switch (d.lose) {
    case 'loss':
      return d.theme === 'horse' ? `поражение от войска, где конницы не меньше ${part(HORSE_HEAVY)}` : `поражение ${THEME_WHERE[d.theme]}`;
    case 'win':
      return `победа ${THEME_WHERE[d.theme]}`;
    case 'sureFed':
      return 'уверенная победа сытыми';
    case 'sureOrGeneral':
      return 'новый полководец или уверенная победа';
  }
}

/** Строка летописи (Ш9): черта пришла. */
export function gainLine(id: ScarId): string {
  const d = SCAR_BY_ID[id];
  return d.good ? `Дружина прослыла «${d.name}»: ${gainWords(id)}.` : `На дружину лёг «${d.name}»: ${gainWords(id)}.`;
}

/** Строка летописи: черта ушла по своему правилу (`why` — что именно её сняло). */
export function loseLine(id: ScarId, why: string): string {
  const d = SCAR_BY_ID[id];
  return d.good ? `Дружина утратила славу «${d.name}»: ${why}.` : `Дружина избыла «${d.name}»: ${why}.`;
}

/** Строка летописи: черта забыта — вытеснена новой или её бои ушли из памяти. */
export function forgetLine(id: ScarId): string {
  return `Дружина забыла «${SCAR_BY_ID[id].name}»: помнит она лишь последние уроки.`;
}
