// Сгенерирована `npx vite-node scripts/deeds/build.ts` (вывод — scripts/deeds/derive.ts) из данных игры с запасом
// ×1.2. Руками не править — скрипт перезапишет, а тест `scripts/deeds/derive.test.ts` сверит с выводом.
//
// Сколько одно разовое дело может положить на склад и в казну и сколько снять (AC-1 аудита, docs/audit/OWNER-DECISIONS.md,
// п. 2): допуск сервера к росту и убыли склада между описями — `netlify/lib/deeds.ts`. Ряд — постоянная часть и часть на
// единицу размера посёлка (`eventKit.scale`: жители, войско и новобранцы на стартовые 30).

/** Запас таблицы над выведенным. */
export const DEED_MARGIN = 1.2;

/** Ряд допуска по видам склада и казне: `flat + scale × размер посёлка`. */
export interface Row {
  flat: Record<string, number>;
  scale: Record<string, number>;
}

export interface DeedTable {
  /** Прочее дело (весть и весть державы, задание, ежедневка, охота, покупка, разведка, взятый замок): прибавка за одно. */
  gain: Row;
  /** Оно же: убавка за одно (цена ответа, весть отнимает добро). */
  loss: Row;
  /** Оно же: бойцы за одно. */
  troops: { flat: number; scale: number };
  /**
   * Бой (победа, логово, набег): груз на бойца, уводимые на бойца (невольники, книга невольников сервера — АУ-8, п. 2) и
   * трофеи у ворот на единицу размера посёлка.
   */
  fight: { carry: number; led: number; scale: Record<string, number> };
  /** Промысел: доля дневной выработки вида за одну игру. */
  game: Record<string, number>;
  /** Дело лавки алмазов: лот. */
  shop: number;
  /** Караван: наибольший привоз вида. */
  caravan: Record<string, number>;
  /**
   * Добро без дела мира, которого сервер не видит своими книгами (АУ-8, п. 8): падение логова голодом и выкуп осады логова —
   * груз на бойца (`carry`), выплата торговли по договору — золото (`gold`). Продажа, дань войны и кража у соседа — книгами
   * сервера, не таблицей.
   */
  windfall: { carry: number; gold: number };
  /**
   * Договор НПС бродяги (ПН-7): наибольшая плата и престиж одного договора по тирам I…III — потолок сдачи договора в книге отряда
   * сервера (`roambook`).
   */
  deal: { gold: number[]; fame: number[] };
}

export const DEED_TABLE: DeedTable = {
  gain: { flat: { wood: 362, stone: 578, food: 722, hides: 386, charcoal: 2, copper: 290, iron: 290, gold: 2 }, scale: { wood: 108, stone: 84, food: 108, hides: 28.8, charcoal: 24, copper: 24, iron: 16.8, gold: 48 } },
  loss: { flat: { wood: 2, stone: 2, food: 2, hides: 2, charcoal: 2, copper: 2, iron: 2, gold: 2 }, scale: { wood: 24, stone: 9.6, food: 42, hides: 14.4, charcoal: 0, copper: 0, iron: 0, gold: 84 } },
  troops: { flat: 2, scale: 0 },
  fight: { carry: 900, led: 6, scale: { wood: 18, stone: 0, food: 0, hides: 6, charcoal: 0, copper: 0, iron: 0, gold: 0 } },
  game: { wood: 0, stone: 0, food: 1.2, hides: 0.23, charcoal: 0, copper: 0, iron: 0, gold: 0 },
  shop: 120,
  caravan: { wood: 8024, stone: 6419, food: 1544, hides: 2442, charcoal: 2442, copper: 1605, iron: 1535, gold: 0 },
  windfall: { carry: 900, gold: 3 },
  deal: { gold: [7913, 19680, 59682], fame: [12, 24, 36] },
};
