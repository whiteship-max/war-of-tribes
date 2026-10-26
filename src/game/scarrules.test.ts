// Правила черт армии (ДР-4, docs/siege_v2.md, «Решения ДР-4»): приход и уход каждой черты, пары одной темы, предел разом, память
// журнала, смена полководца, метка боя и поправки в бою. Журналы здесь — руками собранные метки: правило — чистая функция от них.
import { describe, expect, it } from 'vitest';
import { emptyStack, type BattleResult, type Stack } from '@/battle';
import {
  ARCHERS_SEEN,
  ARROWS_HEAVY,
  HORSE_HEAVY,
  NO_GENERAL,
  SCARS,
  SCARS_MAX,
  SCAR_BY_ID,
  SCAR_LOG,
  SCAR_SIZE,
  SURE,
  markOf,
  readMark,
  scarActive,
  scarEdge,
  scarsOf,
  warMarks,
  type FightMark,
  type ScarId,
} from './scarrules';

const win = (x: Partial<FightMark> = {}): FightMark => ({ out: 'win', ...x });
const loss = (x: Partial<FightMark> = {}): FightMark => ({ out: 'loss', ...x });
const draw = (x: Partial<FightMark> = {}): FightMark => ({ out: 'draw', ...x });
const ids = (log: FightMark[], gen?: number): ScarId[] => scarsOf(log, gen).map((h) => h.id);
const times = <T>(n: number, f: () => T): T[] => Array.from({ length: n }, f);

/** Тема черты как признак метки: в бою этой темы. */
const themed = (id: ScarId): Partial<FightMark> => {
  const t = SCAR_BY_ID[id].theme;
  return t === 'horse' ? { horse: true } : t === 'hunger' ? { hungry: true } : t === 'arrows' ? { arrows: ARROWS_HEAVY } : { [t]: true };
};

describe('таблица черт', () => {
  it('двенадцать черт, добрых и дурных поровну, имена разные', () => {
    expect(SCARS.length).toBe(12);
    expect(SCARS.filter((d) => d.good).length).toBe(6);
    expect(new Set(SCARS.map((d) => d.name)).size).toBe(12);
  });
  it('темы — местность, рода, осада, ночь, зима, голод: каждая есть', () => {
    expect(new Set(SCARS.map((d) => d.theme))).toEqual(new Set(['woods', 'river', 'hills', 'horse', 'arrows', 'siege', 'night', 'winter', 'hunger']));
  });
  it('величины — выведенные: больше нуля и не дальше потолка поправки', () => {
    for (const d of SCARS) {
      expect(SCAR_SIZE[d.id], d.id).toBeGreaterThan(0);
      expect(SCAR_SIZE[d.id], d.id).toBeLessThanOrEqual(1);
    }
  });
  it('направление доброй — только плюс, дурной — только минус', () => {
    for (const d of SCARS) {
      for (const stats of Object.values(d.shape)) for (const v of Object.values(stats ?? {})) expect(Math.sign(v ?? 0), d.id).toBe(d.good ? 1 : -1);
    }
  });
});

describe('приход и уход каждой черты', () => {
  // Добрые: N побед подряд в теме — приходит; поражение в теме — уходит.
  for (const id of ['ghosts', 'fords', 'highland', 'pikewall', 'walls', 'nightwolves'] as ScarId[]) {
    const need = SCAR_BY_ID[id].gain.need;
    it(`${SCAR_BY_ID[id].name}: ${need} побед подряд в теме — приходит, на одну меньше — нет`, () => {
      expect(ids(times(need - 1, () => win(themed(id))))).not.toContain(id);
      expect(ids(times(need, () => win(themed(id))))).toContain(id);
    });
    it(`${SCAR_BY_ID[id].name}: победы вне темы не считаются, поражение в теме обнуляет счёт`, () => {
      expect(ids(times(need + 2, () => win()))).not.toContain(id);
      const broken = [...times(need - 1, () => win(themed(id))), loss(themed(id)), ...times(need - 1, () => win(themed(id)))];
      expect(ids(broken)).not.toContain(id);
      // Бой вне темы между победами счёт не рвёт; ничья — тоже.
      const mixed = [...times(need - 1, () => win(themed(id))), loss(), draw(themed(id)), win(themed(id))];
      expect(ids(mixed)).toContain(id);
    });
    it(`${SCAR_BY_ID[id].name}: уходит от поражения в теме, не от поражения вне её`, () => {
      const got = times(need, () => win(themed(id)));
      expect(ids([...got, loss()])).toContain(id);
      expect(ids([...got, loss(themed(id))])).not.toContain(id);
    });
  }

  // Дурные «поражения подряд»: N поражений в теме — приходит; победа в теме — уходит.
  for (const id of ['woodfear', 'wallshy', 'frostbit'] as ScarId[]) {
    const need = SCAR_BY_ID[id].gain.need;
    it(`${SCAR_BY_ID[id].name}: ${need} поражения подряд в теме — приходит; победа в теме между ними — счёт сначала`, () => {
      expect(ids(times(need, () => loss(themed(id))))).toContain(id);
      expect(ids([loss(themed(id)), win(themed(id)), loss(themed(id))])).not.toContain(id);
      expect(ids(times(need + 1, () => loss()))).not.toContain(id);
    });
    it(`${SCAR_BY_ID[id].name}: снимает победа в теме, а победа вне её — нет`, () => {
      const got = times(need, () => loss(themed(id)));
      expect(ids([...got, win()])).toContain(id);
      expect(ids([...got, win(themed(id))])).not.toContain(id);
    });
  }

  it('Ночная паника: бежали в ночном бою — приходит; поражение ночью без бегства и бегство днём — нет; снимает победа ночью', () => {
    expect(ids([loss({ night: true, fled: true })])).toContain('nightpanic');
    expect(ids([loss({ night: true })])).not.toContain('nightpanic');
    expect(ids([loss({ fled: true })])).not.toContain('nightpanic');
    expect(ids([loss({ night: true, fled: true }), win()])).toContain('nightpanic');
    expect(ids([loss({ night: true, fled: true }), win({ night: true })])).not.toContain('nightpanic');
  });

  it('Страх обстрела: стрелы выбили пятую часть — приходит, чуть меньше — нет', () => {
    expect(ids([loss({ arrows: ARROWS_HEAVY })])).toContain('arrowfear');
    expect(ids([win({ arrows: ARROWS_HEAVY })]), 'и в победе: страх — от потерь, а не от исхода').toContain('arrowfear');
    expect(ids([loss({ arrows: ARROWS_HEAVY - 0.01 })])).not.toContain('arrowfear');
  });
  it('Страх обстрела: снимает уверенная победа, простая победа — нет', () => {
    const scared = loss({ arrows: 0.3, gen: 2 });
    expect(ids([scared, win({ gen: 2 })], 2)).toContain('arrowfear');
    expect(ids([scared, win({ gen: 2, sure: true })], 2)).not.toContain('arrowfear');
  });
  it('Страх обстрела: снимает новый полководец — и без боя, и следующим боем при другом', () => {
    const scared = loss({ arrows: 0.3, gen: 2 });
    expect(ids([scared], 2), 'тот же человек — держится').toContain('arrowfear');
    expect(ids([scared], 3), 'на месте другой — ушёл').not.toContain('arrowfear');
    expect(ids([scared], NO_GENERAL), 'место опустело — тоже другой').not.toContain('arrowfear');
    expect(ids([scared, loss({ gen: 3 })], 2), 'бой при другом — ушёл').not.toContain('arrowfear');
    // Полководец неизвестен (книга агентов сервера без сида) — смены не видно, черта держится.
    expect(ids([loss({ arrows: 0.3 })], 3)).toContain('arrowfear');
    expect(ids([scared], undefined)).toContain('arrowfear');
  });

  it('Голодный ропот: два боя подряд голодными — приходит; сытый бой между — счёт сначала', () => {
    expect(ids([loss({ hungry: true }), win({ hungry: true })])).toContain('grumble');
    expect(ids([loss({ hungry: true }), win(), loss({ hungry: true })])).not.toContain('grumble');
  });
  it('Голодный ропот: снимает уверенная победа сытыми; голодными — нет, простая сытая — нет', () => {
    const got = [loss({ hungry: true }), loss({ hungry: true })];
    expect(ids([...got, win({ hungry: true, sure: true })])).toContain('grumble');
    expect(ids([...got, win()])).toContain('grumble');
    expect(ids([...got, win({ sure: true })])).not.toContain('grumble');
  });
});

describe('пары, предел и память', () => {
  it('пара одной темы не уживается: лесное поражение сняло «Лесных призраков», второе дало «Лесной морок»', () => {
    const ghosts = times(3, () => win({ woods: true }));
    expect(ids([...ghosts, loss({ woods: true })])).toEqual([]);
    expect(ids([...ghosts, loss({ woods: true }), loss({ woods: true })])).toEqual(['woodfear']);
    expect(ids([...times(2, () => loss({ woods: true })), ...ghosts])).toEqual(['ghosts']);
  });
  it(`разом не больше ${SCARS_MAX}: четвёртая вытесняет самую давнюю, и та не возвращается следующим же боем`, () => {
    const log = [
      ...times(2, () => win({ river: true })), // Бродники
      ...times(2, () => win({ night: true })), // Ночные волки
      ...times(3, () => win({ hills: true })), // Горцы
      ...times(3, () => win({ woods: true })), // Лесные призраки
    ];
    expect(ids(log)).toEqual(['nightwolves', 'highland', 'ghosts']);
    expect(ids([...log, win({ river: true })]), 'одна победа у реки — не две').not.toContain('fords');
    for (let n = 1; n <= log.length; n++) expect(scarsOf(log.slice(0, n)).length).toBeLessThanOrEqual(SCARS_MAX);
  });
  it(`армия помнит ${SCAR_LOG} последних боёв: черта, чьи бои ушли из памяти, забыта`, () => {
    const got = times(3, () => win({ woods: true }));
    const filler = (n: number): FightMark[] => times(n, () => draw());
    expect(ids([...got, ...filler(SCAR_LOG - 3)])).toContain('ghosts');
    expect(ids([...got, ...filler(SCAR_LOG - 2)])).not.toContain('ghosts');
  });
  it('метки боёв войны — по минуте сервера: порядок применения не важен', () => {
    const a = win({ woods: true, war: { id: 'w1.0', at: 100 } });
    const b = win({ woods: true, war: { id: 'w2.0', at: 200 } });
    const c = loss({ woods: true, war: { id: 'w1.1', at: 300 } });
    expect(warMarks([c, a, win(), b]).map((m) => m.war!.id)).toEqual(['w1.0', 'w2.0', 'w1.1']);
  });
});

/** Итог ядра для метки — только поля, которые метка читает. */
function fake(o: {
  winner: 'attacker' | 'defender' | 'draw';
  reason: BattleResult['reason'];
  a: { men: number; lost: number; shot?: number; kinds?: Partial<Stack> };
  d: { men: number; lost: number; shot?: number; kinds?: Partial<Stack> };
}): BattleResult {
  const side = (x: typeof o.a) => ({
    initial: { ...emptyStack(), ...(x.kinds ?? { infantry: x.men }) },
    total: { initial: x.men, final: x.men - x.lost, losses: x.lost },
    rangedTotal: x.shot ?? 0,
  });
  return { winner: o.winner, reason: o.reason, sides: { attacker: side(o.a), defender: side(o.d) } } as unknown as BattleResult;
}

describe('метка боя', () => {
  it('исход за свою сторону; ничья — ничья', () => {
    const r = fake({ winner: 'attacker', reason: 'losses', a: { men: 100, lost: 30 }, d: { men: 100, lost: 60 } });
    expect(markOf(r, 'attacker', {}).out).toBe('win');
    expect(markOf(r, 'defender', {}).out).toBe('loss');
    expect(markOf(fake({ winner: 'draw', reason: 'draw', a: { men: 10, lost: 1 }, d: { men: 10, lost: 1 } }), 'attacker', {}).out).toBe('draw');
  });
  it('уверенная победа — на границах: пало не больше десятой, противник не меньше половины и бежал', () => {
    const at = (lost: number, foe: number, reason: BattleResult['reason']) =>
      markOf(fake({ winner: 'attacker', reason, a: { men: 100, lost }, d: { men: foe, lost: foe / 2 } }), 'attacker', {}).sure === true;
    expect(at(100 * SURE.lost, 100 * SURE.foe, 'morale')).toBe(true);
    expect(at(100 * SURE.lost + 1, 100, 'morale'), 'пало больше десятой').toBe(false);
    expect(at(5, 100 * SURE.foe - 1, 'morale'), 'противник меньше половины').toBe(false);
    expect(at(5, 100, 'annihilated')).toBe(true);
    expect(at(5, 100, 'losses'), 'не бежал и не перебит').toBe(false);
  });
  it('бегство — поражение со сломанной моралью; стрелы — доля нашего войска, выбитая огнём противника', () => {
    const r = fake({ winner: 'defender', reason: 'morale', a: { men: 200, lost: 90 }, d: { men: 150, lost: 20, shot: 41 } });
    const m = markOf(r, 'attacker', { night: true }, true);
    expect(m).toMatchObject({ out: 'loss', fled: true, night: true, hungry: true, arrows: 0.21 });
    expect(markOf(r, 'defender', {}).fled).toBeUndefined();
  });
  it('конница противника — не меньше четверти его родов', () => {
    const r = (horse: number) =>
      fake({ winner: 'attacker', reason: 'losses', a: { men: 100, lost: 1 }, d: { men: 100, lost: 50, kinds: { cavalry: horse, spear: 100 - horse } } });
    expect(markOf(r(100 * HORSE_HEAVY), 'attacker', {}).horse).toBe(true);
    expect(markOf(r(100 * HORSE_HEAVY - 1), 'attacker', {}).horse).toBeUndefined();
  });
});

describe('поправки в бою', () => {
  const foe = (k: Partial<Stack> = {}): Stack => ({ ...emptyStack(), infantry: 100, ...k });
  it('черта действует только в своём бою: вне темы поправок нет — поля у стороны нет', () => {
    for (const d of SCARS) {
      const outside = scarEdge([d.id], { foe: foe() });
      if (d.theme !== 'arrows' && d.theme !== 'horse') expect(outside, d.id).toBeUndefined();
    }
    expect(scarEdge(['ghosts'], { woods: true, foe: foe() })).toEqual({
      spear: { shockAtk: SCAR_SIZE.ghosts, fireDef: SCAR_SIZE.ghosts },
      infantry: { shockAtk: SCAR_SIZE.ghosts, fireDef: SCAR_SIZE.ghosts },
      archer: { shockAtk: SCAR_SIZE.ghosts, fireDef: SCAR_SIZE.ghosts },
      cavalry: { shockAtk: SCAR_SIZE.ghosts, fireDef: SCAR_SIZE.ghosts },
      heavy: { shockAtk: SCAR_SIZE.ghosts, fireDef: SCAR_SIZE.ghosts },
    });
  });
  it('«при виде лучников» и «против конницы» — по войску противника, на границе доли', () => {
    expect(ARCHERS_SEEN).toBe(0.1);
    expect(scarActive('arrowfear', { foe: { ...emptyStack(), infantry: 90, archer: 10 } })).toBe(true);
    expect(scarActive('arrowfear', { foe: { ...emptyStack(), infantry: 91, archer: 9 } })).toBe(false);
    expect(scarActive('pikewall', { foe: { ...emptyStack(), spear: 75, cavalry: 25 } })).toBe(true);
    expect(scarActive('pikewall', { foe: { ...emptyStack(), spear: 76, heavy: 24 } })).toBe(false);
  });
  it('две черты на одном показателе складываются; чужое имя не действует', () => {
    const e = scarEdge(['walls', 'highland'] as ScarId[], { siege: true, hills: true, foe: foe() });
    expect(e?.spear?.shockDef).toBeCloseTo(SCAR_SIZE.walls + SCAR_SIZE.highland, 9);
    expect(scarEdge(['nope' as ScarId], { woods: true, foe: foe() })).toBeUndefined();
  });
});

describe('чтение метки', () => {
  it('только известные поля и разумные числа', () => {
    expect(readMark({ out: 'win', woods: true, sure: true, arrows: 0.123, gen: 3, war: { id: 'w.1', at: 5 }, evil: 1 })).toEqual({
      out: 'win',
      woods: true,
      sure: true,
      arrows: 0.12,
      gen: 3,
      war: { id: 'w.1', at: 5 },
    });
    expect(readMark({ out: 'won' })).toBeNull();
    expect(readMark({ out: 'loss', woods: 'yes', arrows: 7, gen: -5 })).toEqual({ out: 'loss', arrows: 1 });
    expect(readMark(null)).toBeNull();
  });
});
