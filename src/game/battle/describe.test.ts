// Договор карточки войск: всё её содержимое выведено из конфига боя и данных
// племени, а не написано руками. Проверяется он единственным честным способом —
// правкой самого конфига: подменили множитель, пересобрали карточку, строка
// изменилась. Если однажды кто-то впишет число в JSX, этот тест не заметит
// подмены только в том случае, если сам конфиг перестанут читать, — поэтому
// здесь же проверяется, что старого числа в карточке не осталось нигде.
import { afterEach, describe, expect, it } from 'vitest';
import {
  ANCHOR,
  COUNTER,
  GEAR,
  MORALE,
  SLOW_CONTACT,
  UNIT_KINDS,
  UNIT_STATS,
} from '@/battle';
import { TROOPS, TROOP_IDS } from '../data/troops';
import { KIND_OF } from './kinds';
import { counterRing, countersOf, fmt, moraleOf, nextGearOf, temperOf, troopCard } from './describe';

/** Конфиг объявлен `as const`, но в рантайме это обычный объект — правим и возвращаем. */
const patch = <T extends object, K extends keyof T>(obj: T, key: K, value: T[K]): (() => void) => {
  const was = obj[key];
  obj[key] = value;
  return () => {
    obj[key] = was;
  };
};

const restore: (() => void)[] = [];
const set = <T extends object, K extends keyof T>(obj: T, key: K, value: T[K]): void => {
  restore.push(patch(obj, key, value));
};

afterEach(() => {
  while (restore.length > 0) restore.pop()?.();
});

/** Вся карточка одной строкой — так проще спросить «есть ли там это число». */
const text = (troop: (typeof TROOP_IDS)[number]): string => {
  const c = troopCard(troop);
  return [
    ...c.counters.map((l) => `${l.text} ${l.when}`),
    ...c.strengths,
    ...c.weaknesses,
    ...temperOf(c.kind).map((t) => `${t.when} ${t.text}`),
    `${c.morale.base} ${c.morale.gear} ${c.morale.total}`,
    `${c.cost.work}`,
  ].join(' | ');
};

/** `COUNTER` объявлен `as const`, поэтому для правки его надо расширить до чисел. */
const counters = (m: object): Record<string, number> => m as Record<string, number>;

describe('карточка войск выводится из конфига', () => {
  it('правка множителя в COUNTER меняет строку карточки', () => {
    const before = countersOf('spear').find((l) => l.id === 'spear-cav-hold');
    expect(before?.text).toBe(`${fmt(COUNTER.spear.cavalryHolding)} против лёгкой конницы`);

    set(counters(COUNTER.spear), 'cavalryHolding', 3.7);
    const after = countersOf('spear').find((l) => l.id === 'spear-cav-hold');

    expect(after?.text).not.toBe(before?.text);
    expect(after?.text).toContain('×3.7');
    // И на карточке копейщика — тоже: панель читает ровно это.
    expect(text('spearman')).toContain('×3.7');
    expect(text('spearman')).not.toContain('×2.0 против конницы');
  });

  it('правка COUNTER доходит и до чужой карточки: конница видит новое число по себе', () => {
    expect(text('rider')).toContain(`${fmt(COUNTER.spear.cavalryHolding)} копья по нам`);
    set(counters(COUNTER.spear), 'cavalryHolding', 4.2);
    expect(text('rider')).toContain('×4.2 копья по нам');
  });

  it('невыгодные множители показываются наравне с выгодными', () => {
    const lines = countersOf('cavalry');
    const bad = lines.filter((l) => !l.good);
    expect(bad.length).toBeGreaterThan(0);
    // Конница о сомкнутые копья — это её множитель, и он ниже единицы.
    const vsSpear = lines.find((l) => l.id === 'cav-spear-closed');
    expect(vsSpear?.dir).toBe('out');
    expect(vsSpear?.mult).toBe(COUNTER.cavalry.spearClosed);
    expect(vsSpear?.good).toBe(false);
  });

  it('у каждого множителя написано условие, при котором он действует, и условие — положение, а не приказ', () => {
    // Приказов у боя больше нет (docs/battle_eu4.md, 14.5): множитель обязан действовать по положению
    // бойцов — сомкнуты ли копья, во фланге ли удар, в рукопашной ли цель, — и так и назван.
    for (const kind of UNIT_KINDS) {
      for (const line of countersOf(kind)) {
        expect(line.when.length).toBeGreaterThan(10);
        expect(line.text).toContain('×');
        expect(line.when, line.id).not.toMatch(/приказ/i);
      }
    }
  });

  it('кольцо контрров берёт числа из COUNTER, а не рисует свои', () => {
    const ring = counterRing();
    expect(ring.edges.map((e) => e.text)).toEqual([
      fmt(COUNTER.spear.cavalryHolding),
      fmt(COUNTER.cavalry.archer),
      fmt(COUNTER.archer.spear),
    ]);
    set(counters(COUNTER.archer), 'spear', 1.9);
    expect(counterRing().edges[2].text).toBe('×1.9');
  });
});

describe('мораль вида — характеристика рода плюс снаряжение', () => {
  it('складывается из базы рода и ступеней снаряжения', () => {
    for (const troop of TROOP_IDS) {
      const m = moraleOf(troop);
      expect(m.base).toBe(UNIT_STATS[KIND_OF[troop]].morale);
      expect(m.gear).toBe(m.gearLevel * GEAR.moralePerLevel);
      expect(m.total).toBe(Math.min(MORALE.max, m.base + m.gear));
    }
  });

  it('правка морали рода меняет карточку каждого его вида', () => {
    const before = moraleOf('spearman').total;
    set(UNIT_STATS.spear, 'morale', 33);
    expect(moraleOf('spearman').base).toBe(33);
    expect(moraleOf('spearman').total).not.toBe(before);
  });

  it('прибавка за ступень снаряжения берётся из GEAR', () => {
    set(GEAR, 'moralePerLevel', 11);
    // Латник носит три предмета — все три ступени.
    expect(moraleOf('legionary').gear).toBe(3 * 11);
  });

  it('неполная ступень показывает, что даст следующая, числом из конфига', () => {
    const next = nextGearOf('clubman');
    expect(next).not.toBeNull();
    expect(next?.gain).toBe((next?.level ?? 0) * GEAR.moralePerLevel);
    // У полного снаряжения следующей ступени нет.
    expect(nextGearOf('legionary')).toBeNull();
  });
});

describe('сильные и слабые стороны выводятся правилами', () => {
  it('у каждого вида по две-три строки в каждом разделе', () => {
    for (const troop of TROOP_IDS) {
      const c = troopCard(troop);
      expect(c.strengths.length).toBeGreaterThanOrEqual(2);
      expect(c.strengths.length).toBeLessThanOrEqual(3);
      expect(c.weaknesses.length).toBeGreaterThanOrEqual(2);
      expect(c.weaknesses.length).toBeLessThanOrEqual(3);
    }
  });

  it('лучший размен рода — это и есть самый высокий множитель из COUNTER', () => {
    const top = countersOf('cavalry')
      .filter((l) => l.dir === 'out')
      .reduce((a, b) => (b.mult > a.mult ? b : a));
    expect(troopCard('rider').strengths[0]).toContain(top.text);
  });

  it('«самая высокая мораль среди родов» переезжает вслед за конфигом', () => {
    // Пока стойчее всех конница — строка стоит у всадника, а не у лучника.
    expect(troopCard('rider').strengths.join(' ')).toContain('стойкость');
    expect(troopCard('archer').strengths.join(' ')).not.toContain('Самая высокая стойкость');
    set(UNIT_STATS.archer, 'morale', 99);
    expect(troopCard('archer').strengths.join(' ')).toContain('Самая высокая стойкость');
    expect(troopCard('rider').strengths.join(' ')).not.toContain('Самая высокая стойкость');
  });

  it('«самая высокая цена» держится за самый долгий наём, а не за имя вида', () => {
    const longest = TROOPS.reduce((a, b) => (b.work > a.work ? b : a));
    expect(troopCard(longest.id).weaknesses.join(' ')).toContain('Дольше всех учится');
    const other = TROOPS.find((t) => t.id !== longest.id)!;
    const restoreWork = patch(other, 'work', longest.work * 3);
    try {
      expect(troopCard(other.id).weaknesses.join(' ')).toContain('Дольше всех учится');
      expect(troopCard(longest.id).weaknesses.join(' ')).not.toContain('Дольше всех учится');
    } finally {
      restoreWork();
    }
  });

  it('«медленные» появляются из порога SLOW_CONTACT, а не из названия рода', () => {
    expect(UNIT_STATS.spear.speed).toBeLessThanOrEqual(SLOW_CONTACT.speedAtMost);
    expect(troopCard('spearman').weaknesses.join(' ')).toContain(`${SLOW_CONTACT.delay} тика`);
    set(UNIT_STATS.spear, 'speed', SLOW_CONTACT.speedAtMost + 1);
    expect(troopCard('spearman').weaknesses.join(' ')).not.toContain('Медленные');
  });

  it('якорь пехоты описан числами ANCHOR', () => {
    const lines = troopCard('clubman').strengths.join(' ');
    expect(lines).toContain(`${Math.round(ANCHOR.infantryShare * 100)}%`);
    set(ANCHOR, 'infantryShare', 0.45);
    expect(troopCard('clubman').strengths.join(' ')).toContain('45%');
  });
});

describe('карточка целиком', () => {
  it('у каждого вида есть род и полная цена', () => {
    for (const troop of TROOP_IDS) {
      const c = troopCard(troop);
      expect(UNIT_KINDS).toContain(c.kind);
      expect(c.cost.people).toBe(1);
      expect(c.cost.work).toBe(c.def.work);
      expect(c.cost.resources.length).toBeGreaterThan(0);
      expect(c.counters.length).toBeGreaterThan(2);
    }
  });

  it('снаряжение в цене — то же, что списывают казармы', () => {
    for (const def of TROOPS) {
      const card = troopCard(def.id);
      expect(card.cost.gear.map((g) => [g.id, g.n])).toEqual(
        Object.entries(def.gear).filter(([, n]) => n),
      );
    }
  });
});
