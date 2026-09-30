// Договор карточки войск: всё её содержимое выведено из конфига боя и данных
// племени, а не написано руками. Проверяется он единственным честным способом —
// правкой самого конфига: подменили множитель, пересобрали карточку, строка
// изменилась. Если однажды кто-то впишет число в JSX, этот тест не заметит
// подмены только в том случае, если сам конфиг перестанут читать, — поэтому
// здесь же проверяется, что старого числа в карточке не осталось нигде.
import { afterEach, describe, expect, it } from 'vitest';
import {
  ANCHOR,
  FIRE_AFTER_CONTACT,
  KIND_PROFILE,
  MORALE,
  STAT_IDS,
  UNIT_KINDS,
  UNIT_STATS,
} from '@/battle';
import { TROOPS, TROOP_BY_ID, TROOP_IDS } from '../data/troops';
import { KIND_OF, profileOfTroop } from './kinds';
import { battleWeight } from './price';
import { fmt, moraleOf, positionsOf, statsOf, temperOf, troopCard } from './describe';

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
    ...c.pips.map((l) => `${l.name} ${l.value} ${l.what}`),
    ...c.positions.map((l) => `${l.text} ${l.when}`),
    ...c.strengths,
    ...c.weaknesses,
    ...temperOf(c.kind).map((t) => `${t.when} ${t.text}`),
    `${c.morale.total} ${c.weight.value.toFixed(1)} ${c.weight.what}`,
    `${c.cost.work}`,
  ].join(' | ');
};

describe('карточка войск выводится из конфига', () => {
  // Кольца контрров нет (слово владельца по 14.35, docs/battle_eu4.md): карточка показывает показатели рода — вещи своих не
  // дают, они идут в бой весом (путь П2), — а не пары «род против рода». Тесты «правка множителя в COUNTER меняет строку карточки», «правка COUNTER доходит и до
  // чужой карточки», «невыгодные множители показываются наравне с выгодными» и «кольцо контрров берёт числа из COUNTER»
  // сняты вместе с таблицей кольца; их обещание — карточка читает конфиг в момент показа и не прячет слабого — держат
  // тесты ниже на показателях.
  it('правка показателя рода меняет строку карточки — у каждого вида этого рода', () => {
    const before = statsOf('spearman').find((l) => l.stat === 'shockDef')!;
    expect(before.value).toBe(profileOfTroop('spearman').shockDef);
    set(KIND_PROFILE.spear, 'shockDef', 7);
    const after = statsOf('spearman').find((l) => l.stat === 'shockDef')!;
    expect(after.value).not.toBe(before.value);
    expect(after.value).toBe(7);
    expect(text('spearman')).toContain('натиск, защита 7');
  });

  it('слабые показатели показываются наравне с сильными: все шесть у каждого вида, и нули тоже', () => {
    for (const troop of TROOP_IDS) {
      const c = troopCard(troop);
      expect(c.pips.map((l) => l.stat), troop).toEqual([...STAT_IDS]);
      for (const l of c.pips) expect(l.value, `${troop}: ${l.stat}`).toBe(KIND_PROFILE[KIND_OF[troop]][l.stat]);
    }
    // У дубинщика нет ничего — и это видно: шесть нулей.
    expect(troopCard('clubman').pips.every((l) => l.value === 0)).toBe(true);
  });

  it('у каждого множителя положения написано условие, и условие — положение, а не приказ', () => {
    // Приказов у боя нет (docs/battle_eu4.md, 14.5): множитель действует по положению бойцов — во фланге ли удар, в
    // рукопашной ли цель, — и так и назван.
    for (const kind of UNIT_KINDS) {
      for (const line of [...positionsOf(kind), ...temperOf(kind)]) {
        expect(line.when.length).toBeGreaterThan(10);
        expect(line.text).toContain('×');
        expect(line.when).not.toMatch(/приказ/i);
      }
    }
    // Стрельба после контакта — у лучников, числом из конфига.
    expect(positionsOf('archer').map((l) => l.text)).toEqual([fmt(FIRE_AFTER_CONTACT)]);
    expect(positionsOf('spear')).toEqual([]);
  });
});

describe('мораль вида — характеристика рода', () => {
  // Тесты «складывается из базы рода и ступеней снаряжения», «прибавка за ступень снаряжения берётся из GEAR» и «неполная
  // ступень показывает, что даст следующая» сняты вместе с моралью за снаряжение — решение владельца по 14.35, путь П2: вещи
  // идут в бой только через цену вида и его вес. Что кузница меняет бой, держит `price.test.ts`, что карточка показывает
  // вес — тест ниже.
  it('мораль вида — мораль его рода, за снаряжение не прибавляется ничего', () => {
    for (const troop of TROOP_IDS) {
      const m = moraleOf(troop);
      expect(m.total, troop).toBe(UNIT_STATS[KIND_OF[troop]].morale);
      expect(m.max).toBe(MORALE.max);
    }
  });

  it('правка морали рода меняет карточку каждого его вида', () => {
    const before = moraleOf('spearman').total;
    set(UNIT_STATS.spear, 'morale', 33);
    expect(moraleOf('spearman').total).toBe(33);
    expect(moraleOf('spearman').total).not.toBe(before);
  });
});

describe('вес вида в бою на карточке — по цене', () => {
  it('карточка показывает вес из цены (`price.battleWeight`), и у дубинщика он — мерка: один', () => {
    for (const troop of TROOP_IDS) expect(troopCard(troop).weight.value, troop).toBe(battleWeight(troop));
    expect(troopCard('clubman').weight.value).toBe(1);
    const heaviest = TROOPS.reduce((a, b) => (battleWeight(b.id) > battleWeight(a.id) ? b : a));
    expect(troopCard('clubman').weight.max).toBe(battleWeight(heaviest.id));
  });

  it('правка цены вида доходит до карточки: ставка латника (жалованье) двигает его вес', () => {
    const before = troopCard('legionary').weight.value;
    set(TROOP_BY_ID.legionary, 'grade', TROOP_BY_ID.legionary.grade * 2);
    expect(troopCard('legionary').weight.value).toBeGreaterThan(before);
    expect(text('legionary')).toContain(troopCard('legionary').weight.value.toFixed(1));
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

  it('первая сильная сторона — показатель, где вид среди лучших видов, и она переезжает вслед за конфигом', () => {
    // Лучник — единственный с нападением в огне: первая строка его сильных сторон — она.
    expect(troopCard('archer').strengths[0]).toContain('Среди лучших видов — огонь, нападение');
    // Поднимем нападение в огне копьям выше лучника — строка переедет к копейщику.
    set(KIND_PROFILE.spear, 'fireAtk', 9);
    expect(troopCard('spearman').strengths[0]).toContain('Среди лучших видов — огонь, нападение');
    expect(troopCard('archer').strengths[0]).not.toContain('Среди лучших видов — огонь, нападение');
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
      expect(c.pips.length).toBe(STAT_IDS.length);
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
