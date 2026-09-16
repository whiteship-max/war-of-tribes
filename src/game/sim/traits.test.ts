// Счёт дел, черты, слава дома, родословная и тревога «новый полководец без дружины».
//
// Области (правило 11):
// - «счёт дел — за той же проверкой срока, что опыт» — второе дело ближе `DEED_GAP` к
//   первому; точка, где второе дело дальше срока, проверяет другое правило;
// - «слава дома по чертам до боя» — полководец, который держит черту до боя: у
//   полководца без черты прибавки нет при любом коде;
// - «родословная помнит погибших всех, ушедших — со второго уровня» — оба конца жизни
//   и оба уровня по обе стороны порога;
// - «потолок родословной» — смен больше потолка.
import { describe, expect, it } from 'vitest';
import { createInitialState } from '../state';
import { deserialize, serialize } from '../save';
import { DEED_GAP, LEVEL_XP } from '../data/agents';
import { LINEAGE_KEEP, LINEAGE_LEVEL } from '../data/traits';
import type { GameState } from '../types';
import { applyEffects, playerProfile } from '@/world/bridge';
import type { FigureId, HomeEffect } from '@/world/types';
import {
  bareGeneral,
  mergeLineage,
  recordDeath,
  recordDeed,
  recordRetire,
  reputeMorale,
  seat,
  traitNumbers,
  traitsHeld,
} from './agents';

const MIN = 60_000;
const where = () => 'в Статуе';

const fresh = (): GameState => {
  const s = createInitialState(5);
  for (const id of ['general', 'scout', 'spy', 'diplomat'] as FigureId[]) s.agents[id].name = `Ян ${id}`;
  return s;
};

/** Засчитать полководцу бои подряд, каждый дальше срока от прошлого. */
function battles(s: GameState, won: number, lost: number, dead = 0): void {
  let at = (s.agents.general.deedAt ?? 0) + DEED_GAP * 2;
  for (let i = 0; i < won + lost; i++) {
    recordDeed(s, { agent: 'general', ok: i < won, at, lost: dead, lair: i < won });
    at += DEED_GAP * 2;
  }
}

const battleEffect = (ok: boolean, at: number): HomeEffect => ({
  id: `b-${at}`,
  lost: {},
  resources: {},
  prestige: 0,
  morale: ok ? 4 : -6,
  battle: ok ? 'won' : 'lost',
  deed: { agent: 'general', ok, at },
  text: '',
  good: ok,
});

describe('счёт дел', () => {
  it('ложится той же дверью, что опыт: дело ближе срока не засчитывается ни в опыт, ни в счёт', () => {
    const s = fresh();
    recordDeed(s, { agent: 'spy', ok: true, at: 10 * MIN });
    const second = 10 * MIN + DEED_GAP - 1;
    expect(second - (s.agents.spy.deedAt ?? 0), 'второе дело внутри срока').toBeLessThan(DEED_GAP);
    recordDeed(s, { agent: 'spy', ok: false, at: second });
    expect(s.agents.spy.tally).toEqual({ ok: 1, fail: 0, bled: 0, burned: 0 });
    expect(s.agents.spy.xp).toBe(2);
  });

  it('дело чужого человека в счёт нового не идёт', () => {
    const s = fresh();
    s.agents.scout.person = 3;
    recordDeed(s, { agent: 'scout', ok: true, at: MIN, person: 2 });
    expect(s.agents.scout.tally.ok).toBe(0);
  });

  it('павшие и сожжённые логова считаются, мусор вместо числа павших — нет', () => {
    const s = fresh();
    recordDeed(s, { agent: 'general', ok: true, at: MIN, lost: 7, lair: true });
    recordDeed(s, { agent: 'general', ok: false, at: MIN + DEED_GAP, lost: Number.NaN });
    expect(s.agents.general.tally).toEqual({ ok: 1, fail: 1, bled: 7, burned: 1 });
  });

  it('новый человек начинает с чистого листа', () => {
    const s = fresh();
    battles(s, 6, 0);
    s.agents.general.vacant = true;
    seat(s, 'general', 100, 24, 'Новый');
    expect(s.agents.general.tally).toEqual({ ok: 0, fail: 0, bled: 0, burned: 0 });
    expect(traitsHeld(s, 'general')).toEqual([]);
  });

  it('летопись говорит, чем прослыл и когда перестал', () => {
    const s = fresh();
    battles(s, 5, 0);
    expect(s.log.some((e) => e.text.includes('прослыл: «Победоносный»'))).toBe(true);
    battles(s, 0, 1);
    expect(s.log.some((e) => e.text.includes('больше не слывёт: «Победоносный»'))).toBe(true);
  });

  it('черт в сохранении нет: после записи и чтения их даёт тот же счёт', () => {
    const s = fresh();
    battles(s, 6, 0);
    const back = deserialize(serialize(s))!;
    expect(back.agents.general.tally).toEqual(s.agents.general.tally);
    expect(traitsHeld(back, 'general')).toEqual(traitsHeld(s, 'general'));
  });
});

describe('слава полководца дома', () => {
  it('«Победоносный» прибавляет к морали победы, а первое поражение прибавки не даёт и снимает черту', () => {
    const plain = fresh();
    const hero = fresh();
    battles(hero, 5, 0);
    expect(traitsHeld(hero, 'general'), 'до боя черта есть').toContain('victor');
    plain.morale = 50;
    hero.morale = 50;
    const at = (hero.agents.general.deedAt ?? 0) + DEED_GAP * 2;
    applyEffects(plain, [battleEffect(true, at)]);
    applyEffects(hero, [battleEffect(true, at)]);
    expect(plain.morale).toBe(54);
    expect(hero.morale).toBe(56);

    hero.morale = 50;
    applyEffects(hero, [battleEffect(false, at + DEED_GAP * 2)]);
    expect(hero.morale).toBe(44);
    expect(traitsHeld(hero, 'general')).not.toContain('victor');
  });

  it('«Битый» роняет мораль поражения сильнее', () => {
    const s = fresh();
    battles(s, 1, 2);
    expect(traitsHeld(s, 'general'), 'до боя черта есть').toContain('beaten');
    s.morale = 50;
    applyEffects(s, [battleEffect(false, (s.agents.general.deedAt ?? 0) + DEED_GAP * 2)]);
    expect(s.morale).toBe(41);
  });

  it('слава считается по чертам до боя: бой, который черту приносит, прибавки ещё не даёт', () => {
    const win = fresh();
    battles(win, 4, 0);
    expect(traitsHeld(win, 'general'), 'до пятой победы черты нет').not.toContain('victor');
    win.morale = 50;
    applyEffects(win, [battleEffect(true, (win.agents.general.deedAt ?? 0) + DEED_GAP * 2)]);
    expect(traitsHeld(win, 'general'), 'после неё — есть').toContain('victor');
    expect(win.morale).toBe(54);

    const loss = fresh();
    battles(loss, 1, 1);
    expect(traitsHeld(loss, 'general'), 'до третьего боя черты нет').not.toContain('beaten');
    loss.morale = 50;
    applyEffects(loss, [battleEffect(false, (loss.agents.general.deedAt ?? 0) + DEED_GAP * 2)]);
    expect(traitsHeld(loss, 'general'), 'после него — есть').toContain('beaten');
    expect(loss.morale).toBe(44);
  });

  it('пустое место славы не даёт', () => {
    const s = fresh();
    battles(s, 5, 0);
    s.agents.general.vacant = true;
    expect(reputeMorale(s, { agent: 'general', ok: true, at: 0 })).toBe(0);
  });
});

describe('множители для мира', () => {
  it('без черт поля в слепке нет вовсе', () => {
    const s = fresh();
    expect(traitNumbers(s)).toEqual({});
    expect('traits' in playerProfile(s)).toBe(false);
  });

  it('черты едут числами, а не именами', () => {
    const s = fresh();
    battles(s, 6, 0, 0);
    expect(traitsHeld(s, 'general')).toEqual(['victor', 'swift', 'carter']);
    expect(playerProfile(s).traits).toEqual({ muster: 0.75, carry: 1.15 });
  });
});

describe('родословная', () => {
  const fell = (s: GameState, agent: FigureId = 'general') =>
    recordDeath(s, { agent, person: s.agents[agent].person, peril: 0.05, where: 'у логова', why: [] }, where);

  it('погибших помнят всех — и на первом уровне', () => {
    const s = fresh();
    expect(LEVEL_XP[LINEAGE_LEVEL - 1], 'первый уровень ниже порога ушедших').toBeGreaterThan(s.agents.general.xp);
    fell(s);
    expect(s.lineage.general).toHaveLength(1);
    expect(s.lineage.general![0]).toMatchObject({ name: 'Ян general', level: 1, end: 'fell', deeds: 0 });
  });

  it('ушедших на покой — со второго уровня: первый не записан, второй записан', () => {
    const low = fresh();
    recordRetire(low, { agent: 'general', person: 0 }, where);
    expect(low.lineage.general ?? []).toEqual([]);

    const high = fresh();
    battles(high, 6, 0);
    high.agents.general.xp = LEVEL_XP[LINEAGE_LEVEL - 1];
    recordRetire(high, { agent: 'general', person: 0 }, where);
    expect(high.lineage.general![0]).toMatchObject({ level: LINEAGE_LEVEL, end: 'rest', deeds: 6, traits: ['victor', 'swift', 'carter'] });
  });

  it('места с потолком ноль не помнят никого', () => {
    const s = fresh();
    expect(LINEAGE_KEEP.scout).toBe(0);
    fell(s, 'scout');
    expect(s.lineage.scout).toBeUndefined();
  });

  it('новые первыми, не больше потолка; весть о давно ушедшем записи не добавляет', () => {
    const s = fresh();
    const keep = LINEAGE_KEEP.general;
    for (let i = 0; i < keep + 3; i++) {
      s.agents.general.name = `Воевода ${i}`;
      fell(s);
      seat(s, 'general', i, 24, `Воевода ${i + 1}`);
    }
    expect(keep + 3, 'смен больше потолка').toBeGreaterThan(keep);
    expect(s.lineage.general).toHaveLength(keep);
    expect(s.lineage.general![0].name).toBe(`Воевода ${keep + 2}`);
    const before = JSON.stringify(s.lineage);
    recordDeath(s, { agent: 'general', person: 0, peril: 0, where: 'давно', why: [] }, where);
    expect(JSON.stringify(s.lineage)).toBe(before);
  });

  it('из сохранения читается с проверкой: мусор выброшен, неизвестная черта отброшена, потолок держится', () => {
    const row = { name: 'Ян', level: 3, deeds: 9, from: 24, to: 60, end: 'rest', traits: ['victor', 'dragon'] };
    const got = mergeLineage({
      general: [...Array.from({ length: 9 }, () => row), { name: '', level: 1 }, 'мусор'],
      scout: [row],
    });
    expect(got.general).toHaveLength(LINEAGE_KEEP.general);
    expect(got.general![0].traits).toEqual(['victor']);
    expect(got.scout).toBeUndefined();

    const s = fresh();
    fell(s);
    const back = deserialize(serialize(s))!;
    expect(back.lineage).toEqual(s.lineage);
    const old = JSON.parse(serialize(s));
    delete old.lineage;
    expect(deserialize(JSON.stringify(old))!.lineage).toEqual({});
  });
});

describe('новый полководец без дружины', () => {
  const view = (troops = {}, place = 'map') => ({ place, troops });

  it('тревога — только у преемника, без боёв и без дружины', () => {
    const s = fresh();
    expect(bareGeneral(s, view()), 'тот, с кем партия началась, — не преемник').toBe(false);
    s.agents.general.vacant = true;
    seat(s, 'general', 10, 24, 'Преемник');
    expect(bareGeneral(s, view())).toBe(true);
    expect(bareGeneral(s, view({}, 'city'))).toBe(true);
    expect(bareGeneral(s, view({ spearman: 5 })), 'дружина при нём').toBe(false);
    expect(bareGeneral(s, view({}, 'down')), 'вне строя').toBe(false);
    expect(bareGeneral(s, undefined), 'мир ещё не сказал').toBe(false);
    battles(s, 1, 0);
    expect(bareGeneral(s, view()), 'уже водил бой').toBe(false);
  });

  it('о пришедшем без дружины говорит летопись', async () => {
    const { settleHires } = await import('./hire');
    const s = fresh();
    s.agents.general.vacant = true;
    s.agents.general.hiring = { until: s.time, name: 'Преемник', age0: 24 };
    settleHires(s);
    expect(s.log.some((e) => e.text.includes('Дружины при нём нет'))).toBe(true);
  });
});
