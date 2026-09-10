/**
 * Что предлагает поляна и почему это сейчас нельзя.
 *
 * Правило одно и то же во всей игре: кнопка, которая не сработает, гаснет и
 * говорит причину. Здесь оно проверяется целиком, потому что «ничего не
 * произошло» — худшее, что игрок может получить в ответ на тап, и на телефоне
 * он повторяет такой тап вслепую и решает, что игра сломана.
 */
import { describe, expect, it } from 'vitest';
import { offer } from './act';
import { HEARTH_CAP } from './fire';
import { AXE_STUMP, FIRE, TREES, type Spot } from './glade';
import { freshPrologue, type PrologueSave } from './save';

const AT_AXE: Spot = { kind: 'axe', x: AXE_STUMP.x, z: AXE_STUMP.z, index: -1 };
const AT_TREE: Spot = { kind: 'tree', x: TREES[0].x, z: TREES[0].z, index: 0 };
const AT_FIRE: Spot = { kind: 'fire', x: FIRE.x, z: FIRE.z, index: -1 };

const state = (over: Partial<PrologueSave> = {}): PrologueSave => ({ ...freshPrologue(0), ...over });

describe('цепочка первого куска проходится', () => {
  it('топор → дерево → костёр, и каждый шаг разрешён на своём месте', () => {
    const s = state();
    expect(offer(s, AT_AXE, 0)).toMatchObject({ deed: 'take-axe', can: true });
    s.axe = true;
    expect(offer(s, AT_TREE, 0)).toMatchObject({ deed: 'chop', can: true });
    s.logs = 3;
    expect(offer(s, AT_FIRE, 0)).toMatchObject({ deed: 'feed', can: true });
  });
});

describe('нельзя — значит сказано, почему', () => {
  it('у каждого запрета есть причина словами', () => {
    const cases: [string, PrologueSave, Spot | null][] = [
      ['нет топора', state(), AT_TREE],
      ['топор уже взят', state({ axe: true }), AT_AXE],
      ['нет дров', state({ axe: true, logs: 0 }), AT_FIRE],
      ['костёр полон', state({ axe: true, logs: 2, hearth: { fuel: HEARTH_CAP, at: 0 } }), AT_FIRE],
      ['рядом ничего', state(), null],
    ];
    for (const [name, s, spot] of cases) {
      const o = offer(s, spot, 0);
      expect(o.can, name).toBe(false);
      expect(o.why.length, `${name}: причина не названа`).toBeGreaterThan(0);
    }
  });

  it('надпись на кнопке не врёт о том, чего она не сделает', () => {
    // «Рубить» без топора — по-прежнему «Рубить»: игрок целился в дерево, и
    // подменять слово на что-то другое значило бы прятать от него дело.
    const o = offer(state(), AT_TREE, 0);
    expect(o.label).toBe('Рубить');
    expect(o.why).toBe('Нужен топор');
  });

  it('у разрешённого действия причины нет', () => {
    expect(offer(state(), AT_AXE, 0).why).toBe('');
  });
});

describe('костёр учитывает время, а не запись', () => {
  it('полный вчера — сегодня уже не полный, и дрова примет', () => {
    const day = 24 * 3_600_000;
    const s = state({ axe: true, logs: 1, hearth: { fuel: HEARTH_CAP, at: 0 } });
    expect(offer(s, AT_FIRE, 0).can).toBe(false);
    expect(offer(s, AT_FIRE, day).can).toBe(true);
  });

  it('погасший костёр дрова принимает: разжечь заново можно всегда', () => {
    // Смерти и проигрыша в этом куске нет — погасший костёр не тупик.
    const s = state({ logs: 2, hearth: { fuel: 0, at: 0 } });
    expect(offer(s, AT_FIRE, 100 * 3_600_000)).toMatchObject({ deed: 'feed', can: true });
  });
});
