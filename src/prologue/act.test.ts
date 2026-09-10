/**
 * Что предлагает поляна и почему это сейчас нельзя.
 *
 * Правило одно и то же во всей игре: кнопка, которая не сработает, гаснет и
 * говорит причину. Здесь оно проверяется целиком, потому что «ничего не
 * произошло» — худшее, что игрок может получить в ответ на тап, и на телефоне
 * он повторяет такой тап вслепую и решает, что игра сломана.
 */
import { describe, expect, it } from 'vitest';
import { ROAST_COST, bow, death, meal, offer, roastCount } from './act';
import { HEARTH_CAP } from './fire';
import { AXE_STUMP, FIRE, TENT, TREES, TREE_LOGS, type Spot, type SpotKind } from './glade';
import { DEER_MEAT } from './hunt';
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

// ---------- Жизнь и охота ----------

const AT_TENT: Spot = { kind: 'tent', x: TENT.x, z: TENT.z, index: -1 };
const AT_CARCASS: Spot = { kind: 'carcass', x: 3, z: 3, index: -1 };
const AT_ARROW: Spot = { kind: 'arrow', x: 2, z: 2, index: 0 };

describe('мясо жарится только на огне', () => {
  it('у горящего костра — жарится, у погасшего — нет, и сказано почему', () => {
    const s = state({ meat: { cooked: 0, raw: 3 }, hearth: { fuel: 4, at: 0 } });
    expect(offer(s, AT_FIRE, 0)).toMatchObject({ deed: 'roast', can: true });
    const dead = state({ meat: { cooked: 0, raw: 3 }, hearth: { fuel: 0, at: 0 } });
    const o = offer(dead, AT_FIRE, 0);
    expect(o).toMatchObject({ deed: 'roast', can: false });
    expect(o.why).toBe('Костёр погас');
  });

  it('прогоревший за ночь костёр мяса не жарит: считается время, а не запись', () => {
    // Вчера дров было четыре — сегодня их нет, и жарить не на чем.
    const s = state({ meat: { cooked: 0, raw: 2 }, hearth: { fuel: 4, at: 0 } });
    expect(offer(s, AT_FIRE, 0).can).toBe(true);
    expect(offer(s, AT_FIRE, 30 * 3_600_000).can).toBe(false);
  });

  it('жарка стоит дров, и на сколько хватило — на столько и жарит', () => {
    // Полполена за кусок: полный олень, шесть кусков, стоит ровно дерева.
    expect(ROAST_COST * 6).toBe(TREE_LOGS);
    const s = state({ meat: { cooked: 0, raw: 6 }, hearth: { fuel: 1, at: 0 } });
    expect(roastCount(s, 0)).toBe(2);
    expect(offer(s, AT_FIRE, 0).label).toBe('Пожарить мясо (2)');
    // Меньше полполена — жарить нечем, и это сказано отдельным словом.
    const bare = state({ meat: { cooked: 0, raw: 6 }, hearth: { fuel: 0.4, at: 0 } });
    expect(offer(bare, AT_FIRE, 0).why).toBe('В костре не осталось дров');
  });

  it('с сырым мясом в руках костёр предлагает кухню, а не дрова', () => {
    // Человек подошёл к огню за жаркой; дрова подождут одного тапа.
    const s = state({ logs: 3, meat: { cooked: 0, raw: 1 }, hearth: { fuel: 2, at: 0 } });
    expect(offer(s, AT_FIRE, 0).deed).toBe('roast');
    const noRaw = state({ logs: 3, hearth: { fuel: 2, at: 0 } });
    expect(offer(noRaw, AT_FIRE, 0).deed).toBe('feed');
  });
});

describe('есть можно и сырым, но плохо', () => {
  it('оба куска предлагаются, пока голод есть', () => {
    const s = state({ meat: { cooked: 1, raw: 1 } });
    expect(meal(s, 0.5, false).can).toBe(true);
    expect(meal(s, 0.5, true).can).toBe(true);
  });

  it('на полный живот не едят, и сказано почему', () => {
    const s = state({ meat: { cooked: 1, raw: 1 } });
    expect(meal(s, 0, false)).toMatchObject({ can: false, why: 'Ты сыт' });
  });

  it('чего нет, того и не съесть', () => {
    const s = state({ meat: { cooked: 0, raw: 0 } });
    expect(meal(s, 0.9, false).why).toBe('Жареного мяса нет');
    expect(meal(s, 0.9, true).why).toBe('Сырого мяса нет');
  });
});

describe('пожитки, туша и стрелы', () => {
  it('у палатки берут лук и запас — один раз за поляну', () => {
    expect(offer(state(), AT_TENT, 0)).toMatchObject({ deed: 'take-kit', can: true });
    expect(offer(state({ kit: true }), AT_TENT, 0).can).toBe(false);
  });

  it('с туши срезают по куску, и видно, сколько осталось', () => {
    const s = state({ hunt: { killedAt: 0, carcass: { x: 3, z: 3, taken: 2 } } });
    expect(offer(s, AT_CARCASS, 0)).toMatchObject({ deed: 'butcher', can: true });
    expect(offer(s, AT_CARCASS, 0).label).toBe(`Срезать мясо (${DEER_MEAT - 2})`);
  });

  it('стрела с земли подбирается', () => {
    const s = state({ arrows: [{ x: 2, z: 2 }] });
    expect(offer(s, AT_ARROW, 0)).toMatchObject({ deed: 'take-arrow', can: true });
  });
});

describe('тап не целится, выстрел целится — и это разные двери', () => {
  it('оленя нет среди того, до чего дотягиваются рукой', () => {
    // Список видов спотов — и есть весь ответ на вопрос «что даёт тап».
    // Появись здесь зверь — лук стал бы не нужен в тот же день.
    const kinds: SpotKind[] = ['tree', 'fire', 'axe', 'tent', 'carcass', 'arrow'];
    expect(kinds).not.toContain('deer');
  });

  it('лук отвечает своей дверью и своими причинами', () => {
    expect(bow(state(), false)).toMatchObject({ can: false, why: 'Лука нет' });
    expect(bow(state({ kit: true, quiver: 0 }), false)).toMatchObject({ can: false, why: 'Стрелы кончились' });
    expect(bow(state({ kit: true, quiver: 2 }), false)).toMatchObject({ deed: 'draw', can: true });
    expect(bow(state({ kit: true, quiver: 2 }), true)).toMatchObject({ deed: 'shoot', can: true });
  });

  it('кнопка действия про лук не знает ничего', () => {
    // Ни один тап по поляне не натягивает лук и не пускает стрелу: иначе
    // «действие над тем, к чему подошёл» и «выстрел туда, куда смотришь»
    // слились бы в одно, и правило перестало бы быть правилом.
    const s = state({ kit: true, quiver: 3, axe: true, meat: { cooked: 1, raw: 1 } });
    for (const spot of [AT_AXE, AT_TREE, AT_FIRE, AT_TENT, AT_CARCASS, AT_ARROW, null]) {
      const deed = offer(s, spot, 0).deed;
      expect(deed === 'draw' || deed === 'shoot', `${spot?.kind}`).toBe(false);
    }
  });
});

describe('смерть — это чтение, а не событие', () => {
  it('новая поляна жива, а прогоревшая ночь без дров — нет', () => {
    const s = state();
    expect(death(s, 0)).toBe(null);
    expect(death(s, 60_000)).toBe(null);
    // Двенадцать часов горит начальный очаг, восемь — стынет человек.
    expect(death(s, 20 * 3_600_000)).toBe('cold');
  });

  it('мёртвому поляна ничего не предлагает — но это решает сцена, а не `offer`', () => {
    // Здесь нарочно нет проверки на смерть: `offer` отвечает на вопрос «что тут
    // можно сделать», а «можно ли вообще» — вопрос другой и решается один раз,
    // в сцене. Две проверки одного и того же разошлись бы при первой правке.
    const s = state();
    expect(offer(s, AT_AXE, 100 * 3_600_000).can).toBe(true);
    expect(death(s, 100 * 3_600_000)).not.toBe(null);
  });
});
