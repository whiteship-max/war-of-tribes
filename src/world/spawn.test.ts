// Места появления на Сицилии (docs/test_world.md): двенадцать мест — данные, выведенные из атласа; все на суше острова,
// все в одном регионе, равномерно и не ближе ослабленной границы.
import { describe, expect, it } from 'vitest';
import { landmasses, settleable } from './land';
import { SETTLE_GAP } from './data/tuning';
import { theatreAt } from './theatre/theatre';
import {
  SICILY,
  SICILY_COUNT,
  SICILY_GAP,
  SICILY_THEATRE,
  deriveSicily,
  inSicilyTheatre,
  sicilyFit,
  sicilyLand,
  sicilySlot,
  spawnModeOf,
} from './spawn';

const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);

describe('места появления: Сицилия', () => {
  it('запечённый список — ровно вывод из атласа (детерминированно)', () => {
    // Поправил вывод или атлас и не пересобрал список — красное здесь, а не тихо другие места у сервера.
    expect(deriveSicily()).toEqual([...SICILY]);
  });

  it('остров размечен целиком и без материка: сотни клеток, все западнее Мессинского пролива', () => {
    const land = sicilyLand();
    // Граница области: разлив обязан остановиться на острове. Сицилия в атласе — 664 клетки (~25 тыс. км²);
    // уйди он через пролив — клеток были бы сотни тысяч, и правило «весь остров в одном регионе» проверялось бы
    // на материке.
    expect(land.length).toBe(664);
    expect(Math.max(...land.map((p) => p.x))).toBeLessThan(784);
  });

  it('весь остров — один регион, и это регион острова: на острове воюют друг с другом', () => {
    const ids = new Set(sicilyLand().map((p) => theatreAt(p.x, p.y)?.id ?? null));
    expect([...ids]).toEqual([SICILY_THEATRE]);
  });

  it('двенадцать мест: разные, на суше острова, годные под город, в регионе острова', () => {
    expect(SICILY.length).toBe(SICILY_COUNT);
    const land = new Set(sicilyLand().map((p) => `${p.x}|${p.y}`));
    const keys = new Set(SICILY.map((s) => `${s.x}|${s.y}`));
    expect(keys.size).toBe(SICILY_COUNT);
    for (const s of SICILY) {
      expect([s, land.has(`${s.x}|${s.y}`)]).toEqual([s, true]);
      expect([s, settleable(s.x, s.y), sicilyFit(s)]).toEqual([s, true, true]);
      expect([s, inSicilyTheatre(s)]).toEqual([s, true]);
      // Мир клиента строит дом на любой клетке, которую назвал реестр; но материк — условие обычного расселения, и
      // остров с ним связан: город на нём не «скала посреди моря».
      expect(landmasses().at(s.x, s.y)).toBe(landmasses().at(SICILY[0].x, SICILY[0].y));
    }
  });

  it('не ближе ослабленной границы и примерно на равном расстоянии друг от друга', () => {
    const nearest = SICILY.map((s, i) => Math.min(...SICILY.filter((_, j) => j !== i).map((t) => dist(s, t))));
    // Ослабленная граница — только для этих мест и меньше обычной.
    expect(SICILY_GAP).toBeLessThan(SETTLE_GAP);
    expect(Math.min(...nearest)).toBeGreaterThanOrEqual(SICILY_GAP);
    // Равномерность: самый дальний ближний сосед не дальше полутора самых ближних.
    expect(Math.max(...nearest) / Math.min(...nearest)).toBeLessThan(1.5);
  });

  it('места покрывают остров: любая клетка суши не дальше 7 клеток (~43 км) от ближнего места', () => {
    // Без этого «двенадцать мест» могли бы сбиться в одной половине острова и всё равно пройти тест расстояний.
    const far = Math.max(...sicilyLand().map((p) => Math.min(...SICILY.map((s) => dist(p, s)))));
    expect(far).toBeLessThanOrEqual(7);
  });

  it('номер места — по порядку списка, не место — 0', () => {
    expect(sicilySlot(SICILY[0])).toBe(1);
    expect(sicilySlot(SICILY[11])).toBe(12);
    expect(sicilySlot({ x: SICILY[0].x + 1, y: SICILY[0].y })).toBe(0);
  });

  it('режим — только sicily; пусто и прочее — обычное расселение', () => {
    expect(spawnModeOf('sicily')).toBe('sicily');
    expect(spawnModeOf(' Sicily ')).toBe('sicily');
    expect(spawnModeOf(undefined)).toBeNull();
    expect(spawnModeOf('')).toBeNull();
    expect(spawnModeOf('malta')).toBeNull();
  });
});
