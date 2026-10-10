// «Начать заново» не получает второй раз то, что прежняя партия уже получила (docs/bughunt.md, «Начать заново»).
//
// Сервер отдаёт итоги войн и тайных дел семь суток, журнал алмазов и указы админа — все. Новая партия и новый мир
// принимали их по своим отметкам, а отметки начинались с нуля: добыча взятого города, украденное, потери, покупки лавки
// и указы ложились второй раз. Отметки принятого — за игроком, и переезжают в новую партию и новый мир.
import { describe, expect, it } from 'vitest';
import { LocalWorld } from './local/LocalWorld';
import { worldSaveJson, type WorldSave } from './local/state';
import { useGame } from '@/game/store';

const NOW = 1_700_000_000_000;
const saveOf = (w: LocalWorld): WorldSave => (w as unknown as { save: WorldSave }).save;

describe('новый мир поверх прежнего той же эпохи', () => {
  it('принятые итоги войн и тайных дел остаются принятыми', () => {
    const old = new LocalWorld({ seed: 11, now: () => NOW, storage: null });
    saveOf(old).warSeen = ['w1abc.0', 'w1abc-fall', 'spy:x7'];
    const json = worldSaveJson(saveOf(old));
    const fresh = new LocalWorld({ seed: 12, now: () => NOW, storage: { read: () => json, write: () => {} } });
    // Граница области: мир правда собран заново (другой сид), а не прочитан из сохранения.
    expect(saveOf(fresh).seed).toBe(12);
    expect(saveOf(fresh).warSeen).toEqual(['w1abc.0', 'w1abc-fall', 'spy:x7']);
  });

  it('мир другой эпохи (после /wipeworld) ничего не наследует', () => {
    const old = new LocalWorld({ seed: 11, now: () => NOW, storage: null, era: 1 });
    saveOf(old).warSeen = ['w1abc.0'];
    const json = worldSaveJson(saveOf(old));
    const fresh = new LocalWorld({ seed: 12, now: () => NOW, storage: { read: () => json, write: () => {} }, era: 2 });
    expect(saveOf(fresh).warSeen ?? []).toEqual([]);
  });
});

describe('новая партия', () => {
  it('отметки дел алмазов и указов админа переезжают: сервер не положит их второй раз', () => {
    const g = useGame.getState();
    g.s.gemSeen = 4;
    g.s.adminSeen = 2;
    g.reset();
    const s = useGame.getState().s;
    // Граница области: партия правда новая.
    expect(s.time).toBe(0);
    expect(s.gemSeen).toBe(4);
    expect(s.adminSeen).toBe(2);
  });
});
