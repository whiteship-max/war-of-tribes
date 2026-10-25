import { describe, expect, it } from 'vitest';
import { createInitialState } from '../state';
import { DAY_LENGTH, MAX_BUILDING_LEVEL, RESOURCE_IDS } from '../constants';
import { BUILDING_BY_ID } from '../data/buildings';
import { EVENTS, EVENT_BY_ID, optionHint } from '../data/events';
import { CHAIN_SEASONS, TIDINGS } from '../data/tidings';
import { BOONS, BOON_BY_ID, boonWords } from '../data/boons';
import { SEASON_SECONDS } from '../data/seasons';
import { activeBoons, moraleBreakdown, seasonMods, seasonModsFor, seasonOf, yearOf } from '../derived';
import { deserialize, serialize } from '../save';
import { realMs } from '../pace';
import type { GameState, Season } from '../types';
import { grantBoon } from './boons';
import { scheduleChain } from './chains';
import { EVENT_TTL, eventId, lapseEvent, mailArrive, resolveEvent } from './mail';
import { setRandom, seeded } from './random';

/**
 * Вести по образцу EU4 (docs/events.md): сезон, временные усилители, цепочки. Держат здесь то, где награду можно было
 * бы получить дважды или где в исход прокрались бы алмазы, — и то, что подпись называет те же числа, что делает исход.
 */

const T0 = 1_900_000_000_000;
const HOUR = 60 * 60 * 1000;

function rich(seed = 11): GameState {
  const s = createInitialState(seed);
  s.tutorialDone = true;
  for (const b of s.buildings) b.level = Math.min(BUILDING_BY_ID[b.type].maxLevel ?? MAX_BUILDING_LEVEL, MAX_BUILDING_LEVEL);
  for (const r of RESOURCE_IDS) s.resources[r] = 5000;
  s.gold = 5000;
  s.pop = 200;
  s.time = 10 * DAY_LENGTH;
  return s;
}

/** Игровая секунда середины сезона `season` первого полного года после нынешнего времени. */
function inSeason(s: GameState, season: Season): number {
  const order: Season[] = ['spring', 'summer', 'autumn', 'winter'];
  const year = Math.ceil(s.time / (SEASON_SECONDS * 4)) + 1;
  return (year * 4 + order.indexOf(season)) * SEASON_SECONDS + SEASON_SECONDS / 2;
}

/** Ответить на весть `defId` вариантом `i` — положив её на стол. */
function answer(s: GameState, defId: string, i: number): { error: string | null } {
  s.inbox = [...s.inbox, { defId, at: s.time }];
  return resolveEvent(s, i, eventId(s.inbox[s.inbox.length - 1]));
}

const NEW = [...TIDINGS.map((e) => e.id), 'mercenaries', 'free_company'];

describe('сезонные вести ходят в свой сезон', () => {
  const seasonal: Record<string, Season[]> = {
    harvest_feast: ['autumn'],
    spring_flood: ['spring'],
    hard_winter: ['winter'],
    fair: ['summer', 'autumn'],
    pilgrims: ['spring', 'summer'],
  };
  for (const [id, own] of Object.entries(seasonal)) {
    it(`${id}: вес есть только в ${own.join(', ')}`, () => {
      for (const season of ['spring', 'summer', 'autumn', 'winter'] as Season[]) {
        const s = rich();
        s.faith.id = 'catholic';
        s.time = inSeason(s, season);
        expect(seasonOf(s.time), 'точка внутри сезона').toBe(season);
        const w = EVENT_BY_ID[id].weight(s);
        if (own.includes(season)) expect(w, `${id} в ${season}`).toBeGreaterThan(0);
        else expect(w, `${id} в ${season}`).toBe(0);
      }
    });
  }

  it('следствия цепочек случаем не выпадают', () => {
    const s = rich();
    for (const id of Object.keys(CHAIN_SEASONS)) expect(EVENT_BY_ID[id].weight(s), id).toBe(0);
  });
});

describe('усилитель — функция времени, и дважды он не складывается', () => {
  it('держится до срока и снимается сам, без тика', () => {
    const s = rich();
    s.time = inSeason(s, 'summer');
    // Сезон под усилителем берётся на той же секунде: усилитель длиной в сезон переходит в следующий.
    const base = (): number | undefined => seasonModsFor(seasonOf(s.time), yearOf(s.time)).jobs.farmer;
    grantBoon(s, 'flood');
    const until = s.boons[0].until;
    expect(until).toBe(s.time + BOON_BY_ID.flood.days * DAY_LENGTH);
    // Внутри срока — поле множится; точка утверждается внутри.
    s.time = until - 1;
    expect(s.time).toBeLessThan(until);
    expect(seasonMods(s).jobs.farmer).toBeCloseTo((base() ?? 1) * BOON_BY_ID.flood.jobs!.farmer!, 9);
    // На сроке и после — ровно сезон.
    s.time = until;
    expect(seasonMods(s).jobs.farmer).toBe(base());
  });

  it('два одинаковых ответа подряд — один усилитель подольше, а не двойная сила', () => {
    const s = rich();
    s.time = inSeason(s, 'summer');
    grantBoon(s, 'fair');
    s.time += DAY_LENGTH;
    grantBoon(s, 'fair');
    expect(s.boons.filter((b) => b.id === 'fair')).toHaveLength(1);
    expect(s.boons[0].until).toBe(s.time + BOON_BY_ID.fair.days * DAY_LENGTH);
    const base = seasonModsFor(seasonOf(s.time), yearOf(s.time));
    expect(seasonMods(s).jobs.crafter).toBeCloseTo((base.jobs.crafter ?? 1) * BOON_BY_ID.fair.jobs!.crafter!, 9);
    expect(moraleBreakdown(s).boon).toBe(BOON_BY_ID.fair.morale);
  });

  it('мораль усилителя ложится в цель после шкалы, как пир', () => {
    const s = rich();
    s.time = inSeason(s, 'summer');
    s.morale = 50;
    const before = moraleBreakdown(s);
    // Область: цель не у края шкалы, сдвиг читается целиком.
    expect(before.target).toBeGreaterThan(10);
    expect(before.target).toBeLessThan(90);
    grantBoon(s, 'cold');
    const after = moraleBreakdown(s);
    expect(after.target - before.target).toBeCloseTo(BOON_BY_ID.cold.morale!, 9);
  });

  it('усилитель переживает сохранение', () => {
    const s = rich();
    grantBoon(s, 'vein');
    const back = deserialize(serialize(s))!;
    expect(activeBoons(back).map((b) => b.def.id)).toEqual(['vein']);
  });
});

describe('цепочка: следствие приходит после срока и один раз', () => {
  it('купец дал в долг — за долгом он придёт один раз, и только когда срок вышел', () => {
    const s = rich();
    const goldBefore = s.gold;
    expect(answer(s, 'merchant_loan', 0).error).toBeNull();
    expect(s.gold).toBeGreaterThan(goldBefore);
    expect(s.chains.map((c) => c.defId)).toEqual(['merchant_due']);
    const due = s.chains[0].at;
    expect(due).toBe(s.time + CHAIN_SEASONS.merchant_due * SEASON_SECONDS);
    // Пока долг ждёт, второго купец не даёт: взять в долг дважды под один срок нельзя.
    expect(EVENT_BY_ID.merchant_loan.weight(s)).toBe(0);
    expect(scheduleChain(s, 'merchant_due', 1)).toBe(false);

    // До срока — на столе пусто (окно без прихода сетки: вести сетки здесь ни при чём).
    s.time = due - 1;
    s.unrest = 0;
    let now = T0;
    const before = s.inbox.length;
    const arrived = (): number => s.inbox.filter((e) => e.defId === 'merchant_due').length;
    // Проверяем только следствие: приход сетки в окне мог положить и обычную весть.
    mailArrive(s, now - 1000, now);
    expect(arrived()).toBe(0);
    expect(s.inbox.length).toBeGreaterThanOrEqual(before);

    // Срок вышел — пришло ровно одно.
    s.time = due;
    now += 1000;
    mailArrive(s, now - 1000, now);
    expect(arrived()).toBe(1);
    expect(s.chains).toEqual([]);
    const ev = s.inbox.find((e) => e.defId === 'merchant_due')!;
    expect(ev.until).toBeGreaterThan(now);
    expect(ev.until! - now).toBeLessThanOrEqual(EVENT_TTL);

    // Повторный проход того же окна второго не кладёт.
    mailArrive(s, now - 1000, now);
    mailArrive(s, now, now + 1000);
    expect(arrived()).toBe(1);

    // Ответ закрывает следствие, второй ответ — ошибка, золото не уходит дважды.
    const id = eventId(ev);
    const gold = s.gold;
    expect(resolveEvent(s, 0, id).error).toBeNull();
    const paid = gold - s.gold;
    expect(paid).toBeGreaterThan(0);
    expect(resolveEvent(s, 0, id).error).not.toBeNull();
    expect(gold - s.gold).toBe(paid);
  });

  it('ECO-2: долг считается от посёлка в минуту займа, а не в минуту взыскания', () => {
    // Архив аудита prove-5-1: заняли при трёхстах жителях, к приходу купца стало тридцать — взыскивалось как с тридцати.
    for (const [lent, owes] of [
      [300, 30],
      [30, 300],
    ]) {
      const s = rich();
      s.pop = lent;
      s.gold = 100_000;
      // Подпись займа называет, сколько придут взыскать, — взыскано будет столько же.
      const hint = optionHint(EVENT_BY_ID.merchant_loan.options[0], s)!;
      const promised = Number(hint.match(/взыскать (\d+)/)![1]);
      expect(answer(s, 'merchant_loan', 0).error).toBeNull();
      const got = s.gold - 100_000;
      expect(got).toBeGreaterThan(0);
      s.pop = owes;
      s.time = s.chains[0].at;
      s.unrest = 0;
      mailArrive(s, T0 - 1000, T0);
      const ev = s.inbox.find((e) => e.defId === 'merchant_due')!;
      expect(ev).toBeDefined();
      const back = deserialize(serialize(s))!;
      const gold = back.gold;
      expect(resolveEvent(back, 0, eventId(ev)).error).toBeNull();
      const paid = gold - back.gold;
      expect(paid, `занято ${got} при ${lent} жителях, взыскано при ${owes}`).toBeGreaterThanOrEqual(got);
      expect(paid).toBe(promised);
    }
  });

  it('следствие, созревшее в долгой отлучке, приходит со входом и ждёт полные сутки', () => {
    const s = rich();
    scheduleChain(s, 'silt', 1);
    s.time = s.chains[0].at + 100 * DAY_LENGTH;
    s.unrest = 0;
    const now = T0;
    // Созрело глубже окна в сутки: realMs(100 игровых дней) больше суток.
    expect(realMs(100 * DAY_LENGTH)).toBeGreaterThan(EVENT_TTL);
    mailArrive(s, now - 3 * 24 * HOUR, now);
    const ev = s.inbox.find((e) => e.defId === 'silt');
    expect(ev?.until).toBe(now + EVENT_TTL);
  });

  it('отложенное следствие переживает сохранение', () => {
    const s = rich();
    scheduleChain(s, 'feud', 1);
    const back = deserialize(serialize(s))!;
    expect(back.chains).toEqual(s.chains);
  });

  it('пропавший из игры вид следствия уходит молча и стол не держит', () => {
    const s = rich();
    s.chains = [{ defId: 'нет_такой_вести', at: 0 }];
    s.unrest = 0;
    mailArrive(s, T0 - 1000, T0);
    expect(s.chains).toEqual([]);
    expect(s.inbox.some((e) => e.defId === 'нет_такой_вести')).toBe(false);
  });

  it('разлив без вала ведёт к илу; молчание — тот же путь, что ответ', () => {
    const s = rich();
    s.time = inSeason(s, 'spring');
    s.inbox = [{ defId: 'spring_flood', at: s.time }];
    lapseEvent(s);
    expect(s.chains.map((c) => c.defId)).toEqual(['silt']);
    expect(activeBoons(s).map((b) => b.def.id)).toEqual(['flood']);
  });
});

describe('ни в одном исходе нет алмазов, и награда не берётся дважды', () => {
  it('каждый вариант каждой вести не трогает алмазы', () => {
    for (const e of EVENTS) {
      for (const i of e.options.keys()) {
        setRandom(seeded(3));
        const s = rich();
        s.faith.id = 'catholic';
        answer(s, e.id, i);
        setRandom(null);
        // Алмазы живут на сервере (docs/gems.md): поля в партии нет, и исход его не заводит.
        expect(Object.keys(s), `${e.id}/${i}`).not.toContain('gems');
      }
    }
  });

  // Что код вестей вообще не умеет начислять алмазы, держит общий замок по всему `src` (`sim/gems.test.ts`):
  // второй замок рядом был бы его копией.

  it('ответ на весть, которой уже нет на столе, ничего не даёт', () => {
    for (const id of NEW) {
      const s = rich();
      s.faith.id = 'catholic';
      s.inbox = [{ defId: id, at: s.time }];
      const ev = eventId(s.inbox[0]);
      const free = EVENT_BY_ID[id].options.findIndex((o) => !o.cost);
      setRandom(seeded(5));
      expect(resolveEvent(s, free, ev).error, id).toBeNull();
      const snap = JSON.stringify({ r: s.resources, g: s.gold, p: s.pop, f: s.prestige, b: s.boons, c: s.chains });
      expect(resolveEvent(s, free, ev).error, id).not.toBeNull();
      setRandom(null);
      expect(JSON.stringify({ r: s.resources, g: s.gold, p: s.pop, f: s.prestige, b: s.boons, c: s.chains }), id).toBe(snap);
    }
  });
});

describe('подпись называет те же числа, что делает исход', () => {
  it('вариант, дающий усилитель, называет его силу словами самого усилителя', () => {
    let seen = 0;
    for (const e of EVENTS) {
      for (const [i, o] of e.options.entries()) {
        setRandom(seeded(9));
        const s = rich();
        s.faith.id = 'catholic';
        const hint = typeof o.hint === 'function' ? o.hint(s) : (o.hint ?? '');
        answer(s, e.id, i);
        setRandom(null);
        for (const { def } of activeBoons(s)) {
          expect(hint.toLowerCase(), `${e.id}/${i}`).toContain(boonWords(def).toLowerCase());
          seen++;
        }
      }
    }
    // Область: правило спрашивается — усилители в исходах есть.
    expect(seen).toBeGreaterThanOrEqual(BOONS.length);
  });

  it('новые вести укладываются в меры словаря: текст ≤ 160, ответ ≤ 28', () => {
    for (const id of NEW) {
      const e = EVENT_BY_ID[id];
      for (const faith of ['catholic', 'orthodox', 'islam', 'pagan'] as const) {
        const s = rich();
        s.faith.id = faith;
        const text = typeof e.text === 'function' ? e.text(s) : (e.text ?? '');
        expect(text.length, `${id}: «${text}»`).toBeLessThanOrEqual(160);
      }
      for (const o of e.options) expect(o.label.length, `${id}: «${o.label}»`).toBeLessThanOrEqual(28);
    }
  });
});
