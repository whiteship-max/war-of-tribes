import { describe, expect, it } from 'vitest';
import { createInitialState } from '../state';
import { DAY_LENGTH, MAX_BUILDING_LEVEL } from '../constants';
import { deserialize, serialize } from '../save';
import { LOG_MAX, LOG_MAX_DAYS, log, trimLog } from './log';
import { catchUp, tick } from './tick';
import { buyGoods } from './market';
import { buildingOfType, dayOf, marketLeft, marketOffer, storageCap } from '../derived';

/** Кладёт запись задним числом: `at` считается от нынешнего времени. */
function backdate(s: ReturnType<typeof createInitialState>, daysAgo: number, text: string): void {
  s.log.unshift({ at: s.time - daysAgo * DAY_LENGTH, text, kind: 'info' });
  s.log.sort((a, b) => b.at - a.at);
}

describe('летопись', () => {
  it('запись помечена временем, и по нему считается возраст', () => {
    const s = createInitialState();
    s.time = 12 * DAY_LENGTH;
    log(s, 'Кузнец встал к горну.');
    expect(s.log[0].at).toBe(s.time);
    expect(dayOf(s.log[0].at)).toBe(13);
  });

  it('старше месяца выбрасывается, младше — остаётся', () => {
    const s = createInitialState();
    s.time = 100 * DAY_LENGTH;
    s.log = [];
    backdate(s, 1, 'вчера');
    backdate(s, LOG_MAX_DAYS - 1, 'почти месяц назад');
    backdate(s, LOG_MAX_DAYS + 1, 'больше месяца назад');
    backdate(s, LOG_MAX_DAYS * 3, 'три месяца назад');

    trimLog(s);

    const texts = s.log.map((e) => e.text);
    expect(texts).toContain('вчера');
    expect(texts).toContain('почти месяц назад');
    expect(texts).not.toContain('больше месяца назад');
    expect(texts).not.toContain('три месяца назад');
  });

  it('обрезка идёт по возрасту, а не по количеству: сотня записей за сутки остаётся целиком', () => {
    const s = createInitialState();
    s.time = 50 * DAY_LENGTH;
    s.log = [];
    // Прежнее правило «последние 80» срезало бы два десятка — а им всего по дню.
    for (let i = 0; i < 100; i++) log(s, `событие ${i}`);
    trimLog(s);
    expect(s.log).toHaveLength(100);
  });

  it('запасной предел держит бурную партию: больше LOG_MAX записей не хранится', () => {
    const s = createInitialState();
    s.time = 50 * DAY_LENGTH;
    s.log = [];
    for (let i = 0; i < LOG_MAX * 2; i++) log(s, `событие ${i}`);
    expect(s.log).toHaveLength(LOG_MAX);
    // Отрезан хвост, а не голова: свежее остаётся.
    expect(s.log[0].text).toBe(`событие ${LOG_MAX * 2 - 1}`);
    trimLog(s);
    expect(s.log.length).toBeLessThanOrEqual(LOG_MAX);
  });

  it('записи из будущего не отбрасываются: у них отрицательный возраст', () => {
    const s = createInitialState();
    s.time = 10 * DAY_LENGTH;
    s.log = [];
    backdate(s, -5, 'из будущего');
    trimLog(s);
    expect(s.log.map((e) => e.text)).toContain('из будущего');
  });

  it('на смене суток летопись сама теряет старое', () => {
    const s = createInitialState();
    s.tutorialDone = true;
    s.log = [];
    log(s, 'первый день');
    // Прокручиваем больше месяца: запись первого дня обязана уйти сама, без
    // единого вызова trimLog со стороны.
    catchUp(s, (LOG_MAX_DAYS + 2) * DAY_LENGTH, 5);
    expect(s.log.map((e) => e.text)).not.toContain('первый день');
    const oldest = Math.min(...s.log.map((e) => e.at));
    expect(s.time - oldest).toBeLessThanOrEqual(LOG_MAX_DAYS * DAY_LENGTH);
  });

  it('повторы склеиваются счётчиком, а не занимают по строке', () => {
    const s = createInitialState();
    s.time = 50 * DAY_LENGTH;
    s.log = [];
    for (let i = 0; i < 30; i++) log(s, 'Кузница: готов копьё.', 'good', 'forge:spear');
    expect(s.log).toHaveLength(1);
    expect(s.log[0].n).toBe(30);
  });

  it('склейка не рвётся о чужие записи того же дня', () => {
    const s = createInitialState();
    s.time = 50 * DAY_LENGTH;
    s.log = [];
    // Между копьями ложатся итог дня, событие, смена сезона — по одной голове
    // склейка рвалась на каждой из них, и за месяц строк выходило вдвое больше.
    for (let i = 0; i < 10; i++) {
      log(s, 'Кузница: готов копьё.', 'good', 'forge:spear');
      log(s, `Итог дня ${i}.`);
    }
    const forge = s.log.filter((e) => e.group === 'forge:spear');
    expect(forge).toHaveLength(1);
    expect(forge[0].n).toBe(10);
  });

  it('склейка не переживает смену суток: вчерашняя ковка — отдельная строка', () => {
    const s = createInitialState();
    s.time = 50 * DAY_LENGTH;
    s.log = [];
    log(s, 'Кузница: готов копьё.', 'good', 'forge:spear');
    s.time += DAY_LENGTH + 1;
    log(s, 'Кузница: готов копьё.', 'good', 'forge:spear');
    expect(s.log.filter((e) => e.group === 'forge:spear')).toHaveLength(2);
  });

  it('разные ключи не склеиваются между собой, а записи без ключа — никогда', () => {
    const s = createInitialState();
    s.time = 50 * DAY_LENGTH;
    s.log = [];
    log(s, 'Кузница: готов копьё.', 'good', 'forge:spear');
    log(s, 'Кузница: готов щит.', 'good', 'forge:shield');
    expect(s.log).toHaveLength(2);
    // Две зимы подряд — это две зимы, а не «зима ×2».
    log(s, 'Пришла зима.', 'bad');
    log(s, 'Пришла зима.', 'bad');
    expect(s.log.filter((e) => e.text === 'Пришла зима.')).toHaveLength(2);
  });

  it('склейка не ломает порядок: летопись остаётся отсортированной по времени', () => {
    const s = createInitialState();
    s.time = 50 * DAY_LENGTH;
    s.log = [];
    for (let i = 0; i < 12; i++) {
      log(s, 'Кузница: готов копьё.', 'good', 'forge:spear');
      s.time += 2;
      log(s, `Событие ${i}.`);
      s.time += 2;
    }
    // На порядке держится обрезка хвостом — сломав его, trimLog отрежет не то.
    for (let i = 1; i < s.log.length; i++) expect(s.log[i - 1].at).toBeGreaterThanOrEqual(s.log[i].at);
  });

  /**
   * Обещание «за месяц» проверяется не на ровной партии, а на той, где летопись
   * пишут чаще всего. Самый плотный писарь — рынок: кнопка покупки берёт по
   * единице за раз, а на каждый заказ ложились две строки, заказ и возвращение
   * каравана. Двадцать заказов в день — это сорок строк, запасной предел
   * `LOG_MAX` выбирался за неделю, и ступень «за месяц» показывала пять дней.
   * Молча: обещание месяца до этого теста нигде не проверялось.
   */
  it('месяц остаётся месяцем и у торгового племени: запасной предел не срабатывает', () => {
    const s = createInitialState();
    s.tutorialDone = true;
    // Потолок торговли, а не средний случай: рынок десятого уровня выкладывает
    // дюжину товаров, и племя каждый день берёт с прилавка всё. Склад тоже
    // десятого — иначе мерился бы не поток записей, а полный амбар.
    for (const t of ['market', 'storage'] as const) buildingOfType(s, t)!.level = MAX_BUILDING_LEVEL;
    let orders = 0;
    for (let day = 0; day < LOG_MAX_DAYS + 5; day++) {
      // Казна не кончается: проверяется летопись, а не баланс золота.
      s.gold = 2_000_000;
      for (const g of marketOffer(s)) {
        // В полный склад не покупаем: за товар, который испарится на пороге,
        // платят золотом, и второй раз так никто не делает.
        const room = g.resource ? storageCap(s) - s.resources[g.resource] : Infinity;
        for (let i = 0; i < Math.min(marketLeft(s, g), 8, room); i++) {
          if (buyGoods(s, g.id, 1) === null) orders++;
        }
      }
      for (let t = 0; t < DAY_LENGTH; t++) tick(s, 1);
    }
    // Дюжина товаров, три тысячи заказов за месяц с лишним — и всё это должно
    // уложиться в строку на товар в день.
    expect(marketOffer(s).length).toBeGreaterThan(10);
    expect(orders).toBeGreaterThan(2000);
    // Предел по количеству — запасной: сработал он, значит месяц не показан.
    expect(s.log.length).toBeLessThan(LOG_MAX);
    const oldest = Math.min(...s.log.map((e) => e.at));
    expect((s.time - oldest) / DAY_LENGTH).toBeGreaterThan(LOG_MAX_DAYS - 1);
  });

  it('сохранение с раздутой летописью приводится к месяцу на загрузке', () => {
    const s = createInitialState();
    s.time = 400 * DAY_LENGTH;
    s.log = [];
    // Такое сохранение могло записать прежнее правило: 80 строк за полгода.
    for (let i = 0; i < 80; i++) backdate(s, i * 5, `старая запись ${i}`);
    const loaded = deserialize(serialize(s));
    expect(loaded).not.toBeNull();
    const oldest = Math.min(...loaded!.log.map((e) => e.at));
    expect(loaded!.time - oldest).toBeLessThanOrEqual(LOG_MAX_DAYS * DAY_LENGTH);
    expect(loaded!.log.length).toBeLessThan(80);
  });
});
