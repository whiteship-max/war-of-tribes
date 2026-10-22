// Вести державы (СБ-2, docs/stability.md, «СБ-2»). Тесты держат обещания:
//
//  1. таблица цельна: у каждой вести правило, слова и 2–3 ответа; молчание бесплатно; нравов поровну; следствия и усилители есть;
//  2. условия: весть приходит только при своём условии, следствие случаем не выпадает;
//  3. частота: λ = вес / срок по редкости, доля приходов на сетке — `1 − exp(−Δ·Σλ)` на наборе сидов;
//  4. без повторов: весть не приходит чаще срока, историческая — раз за партию; за вход — не больше одной;
//  5. выбор и последствия: ответ двигает стабильность, очки, склад, веру, людей, кладёт усилитель и следствие — тем, что
//     показывает окно; цена очками гасит ответ и списывается одной дверью; молчание идёт тем же путём; книга для сервера;
//  6. весть копит сдвиг и выше «Лада», а давление — нет (правило СБ-1 цело).
//
// Область каждого правила названа утверждением в самом тесте (правило 11).
import { describe, expect, it } from 'vitest';
import type { GameState } from '../types';
import { createInitialState } from '../state';
import { deserialize, serialize } from '../save';
import { DAY_LENGTH, RESOURCE_IDS } from '../constants';
import { EVENT_BY_ID } from '../data/events';
import { CROWN, CROWN_BY_ID } from '../data/crown';
import { CROWN_WORDS, crownText } from '../data/crownWords';
import { BOON_BY_ID, MOOD_SMALL } from '../data/boons';
import { SEASON_DAYS } from '../data/seasons';
import { POINTS_CAP } from '../data/realm';
import {
  CROWN_BOOK,
  CROWN_IDS,
  CROWN_MTTH,
  CROWN_RULES,
  CROWN_SLOT_MS,
  RARITY_SLOW,
  crownEvery,
  crownStab,
  isCrown,
} from '../crownrules';
import { STAB_SELF_MAX } from '../stabrules';
import { LETTER_PAUSE_MIN } from '@/world/data/tuning';
import { BANNED } from '@/ui/next/voice.test';
import { applyCrown, crownArrived, crownFx, crownOf, crownPick, crownRate, crownRates, crownWords } from './crown';
import { folkParts, stabNudge, stabOf, stabilityTick, targetOf } from './stability';
import { mailSlots } from './tech';
import { pointsOf } from './points';
import { resolveEvent } from './actions';
import { EVENT_TTL, eventId, lapseEvent, mailArrive, raiseEvent } from './mail';
import { moraleBreakdown } from '../derived';
import { crownLines } from '@/ui/realm/crownView';

/** Город, где вести державы могут приходить: обучение пройдено, склад и золото полны, очков вдоволь. */
function town(seed = 7): GameState {
  const s = createInitialState(seed);
  s.tutorialDone = true;
  for (const r of RESOURCE_IDS) s.resources[r] = 5000;
  s.gold = 5000;
  s.time = 30 * DAY_LENGTH;
  for (const b of ['admin', 'diplo', 'war'] as const) s.realm.points[b] = POINTS_CAP;
  s.realm.pointsAt = s.time;
  s.stab = { level: 0, drift: 0, folk: 0, hungry: 0, past: [], bought: 0, spent: 0, revolts: 0, held: 0 };
  return s;
}

/** Весть на столе — тем же путём, что приход почты. */
function lay(s: GameState, id: string): string {
  expect(raiseEvent(s, id)).toBe(true);
  crownArrived(s, id);
  return eventId(s.inbox[s.inbox.length - 1]);
}

describe('таблица вестей державы цельна', () => {
  it('у каждой вести — правило, слова, 2–3 ответа, бесплатное молчание; таблицы одного размера', () => {
    expect(CROWN.map((d) => d.id).sort()).toEqual([...CROWN_IDS].sort());
    expect(Object.keys(CROWN_WORDS).sort()).toEqual([...CROWN_IDS].sort());
    for (const d of CROWN) {
      const rule = CROWN_RULES[d.id];
      expect(d.opts.length, d.id).toBe(rule.opts.length);
      expect(d.opts.length, d.id).toBeGreaterThanOrEqual(2);
      expect(d.opts.length, d.id).toBeLessThanOrEqual(3);
      expect(CROWN_WORDS[d.id].done.length, d.id).toBe(d.opts.length);
      const quiet = d.opts[d.silence];
      expect(quiet, d.id).toBeTruthy();
      expect(quiet.cost, `${d.id}: молчание не платит`).toBeUndefined();
      expect(quiet.points, `${d.id}: молчание не платит очками`).toBeUndefined();
      expect(EVENT_BY_ID[d.id], `${d.id} в общей таблице`).toBeTruthy();
      expect(isCrown(d.id)).toBe(true);
    }
  });

  it('нравов поровну: добрых, дурных и выборов — не меньше восьми каждого, следствий — четыре', () => {
    const n = (k: string): number => CROWN_IDS.filter((id) => CROWN_RULES[id].kind === k).length;
    expect(n('good')).toBeGreaterThanOrEqual(8);
    expect(n('bad')).toBeGreaterThanOrEqual(8);
    expect(n('choice')).toBeGreaterThanOrEqual(8);
    expect(Math.max(n('good'), n('bad'), n('choice')) - Math.min(n('good'), n('bad'), n('choice'))).toBeLessThanOrEqual(2);
    expect(n('chain')).toBe(4);
  });

  it('усилители и следствия вестей существуют, следствие — вид «следствие»', () => {
    const s = town();
    s.pop = 200;
    for (const d of CROWN)
      for (let i = 0; i < d.opts.length; i++)
        for (const f of crownFx(s, d.id, i)) {
          if (f.k === 'boon') expect(BOON_BY_ID[f.id], `${d.id}/${i}: ${f.id}`).toBeTruthy();
          if (f.k === 'chain') expect(CROWN_RULES[f.id]?.kind, `${d.id}/${i}: ${f.id}`).toBe('chain');
        }
  });

  it('слова летописи: текст ≤ 160 при любой вере, ответ ≤ 28, исход ≤ 140, без запретных слов', () => {
    for (const faith of [null, 'catholic', 'orthodox', 'islam', 'pagan'] as const) {
      const s = town();
      s.faith.id = faith;
      for (const id of CROWN_IDS) {
        const t = crownText(id, s);
        expect(t.length, `${id}: «${t}»`).toBeGreaterThan(40);
        expect(t.length, `${id}: «${t}»`).toBeLessThanOrEqual(160);
        for (const bad of BANNED) expect(t, `${id}: «${t}»`).not.toMatch(bad);
      }
    }
    for (const d of CROWN) {
      for (const o of d.opts) {
        expect(o.label.length, `${d.id}: «${o.label}»`).toBeLessThanOrEqual(28);
        for (const bad of BANNED) expect(o.label).not.toMatch(bad);
      }
      for (const t of CROWN_WORDS[d.id].done) {
        expect(t.length, `${d.id}: «${t}»`).toBeLessThanOrEqual(140);
        for (const bad of BANNED) expect(t, `${d.id}: «${t}»`).not.toMatch(bad);
      }
    }
  });
});

describe('условия', () => {
  it('весть приходит только при своём условии: легат — к католикам, чудо — к святыне, засуха — летом, хворь — к старому правителю', () => {
    const s = town();
    const w = (id: string): number => CROWN_BY_ID[id].weight(s);
    s.faith.id = 'orthodox';
    expect(w('cr_legate')).toBe(0);
    s.faith.id = 'catholic';
    expect(w('cr_legate')).toBeGreaterThan(0);
    s.faith.relic = null;
    expect(w('cr_miracle')).toBe(0);
    s.faith.relic = 'catholic';
    expect(w('cr_miracle')).toBeGreaterThan(0);
    // Засуха: точка внутри — лето и люди на полях; та же партия весной — ноль.
    const summer = SEASON_DAYS * DAY_LENGTH;
    s.time = 4 * 4 * summer + summer + DAY_LENGTH;
    expect(s.workers && Object.values(s.workers).some((n) => n > 0)).toBe(true);
    const farm = s.buildings.find((b) => b.type === 'farm');
    if (farm) s.workers.farmer = Math.max(1, s.workers.farmer ?? 0);
    expect(w('cr_drought'), 'лето').toBeGreaterThan(0);
    s.time -= summer;
    expect(w('cr_drought'), 'весна').toBe(0);
    s.realm.ruler.age0 = 20;
    expect(w('cr_ruler_ill'), 'молодой правитель').toBe(0);
    s.realm.ruler.age0 = 90;
    expect(w('cr_ruler_ill'), 'старый правитель').toBeGreaterThan(0);
  });

  it('следствия случаем не выпадают: их частота — ноль при любом состоянии', () => {
    const s = town();
    for (const id of CROWN_IDS.filter((x) => CROWN_RULES[x].kind === 'chain')) expect(crownRate(s, CROWN_BY_ID[id])).toBe(0);
    expect(crownRates(s).some(([d]) => CROWN_RULES[d.id].kind === 'chain')).toBe(false);
  });
});

describe('частота: среднее время до наступления и вес', () => {
  it('λ = вес / (срок × редкость)', () => {
    const s = town();
    for (const [d, l] of crownRates(s)) {
      expect(l, d.id).toBeCloseTo(d.weight(s) / (CROWN_MTTH * RARITY_SLOW[CROWN_RULES[d.id].rarity]), 12);
    }
  });

  it('доля приходов сетки с вестью державы — 1 − exp(−Δ·Σλ) на наборе сидов', () => {
    const days = 16;
    let hits = 0;
    let want = 0;
    let spread = 0;
    const N = 3000;
    for (let seed = 1; seed <= N; seed++) {
      // Сид меняет город (веру, правителя) — у каждого своя Σλ и своя вероятность.
      const s = town(seed);
      const sum = crownRates(s).reduce((t, [, l]) => t + l, 0);
      const p = 1 - Math.exp(-days * sum);
      expect(p, 'точка внутри: вероятность не у края').toBeGreaterThan(0.05);
      expect(p).toBeLessThan(0.95);
      want += p;
      spread += p * (1 - p);
      if (crownPick(s, days)) hits++;
    }
    // Три сигмы разброса суммы бросков с разными вероятностями.
    expect(Math.abs(hits - want)).toBeLessThan(3 * Math.sqrt(spread));
  });

  it('пришедшая весть — пропорционально её частоте: самая частая выпадает чаще самой редкой', () => {
    const count = new Map<string, number>();
    for (let seed = 1; seed <= 3000; seed++) {
      const d = crownPick(town(seed), 400);
      if (d) count.set(d.id, (count.get(d.id) ?? 0) + 1);
    }
    const rates = crownRates(town(1));
    const often = rates.reduce((a, b) => (b[1] > a[1] ? b : a))[0].id;
    const rare = rates.reduce((a, b) => (b[1] < a[1] ? b : a))[0].id;
    expect(count.get(often) ?? 0).toBeGreaterThan(count.get(rare) ?? 0);
  });
});

describe('без повторов и не больше одной за вход', () => {
  it('весть не приходит чаще срока повтора; срок вышел — снова может', () => {
    const s = town();
    const d = CROWN_BY_ID.cr_wedding;
    s.pop = 100;
    expect(crownRate(s, d), 'точка внутри: условие выполнено').toBeGreaterThan(0);
    crownArrived(s, d.id);
    s.time += crownEvery(d.id) - 1;
    expect(crownRate(s, d), 'до срока').toBe(0);
    s.time += 2;
    expect(crownRate(s, d), 'после срока').toBeGreaterThan(0);
  });

  it('историческая — раз за партию', () => {
    const s = town();
    s.faith.id = 'orthodox';
    const d = CROWN_BY_ID.cr_tsargrad;
    expect(crownRate(s, d)).toBeGreaterThan(0);
    crownArrived(s, d.id);
    s.time += 1e9;
    expect(crownRate(s, d)).toBe(0);
  });

  it('за долгую отлучку — не больше одной вести державы; пока одна на столе, другой нет', () => {
    let worst = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const s = town(seed);
      s.pop = 100;
      const T = 50 * CROWN_SLOT_MS;
      mailArrive(s, T, T + EVENT_TTL);
      const on = s.inbox.filter((e) => isCrown(e.defId)).length;
      worst = Math.max(worst, on);
      if (on > 0) {
        expect(crownPick(s, 1e6), 'на столе есть — другой нет').toBeNull();
      }
    }
    expect(worst).toBe(1);
  });

  it('за окно — одна, даже если стол сгонит её чужой вестью: вторая в то же окно не приходит', () => {
    let kicked = 0;
    for (let seed = 1; seed <= 80; seed++) {
      const s = town(seed);
      s.pop = 100;
      // Стол почти полон вестями без срока — у вести державы, пришедшей в окно, срок ближе всех, и её сгонит следующая.
      const T = 50 * CROWN_SLOT_MS;
      for (let i = 0; i < mailSlots(s) - 1; i++) s.inbox.push({ defId: ['fire', 'berries', 'storm', 'trade'][i % 4], at: s.time, until: T + 10 * EVENT_TTL });
      mailArrive(s, T, T + EVENT_TTL);
      const came = crownOf(s).n + s.inbox.filter((e) => isCrown(e.defId)).length;
      if (crownOf(s).n > 0) kicked++;
      expect(came, `сид ${seed}`).toBeLessThanOrEqual(1);
    }
    expect(kicked, 'точка внутри: весть державы сгонялась со стола в окне').toBeGreaterThan(0);
  });

  it('пауза сетки на сервере — пауза писем мира', () => {
    expect(CROWN_SLOT_MS).toBe(LETTER_PAUSE_MIN);
  });
});

describe('выбор и последствия', () => {
  it('ответ двигает стабильность на свой сдвиг, даёт очки и кладёт усилитель — то, что назвало окно', () => {
    const s = town();
    s.faith.id = 'catholic';
    const id = lay(s, 'cr_vow');
    const before = pointsOf(s, 'war');
    expect(before + 30, 'точка внутри: очки не у потолка').toBeLessThanOrEqual(POINTS_CAP + 30);
    s.realm.points.war = 100;
    s.realm.pointsAt = s.time;
    expect(resolveEvent(s, 0, id).error).toBeNull();
    expect(stabOf(s).drift).toBeCloseTo(crownStab('cr_vow', 0), 6);
    expect(stabOf(s).drift, 'точка внутри: ступени не сменились').toBeLessThan(100);
    expect(pointsOf(s, 'war')).toBeCloseTo(130, 6);
  });

  it('окно показывает то, что ответ сделает: строка стабильности и последствия — до и после', () => {
    const s = town();
    s.stab!.drift = 90;
    const lines = crownLines(s, 'cr_good_year', 0);
    expect(lines[0].text).toContain('«Мир» → «Лад»');
    lay(s, 'cr_good_year');
    applyCrown(s, 'cr_good_year', 0);
    expect(stabOf(s).level).toBe(1);
    // Подпись ответа называет тот же сдвиг, что исполнился.
    expect(crownStab('cr_comet', 2), 'точка внутри: сдвиг — минус').toBeLessThan(0);
    expect(crownWords(s, 'cr_comet', 2)).toContain(`стабильность −${Math.round(-crownStab('cr_comet', 2))}\u00a0%`);
  });

  it('цена очками гасит ответ, пока очков нет; есть — списывается одной дверью', () => {
    const s = town();
    s.pop = 80;
    const id = lay(s, 'cr_commune');
    s.realm.points.admin = 10;
    s.realm.pointsAt = s.time;
    const r = resolveEvent(s, 0, id);
    expect(r.error, 'очков не хватает').not.toBeNull();
    expect(s.inbox.some((e) => e.defId === 'cr_commune'), 'весть ждёт').toBe(true);
    s.realm.points.admin = 50;
    s.realm.pointsAt = s.time;
    expect(resolveEvent(s, 0, id).error).toBeNull();
    expect(pointsOf(s, 'admin')).toBeCloseTo(10, 6);
    expect((s.boons ?? []).some((b) => b.id === 'cr_liberty')).toBe(true);
  });

  it('обида группы — причиной у полосы: цель податных растёт ровно на размер обиды, и полоса идёт к ней', () => {
    const s = town();
    const twin = town();
    // Без налога цель податных у нуля: полоса не упирается в свою скорость, и обида видна целиком.
    s.tax = 'none';
    twin.tax = 'none';
    const before = targetOf(folkParts(s));
    expect(before + MOOD_SMALL, 'точка внутри: цель ниже суточного шага полосы').toBeLessThan(33);
    lay(s, 'cr_comet');
    applyCrown(s, 'cr_comet', 2);
    expect((s.boons ?? []).some((b) => b.id === 'cr_omen')).toBe(true);
    const parts = folkParts(s);
    expect(parts.find((p) => p.id === 'boon:cr_omen')?.value).toBeCloseTo(MOOD_SMALL, 9);
    expect(targetOf(parts) - before).toBeCloseTo(MOOD_SMALL, 9);
    // Полоса идёт к цели: за день — выше, чем у того же города без обиды (обида — внутри срока усилителя).
    expect(DAY_LENGTH, 'точка внутри срока обиды').toBeLessThan(BOON_BY_ID.cr_omen.days * DAY_LENGTH);
    for (const x of [s, twin]) {
      x.time += DAY_LENGTH;
      stabilityTick(x, DAY_LENGTH, moraleBreakdown(x));
    }
    expect(s.stab!.folk).toBeGreaterThan(twin.stab!.folk);
  });

  it('следствие: риск — костью партии на наборе сидов, наверняка — всегда', () => {
    let rain = 0;
    const N = 400;
    for (let seed = 1; seed <= N; seed++) {
      const s = town(seed);
      lay(s, 'cr_drought');
      applyCrown(s, 'cr_drought', 1);
      if ((s.chains ?? []).some((c) => c.defId === 'cr_rain')) rain++;
    }
    expect(Math.abs(rain / N - 0.5)).toBeLessThan(0.1);
    const s = town();
    lay(s, 'cr_crown_debt');
    applyCrown(s, 'cr_crown_debt', 1);
    expect((s.chains ?? []).some((c) => c.defId === 'cr_collector')).toBe(true);
  });

  it('молчание — тот же путь, что ответ: исход назван, книга записана', () => {
    const s = town();
    const id = lay(s, 'cr_comet');
    expect(lapseEvent(s, id)).not.toBeNull();
    const c = crownOf(s);
    expect(c.n).toBe(1);
    expect(c.last[0]).toMatchObject({ n: 1, id: 'cr_comet', opt: CROWN_BY_ID.cr_comet.silence });
    expect(stabOf(s).drift).toBeCloseTo(crownStab('cr_comet', 2), 6);
    expect(s.log[0].topic).toBe('stab');
  });

  it('книга держит последние ответы и минуту прихода; переживает сохранение', () => {
    const s = town();
    for (let i = 0; i < CROWN_BOOK + 3; i++) {
      s.time += DAY_LENGTH;
      const id = lay(s, 'cr_song');
      expect(resolveEvent(s, 1, id).error).toBeNull();
    }
    const c = crownOf(s);
    expect(c.n).toBe(CROWN_BOOK + 3);
    expect(c.last.length).toBe(CROWN_BOOK);
    expect(c.last[c.last.length - 1].at).toBe(s.time);
    const back = deserialize(serialize(s))!;
    expect(crownOf(back)).toEqual(c);
    expect(crownOf(deserialize(serialize(createInitialState(3)))!).n, 'старая партия — ноль ответов').toBe(0);
  });
});

describe('весть и «Лад»', () => {
  it('весть копит сдвиг выше «Лада», давление тихих дней — нет', () => {
    const s = town();
    s.stab!.level = STAB_SELF_MAX;
    expect(stabOf(s).drift).toBe(0);
    stabNudge(s, 40);
    expect(stabOf(s).drift, 'весть копит').toBeCloseTo(40, 6);
    // Тихий день без недовольных: давление вверх сдвиг вести не стирает и своего не прибавляет.
    stabilityTick(s, DAY_LENGTH, moraleBreakdown(s));
    expect(stabOf(s).drift, 'давление не стёрло').toBeCloseTo(40, 6);
    const calm = town();
    calm.stab!.level = STAB_SELF_MAX;
    stabilityTick(calm, DAY_LENGTH, moraleBreakdown(calm));
    expect(stabOf(calm).drift, 'сама выше «Лада» не копит').toBe(0);
    stabNudge(s, 70);
    expect(stabOf(s).level, 'весть подняла выше «Лада»').toBe(STAB_SELF_MAX + 1);
  });
});
