// Отношения: ответ соседа, состояния и веса набегов. Всё здесь — чистые функции,
// поэтому тесты обходятся без мира и без часов.
import { describe, expect, it } from 'vitest';
import {
  chanceOf,
  freshRecord,
  moodOf,
  orderSeed,
  raidWeight,
  respond,
  standingAt,
  temperOf,
  type DiploContext,
} from './diplomacy';
import { TEMPER_BY_ID, TEMPER_IDS } from './data/diplomacy';
import { AI_NEUTRAL_QUIET, AI_WAR_WEIGHT, PACT_BREAK_NOTICE, PACT_DURATION } from './data/tuning';
import type { DiploActionId, TemperId } from './types';

const ctx = (over: Partial<DiploContext> = {}): DiploContext => ({
  action: 'pact',
  attitude: 0,
  temper: 'steady',
  standing: 'neutral',
  seed: 12345,
  ...over,
});

describe('ответ соседа — чистая функция', () => {
  it('одно и то же предложение при одинаковых условиях даёт один и тот же ответ', () => {
    const seed = orderSeed(7, 's12', 'pact', 4, 'neutral');
    const c = ctx({ attitude: 4, seed });
    const a = respond(c);
    const b = respond(c);
    expect(a).toEqual(b);
    // И зерно тоже: пока условия не изменились, второе нажатие ничего не меняет.
    expect(orderSeed(7, 's12', 'pact', 4, 'neutral')).toBe(seed);
  });

  it('меняются условия — меняется и зерно: дар открывает то, что было закрыто', () => {
    const cold = orderSeed(7, 's12', 'pact', -10, 'neutral');
    const warm = orderSeed(7, 's12', 'pact', 30, 'neutral');
    expect(cold).not.toBe(warm);
  });

  it('зависит от отношения, характера и зерна — и больше ни от чего', () => {
    // Ровно три входа: подменяем каждый по очереди и смотрим, что ответ едет.
    // Зерно с броском около 0.2: при отношении +10 расчётливый и осторожный
    // соглашаются, а степенный, гордый и свирепый — нет.
    const base = ctx({ attitude: 10, temper: 'steady', seed: 9 });
    const byAttitude = new Set(
      [-40, -10, 10, 40, 80].map((attitude) => respond({ ...base, attitude }).accepted),
    );
    const byTemper = new Set(TEMPER_IDS.map((temper) => respond({ ...base, temper }).accepted));
    const bySeed = new Set(
      [1, 2, 3, 4, 5, 6, 7, 8, 9].map((seed) => respond({ ...base, temper: 'greedy', seed }).accepted),
    );
    expect(byAttitude.size, 'отношение решает').toBe(2);
    expect(byTemper.size, 'характер решает').toBe(2);
    expect(bySeed.size, 'зерно решает').toBe(2);
  });
});

describe('пакт: согласие по отношению и характеру', () => {
  it('хорошее отношение — согласие, плохое — отказ, у любого характера', () => {
    for (const temper of TEMPER_IDS) {
      const bar = TEMPER_BY_ID[temper].pactBar;
      const warm = ctx({ attitude: bar + 60, temper, seed: 99 });
      const cold = ctx({ attitude: bar - 30, temper, seed: 99 });
      expect(chanceOf(warm), `${temper}: тёплое отношение`).toBe(1);
      expect(chanceOf(cold), `${temper}: холодное отношение`).toBe(0);
      expect(respond(warm).accepted).toBe(true);
      expect(respond(cold).accepted).toBe(false);
      expect(respond(cold).standing, 'отказ не меняет состояния').toBe('neutral');
      expect(respond(cold).attitude, 'а отказ ещё и холодит').toBeLessThan(cold.attitude);
    }
  });

  it('характер решает там, где отношение одинаковое', () => {
    const attitude = 12;
    const greedy = chanceOf(ctx({ attitude, temper: 'greedy' })) ?? 0;
    const fierce = chanceOf(ctx({ attitude, temper: 'fierce' })) ?? 0;
    expect(greedy, 'расчётливый подпишет').toBeGreaterThan(0.4);
    expect(fierce, 'свирепый и слушать не станет').toBe(0);
  });

  it('подписанный пакт держится своё время', () => {
    const a = respond(ctx({ attitude: 80, temper: 'greedy' }));
    expect(a.accepted).toBe(true);
    expect(a.standing).toBe('pact');
    expect(a.duration).toBe(PACT_DURATION);
  });
});

describe('война и мир', () => {
  it('война объявляется в одностороннем порядке, броска у неё нет', () => {
    const a = respond(ctx({ action: 'war' }));
    expect(chanceOf(ctx({ action: 'war' }))).toBeNull();
    expect(a.accepted).toBe(true);
    expect(a.standing).toBe('war');
    expect(a.attitude).toBeLessThan(0);
  });

  it('разрыв пакта не мгновенный: двенадцать настоящих часов предупреждения', () => {
    const a = respond(ctx({ action: 'war', standing: 'pact' }));
    expect(a.standing).toBe('war');
    expect(a.breakIn).toBe(PACT_BREAK_NOTICE);

    // И это видно при чтении: до срока пакт ещё в силе.
    const now = 1_000_000;
    const rec = { ...freshRecord(now), standing: 'pact' as const, until: now + PACT_DURATION, breakAt: now + a.breakIn };
    expect(standingAt(rec, now)).toBe('pact');
    expect(standingAt(rec, now + PACT_BREAK_NOTICE - 1)).toBe('pact');
    expect(standingAt(rec, now + PACT_BREAK_NOTICE)).toBe('war');
  });

  it('пакт истекает сам, и это тоже считается при чтении', () => {
    const now = 500;
    const rec = { ...freshRecord(now), standing: 'pact' as const, until: now + PACT_DURATION, breakAt: 0 };
    expect(standingAt(rec, now + PACT_DURATION - 1)).toBe('pact');
    expect(standingAt(rec, now + PACT_DURATION)).toBe('neutral');
  });

  it('мир возвращает нейтралитет, но отношение само собой не выправляется', () => {
    // Отношение, при котором расчётливый соглашается наверняка: проверяем не
    // бросок, а то, что мир не трогает число.
    const before = 10;
    const a = respond(ctx({ action: 'peace', standing: 'war', attitude: before, temper: 'greedy', pressure: 1 }));
    expect(a.accepted).toBe(true);
    expect(a.standing).toBe('neutral');
    expect(a.attitude).toBe(before);
  });

  it('побитый мирится охотнее целого', () => {
    const beaten = chanceOf(ctx({ action: 'peace', standing: 'war', attitude: -20, pressure: 0.8 })) ?? 0;
    const whole = chanceOf(ctx({ action: 'peace', standing: 'war', attitude: -20, pressure: 0 })) ?? 0;
    expect(beaten).toBeGreaterThan(whole);
  });
});

describe('дар и оскорбление', () => {
  it('дар греет, а гордый может вернуть его как подачку', () => {
    const warm = respond(ctx({ action: 'gift', attitude: 40, temper: 'greedy', seed: 3 }));
    expect(warm.accepted).toBe(true);
    expect(warm.attitude).toBeGreaterThan(40);
    // У гордого при холодных отношениях шанс заметно ниже, чем у расчётливого.
    const proud = chanceOf(ctx({ action: 'gift', attitude: -30, temper: 'proud' })) ?? 0;
    const greedy = chanceOf(ctx({ action: 'gift', attitude: -30, temper: 'greedy' })) ?? 0;
    expect(proud).toBeLessThan(greedy);
  });

  it('отвергнутый дар меняет число: иначе настойчивость упиралась бы в вечный отказ', () => {
    // Дважды подряд один и тот же дар при неизменных условиях дал бы один и тот
    // же ответ. Значит, условия обязан менять сам отказ.
    const a = respond(ctx({ action: 'gift', attitude: -40, temper: 'proud', seed: 4 }));
    expect(a.accepted).toBe(false);
    expect(a.attitude).toBeLessThan(-40);
  });

  it('оскорбление роняет отношение всегда, а войной кончается тем вернее, чем горячее характер', () => {
    for (const temper of TEMPER_IDS) {
      const a = respond(ctx({ action: 'insult', attitude: 0, temper, seed: 5 }));
      expect(a.attitude, `${temper}`).toBeLessThan(0);
    }
    const hot = chanceOf(ctx({ action: 'insult', attitude: -20, temper: 'fierce' })) ?? 0;
    const cold = chanceOf(ctx({ action: 'insult', attitude: -20, temper: 'greedy' })) ?? 0;
    expect(hot).toBeGreaterThan(cold);
  });

  it('оскорбление под пактом даёт ту же отсрочку, что и своё объявление войны', () => {
    const a = respond(ctx({ action: 'insult', attitude: -80, temper: 'fierce', standing: 'pact', seed: 5 }));
    expect(a.standing).toBe('war');
    expect(a.breakIn).toBe(PACT_BREAK_NOTICE);
  });
});

describe('характер владельца', () => {
  it('выводится из имени и сида, а не хранится', () => {
    const a = temperOf(42, 'Милослав');
    expect(temperOf(42, 'Милослав')).toBe(a);
    // У одного бота несколько дворов — характер обязан быть один на все.
    expect(temperOf(42, 'Милослав')).toBe(temperOf(42, 'Милослав'));
    const other = temperOf(43, 'Милослав');
    expect(TEMPER_IDS).toContain(other);
  });

  it('на большом наборе имён встречаются все пять', () => {
    const seen = new Set<TemperId>();
    for (let i = 0; i < 400; i++) seen.add(temperOf(7, `бот${i}`));
    expect(seen.size).toBe(TEMPER_IDS.length);
  });
});

const W = { war: AI_WAR_WEIGHT, quiet: AI_NEUTRAL_QUIET };

describe('веса набегов', () => {
  it('в пакте — ноль, в войне — заметно больше, чем в нейтралитете', () => {
    for (const temper of TEMPER_IDS) {
      const pact = raidWeight('pact', 0, temper, W);
      const war = raidWeight('war', -40, temper, W);
      const neutral = raidWeight('neutral', 0, temper, W);
      expect(pact, `${temper}: пакт`).toBe(0);
      expect(war, `${temper}: война`).toBeGreaterThan(neutral * 2);
      expect(neutral).toBeGreaterThan(0);
    }
  });

  it('обиженный сосед ходит охотнее ровного', () => {
    expect(raidWeight('neutral', -60, 'steady', W)).toBeGreaterThan(
      raidWeight('neutral', 0, 'steady', W),
    );
  });

  it('свирепый ходит чаще расчётливого при том же состоянии', () => {
    expect(raidWeight('neutral', 0, 'fierce', W)).toBeGreaterThan(
      raidWeight('neutral', 0, 'greedy', W),
    );
  });
});

describe('отношение словами', () => {
  it('шкала идёт от вражды к сердечности и нигде не пустует', () => {
    const words = [-100, -70, -40, -10, 0, 15, 40, 80, 100].map(moodOf);
    expect(new Set(words).size).toBeGreaterThan(4);
    expect(words.every((w) => w.length > 0)).toBe(true);
  });
});

describe('приказы объявлены полностью', () => {
  it('у каждого приказа есть ответ, а не молчание', () => {
    const ids: DiploActionId[] = ['gift', 'insult', 'pact', 'peace', 'war'];
    for (const id of ids) {
      const a = respond(ctx({ action: id, attitude: 10, standing: id === 'peace' ? 'war' : 'neutral' }));
      expect(a.text.length, id).toBeGreaterThan(0);
    }
  });
});
