// Сохранение племени: поля, которых партия больше не хранит.
//
// Старое сохранение привозит их спредом, и `deserialize` их снимает (`save.DROPPED`) — без ступени и без роста
// версии: читать их некому, а ехать дальше мёртвым полем они не должны. Каждое такое поле снимается целиком и
// ничего вокруг себя не трогает.
import { describe, expect, it } from 'vitest';
import { SAVE_VERSION, createInitialState } from './state';
import { deserialize, serialize } from './save';

describe('сохранение: поля, которых партия больше не хранит', () => {
  it('расстановка обороны до поставки 2 читается, и поле снято: оборону раскладывает правило', () => {
    // Поставка 2 боя (docs/battle_eu4.md, 14.27): у частокола строй раскладывает правило развёртывания, и
    // `GameState.defenseFormation` ушёл. Партия, записанная до поставки, привозит раскладку по секторам — а та,
    // что записана до поставки 1, ещё и план с приказами.
    const s = createInitialState(11);
    s.army.spearman = 10;
    s.army.archer = 6;
    const plain = JSON.parse(serialize(s)) as { version: number };
    const formation = {
      sectors: { A: { spearman: 4 }, B: { spearman: 6 }, C: {}, D: { archer: 6 }, E: {}, F: {}, R: {} },
      plan: 'hold',
    };
    const legacy = { ...plain, defenseFormation: formation };
    // Граница области: партия текущей версии (ступеней нет, снимает только чтение), и поле в ней не пустое.
    expect(legacy.version, 'текущая версия').toBe(SAVE_VERSION);
    expect(Object.keys(formation.sectors.A), 'раскладка не пустая').not.toHaveLength(0);

    const got = deserialize(JSON.stringify(legacy));
    const want = deserialize(JSON.stringify(plain));
    expect(got, 'партия с раскладкой читается').not.toBeNull();
    expect('defenseFormation' in got!, 'поле снято').toBe(false);
    expect(got, 'остальная партия та же, что без раскладки').toEqual(want);
    // Партия, записанная уже после поставки, поля не везёт вовсе.
    expect('defenseFormation' in JSON.parse(serialize(got!)), 'в записи поля нет').toBe(false);
  });
});
