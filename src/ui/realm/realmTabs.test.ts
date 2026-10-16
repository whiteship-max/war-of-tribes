// Вкладки державы нового вида (docs/ui_audit.md, 13): числа — функциями игры (правило 18). Каждый блок называет
// область, где правило спрашивается, и утверждает, что его точки внутри неё (правило 11).
import { describe, expect, it } from 'vitest';
import type { FaithId, GameState } from '@/game/types';
import { createInitialState } from '@/game/state';
import { REALM_BRANCHES } from '@/game/data/realm';
import { faithTilt, population } from '@/game/derived';
import { rulerRate } from '@/game/sim/points';
import { perDay } from '@/ui/next/hudTips';
import { count } from '@/ui/parts/plural';
import { signedRate, skillTip, tiltCells } from './RealmTabs';
import { dec } from '@/game/num';

/** Город с храмом десятого уровня: наклон веры — и закят, и десятина — в полную силу. */
function town(faith: FaithId | null): GameState {
  const s = createInitialState(7);
  s.pop = 200;
  for (const b of s.buildings) if (b.type === 'church') b.level = 10;
  s.faith.id = faith;
  return s;
}

const FAITHS: (FaithId | null)[] = ['catholic', 'orthodox', 'islam', 'pagan', null];

describe('указы: ставка без слов', () => {
  // Казна, сбор, жалованье и таблицы вариантов — `decrees.test.ts` (UI-7).
  it('ставка без слов и дробь запятой', () => {
    expect(signedRate(19.94)).toBe('+19,9');
    expect(signedRate(-3)).toBe('−3,0');
    expect(dec(1.05, 2)).toBe('1,05');
  });
});

describe('вера: ячейки наклона — числа `faithTilt`, нули не показываются', () => {
  it('каждое ненулевое слагаемое — ячейкой, со знаком и множителем из `faithTilt`', () => {
    let shown = 0;
    for (const faith of FAITHS) {
      const s = town(faith);
      const t = faithTilt(s);
      const cells = tiltCells(t, population(s));
      const by = new Map(cells.map((c) => [c.key, c]));
      expect(by.has('gold'), `${faith}: золото`).toBe(Math.abs(t.goldPerPop) > 0.001);
      if (by.has('gold')) {
        expect(by.get('gold')!.value).toBe(perDay(t.goldPerPop * population(s)));
        expect(by.get('gold')!.label).toBe(t.goldPerPop > 0 ? 'Десятина' : 'Закят');
      }
      expect(by.has('output'), `${faith}: выработка`).toBe(Math.abs(t.output - 1) > 0.001);
      if (by.has('output')) expect(by.get('output')!.value).toBe(`×${dec(t.output, 2)}`);
      expect(by.has('morale'), `${faith}: мораль`).toBe(Math.abs(t.morale) > 0.001);
      shown += cells.length;
    }
    // Область: у вер есть что показать — иначе проверка нулей прошла бы даром.
    expect(shown).toBeGreaterThan(3);
  });
});

describe('правитель: навык — очки `rulerRate`', () => {
  it('подсказка навыка называет приток очков ветви и навык наследника', () => {
    const s = createInitialState(11);
    for (const b of REALM_BRANCHES) {
      const t = skillTip(b, s.realm.ruler.skills[b], rulerRate(s, b), s.realm.heir.skills[b]);
      expect(t.title).toContain(`навык ${s.realm.ruler.skills[b]}`);
      expect(t.body).toContain(`+${count(rulerRate(s, b), 'очко', 'очка', 'очков')} в игровой день`);
      expect(t.body).toContain(`навык ${s.realm.heir.skills[b]}`);
      // Область: у стартового правителя приток в каждой ветви есть (навык не ниже одного).
      expect(rulerRate(s, b)).toBeGreaterThan(0);
    }
  });
});
