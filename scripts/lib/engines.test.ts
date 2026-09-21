// Расчёт орудия башни — число выведенное, и вывод у него один на отчёт и на тест.
import { describe, expect, it } from 'vitest';
import { ENGINES } from '@/game/data/engines';
import { archerPerSiege, crewFor, enginePrice } from './engines';

/**
 * Расчёт орудия — число выведенное, и вывод у него один на отчёт и на тест (`scripts/lib/engines`).
 *
 * Правило (docs/tower.md, раздел 4): расчёт — **наименьшее** число лучников, чьё жалованье от осады
 * до осады не меньше цены орудия. «Не меньше» тут нижняя граница, а не равенство, поэтому проверять
 * надо именно наименьшее: расчёт вчетверо больше нужного правилу тоже «не меньше», и четыре стояли
 * в коде до 21.09.2026 ровно так — верные при дне в минуту и никем не пересчитанные после поворота
 * шкалы (docs/time.md, раздел 19.3).
 *
 * Частота осад — замер, а не свойство кода, и числом она живёт здесь: её печатает
 * `npm run siege:report`, раздел «частота» (22 осады за 8 640 игровых дней — раз в 393). Сдвинется
 * замер — отчёт скажет «РАСХОДИТСЯ» той же дверью, и число правится здесь сознательно, как счёт
 * классов времени в `scripts/lib/timeclasses.test.ts`.
 */
describe('расчёт орудия окупает его цену жалованьем расчёта', () => {
  /** Игровых дней между осадами одного города — `npm run siege:report`, раздел «частота». */
  const DAYS_PER_SIEGE = 393;

  it('в коде стоит наименьшее число лучников, которое окупает орудие', () => {
    // Точка внутри области: у обоих орудий цена и заработок лучника не нулевые, иначе правило
    // не спрашивается и любое число проходит.
    expect(archerPerSiege(DAYS_PER_SIEGE), 'лучник от осады до осады чего-то стоит').toBeGreaterThan(0);
    for (const e of ENGINES) {
      expect(enginePrice(e.id), `${e.id}: цена орудия`).toBeGreaterThan(0);
      expect(e.crew, `${e.id}: расчёт — наименьший, который окупает`).toBe(crewFor(e.id, DAYS_PER_SIEGE));
    }
  });

  it('расчёт и есть окупаемость: на человека меньше — уже не окупает', () => {
    const per = archerPerSiege(DAYS_PER_SIEGE);
    for (const e of ENGINES) {
      expect(e.crew * per, `${e.id}: расчёт окупает цену`).toBeGreaterThanOrEqual(enginePrice(e.id));
      if (e.crew > 1) {
        expect((e.crew - 1) * per, `${e.id}: расчёт без одного уже не окупает`).toBeLessThan(enginePrice(e.id));
      }
    }
  });

  it('дороже орудие — не меньше расчёт, и он помещается на башню', () => {
    const sorted = [...ENGINES].sort((a, b) => enginePrice(a.id) - enginePrice(b.id));
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].crew, `${sorted[i].id} дороже ${sorted[i - 1].id}`).toBeGreaterThanOrEqual(sorted[i - 1].crew);
    }
  });
});
