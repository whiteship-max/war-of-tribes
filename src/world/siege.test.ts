import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createInitialState } from '@/game/state';
import { RESOURCE_IDS, SIEGE_FOOD_YIELD, SIEGE_YIELD } from '@/game/constants';
import { productionPerDay, underSiege } from '@/game/derived';
import { tick } from '@/game/sim/tick';
import { LocalWorld } from './local/LocalWorld';
import { generateWorld } from './gen';
import { distance } from './geo';
import {
  SIEGE_BLOCK,
  consumptionPerHour,
  immuneUntil,
  openSiege,
  siegeActive,
  siegeImmune,
  starvesAt,
  type SiegeWindow,
} from './siege';
import { SIEGE_IF_BELOW, SIEGE_IMMUNE, SIEGE_ROUT } from './data/tuning';
import { syncSiege } from './bridge';
import type { FigureView, PlayerProfile, SettlementView, WorldPulse } from './types';

const START = 1_700_000_000_000;

/** Мир с ручными часами и без сохранения: тесты не трогают localStorage. */
function makeWorld(seed = 7) {
  let now = START;
  const world = new LocalWorld({ seed, now: () => now, storage: null });
  return {
    world,
    at: (t: number): void => {
      now = t;
    },
    advance: (ms: number): void => {
      now += ms;
    },
    now: (): number => now,
  };
}

/**
 * Слепок деревни, которую штурмовать бессмысленно. Оборона нарочно огромная:
 * мощь набега упирается в долю мощи соседа и оказывается заведомо ниже порога
 * `SIEGE_IF_BELOW` — то есть отряд гарантированно садится в осаду вместо
 * приступа. Так проверка не зависит от того, какой сосед выпал по сиду.
 */
const holdout = (over: Partial<PlayerProfile> = {}): PlayerProfile => ({
  name: 'Тест',
  pop: 120,
  defense: 100_000,
  warriorPower: 3,
  units: { warrior: 10, scout: 4 },
  command: 100,
  army: { spearman: 10 },
  resources: { food: 600, wood: 400 },
  // Часы голода: 6000 еды при 6000 в час на город и 60 на бойца.
  food: 6000,
  foodPerHour: 6000,
  soldierFoodPerHour: 60,
  ...over,
});

/** Дождаться, пока чужой отряд дойдёт до ворот и сядет лагерем. */
async function besiege(w: ReturnType<typeof makeWorld>, p: PlayerProfile): Promise<WorldPulse> {
  // Терпения нарочно много: осада теперь **редкость**, а не следствие порога.
  // Подошедший отряд садится лагерем не всегда (`SIEGE_CHANCE`), и под теми же
  // стенами лагерь не встаёт чаще, чем раз в `SIEGE_COOLDOWN`, — иначе крепкая
  // деревня видела бы осаду вместо набега почти всегда.
  for (let i = 0; i < 2500; i++) {
    w.advance(20_000);
    const pulse = await w.world.sync(p);
    if (pulse.siege) return pulse;
    const raid = pulse.marches.find((m) => !m.own && m.phase === 'out');
    if (!raid) continue;
    while (w.now() < raid.arriveAt) {
      w.advance(20_000);
      const step = await w.world.sync(p);
      if (step.siege) return step;
    }
    const last = await w.world.sync(p);
    if (last.siege) return last;
  }
  throw new Error('осады так и не случилось');
}

/** Ближайшее чужое поселение — обычная цель первого похода. */
async function neighbour(world: LocalWorld): Promise<SettlementView> {
  const info = await world.info();
  const chunk = await world.region({ x: info.home.x - 24, y: info.home.y - 24, w: 48, h: 48 });
  const list = chunk.settlements.filter((s) => !s.mine);
  expect(list.length).toBeGreaterThan(0);
  return list.sort((a, b) => distance(info.home, a) - distance(info.home, b))[0];
}

type SiegeSetup = Parameters<typeof openSiege>[0];

const window = (over: Partial<SiegeSetup> = {}): SiegeWindow =>
  openSiege({
    byId: 'S1',
    campId: 'm1',
    now: START,
    food: 6000,
    garrison: 0,
    townPerHour: 6000,
    perManPerHour: 60,
    ...over,
  });

describe('осада: окно и часы голода', () => {
  it('одинаковый вход даёт одинаковый выход — и ни один вызов не двигает окно', () => {
    const w = window({ garrison: 25 });
    const copy = { ...w };
    const a = starvesAt(w);
    const b = starvesAt(w);
    expect(a).toBe(b);
    expect(consumptionPerHour(w)).toBe(consumptionPerHour(w));
    // Чистая функция: спросили дважды — окно осталось тем же.
    expect(w).toEqual(copy);
    // И оно же выводится из полей, а не из часов: тот же вход — то же число.
    expect(starvesAt(window({ garrison: 25 }))).toBe(a);
  });

  it('гарнизон входит в расход: чем он больше, тем раньше голод', () => {
    const empty = starvesAt(window({ garrison: 0 }));
    const some = starvesAt(window({ garrison: 25 }));
    const many = starvesAt(window({ garrison: 100 }));
    expect(some).toBeLessThan(empty);
    expect(many).toBeLessThan(some);
    // Ровно то следствие, ради которого всё заведено: гарнизон, выигрывающий
    // бой, проедает город быстрее.
    expect(consumptionPerHour(window({ garrison: 100 }))).toBeGreaterThan(
      consumptionPerHour(window({ garrison: 0 })),
    );
  });

  it('окно не кончается раньше и не тянется дольше своего часа', () => {
    const w = window({ garrison: 10 });
    const at = starvesAt(w);
    expect(siegeActive(w, at - 1)).toBe(true);
    expect(siegeActive(w, at)).toBe(false);
    expect(siegeActive(w, at + 1)).toBe(false);
    expect(siegeActive(undefined, START)).toBe(false);
  });

  it('пустой амбар падает сразу, а нулевой расход всё равно кончается', () => {
    expect(starvesAt(window({ food: 0 }))).toBe(START);
    // Предохранитель: при нулевом расходе окно было бы вечным.
    const still = window({ townPerHour: 0, perManPerHour: 0, garrison: 0 });
    expect(Number.isFinite(starvesAt(still))).toBe(true);
  });

  it('окно неприкосновенности держится ровно объявленный срок', () => {
    const until = immuneUntil(START);
    expect(until - START).toBe(SIEGE_IMMUNE);
    expect(siegeImmune(until, START)).toBe(true);
    expect(siegeImmune(until, until - 1)).toBe(true);
    expect(siegeImmune(until, until)).toBe(false);
    // Не осаждали — не защищено: пустая запись не должна читаться как броня.
    expect(siegeImmune(undefined, START)).toBe(false);
  });
});

describe('осада: дебаф на выработку', () => {
  const besieged = (until: number) => {
    const s = createInitialState();
    s.siege = { byName: 'Соседи', until, garrison: 10 };
    return s;
  };

  it('хлеб не идёт вовсе, прочее идёт четвертью — и это чистая функция от состояния', () => {
    const free = createInitialState();
    const under = besieged(free.time + 600);
    const a = productionPerDay(free);
    const b = productionPerDay(under);
    expect(b.food).toBe(a.food * SIEGE_FOOD_YIELD);
    expect(b.food).toBe(0);
    for (const r of RESOURCE_IDS) {
      if (r === 'food') continue;
      expect(b[r], r).toBeCloseTo(a[r] * SIEGE_YIELD, 6);
    }
    // Тот же вход — тот же выход: производные ничего не запоминают.
    expect(productionPerDay(besieged(free.time + 600))).toEqual(b);
  });

  it('осада кончается сама по игровому времени, а не по пульсу мира', () => {
    const s = besieged(100);
    s.time = 99;
    expect(underSiege(s)).toBe(true);
    s.time = 100;
    expect(underSiege(s)).toBe(false);
    // Догон офлайна проходит через ту же отметку и снимает дебаф ровно на ней.
    expect(productionPerDay(s).food).toBeGreaterThan(0);
  });

  it('склад не уходит в минус: осада режет приток, а не разоряет задним числом', () => {
    const s = createInitialState();
    s.siege = { byName: 'Соседи', until: s.time + 100_000, garrison: 10 };
    // Амбар пуст, племя большое: под осадой еда не придёт вовсе.
    for (const r of RESOURCE_IDS) s.resources[r] = 0;
    for (let i = 0; i < 200; i++) tick(s, 1);
    for (const r of RESOURCE_IDS) expect(s.resources[r], r).toBeGreaterThanOrEqual(0);

    // А накопленное осада не отнимает: то, что лежало, лежит — минус только
    // обычный расход, который был бы и без неё.
    const rich = createInitialState();
    rich.siege = { byName: 'Соседи', until: rich.time + 100_000, garrison: 10 };
    const before = rich.resources.stone;
    tick(rich, 1);
    expect(rich.resources.stone).toBeGreaterThanOrEqual(before);
  });

  it('мост переводит мировые часы в игровые, а не кладёт их в состояние', () => {
    const s = createInitialState();
    s.time = 500;
    const view = {
      byId: 'S1',
      byName: 'Соседи',
      since: START,
      starvesAt: START + 120_000,
      garrison: 7,
      foodAtStart: 6000,
    };
    expect(syncSiege(s, view, START)).toBe(true);
    expect(s.siege?.until).toBeCloseTo(500 + 120, 6);
    expect(s.siege?.garrison).toBe(7);
    // Пульс идёт каждые две секунды: без изменений он не должен ничего трогать.
    expect(syncSiege(s, view, START)).toBe(false);
    expect(syncSiege(s, null, START)).toBe(true);
    expect(s.siege).toBeNull();
  });
});

describe('осада в мире: лагерь, голод и падение', () => {
  it('заведомо слабый отряд не идёт на приступ, а садится лагерем', async () => {
    const w = makeWorld(7);
    const p = holdout();
    await w.world.sync(p);
    const pulse = await besiege(w, p);

    const siege = pulse.siege!;
    expect(siege.garrison, 'часы считаны по домашней дружине').toBe(10);
    expect(siege.foodAtStart).toBe(6000);
    expect(siege.starvesAt).toBeGreaterThan(w.now());

    // Лагерь стоит у ворот и виден на карте — стоянкой, а не походом.
    const camp = pulse.marches.find((m) => !m.own);
    expect(camp?.phase).toBe('stay');
    expect(camp?.siege).toBe(true);

    // Приступа не было: боя в отчётах нет, зато есть отчёт об осаде.
    const reports = await w.world.reports();
    expect(reports.some((r) => r.battle)).toBe(false);
    expect(reports.some((r) => r.title === 'Город в осаде')).toBe(true);

    // И письмо о ней — без выбора: осаду снимают вылазкой, а не ответом гонцу.
    const letters = await w.world.letters();
    const letter = letters.find((l) => l.kind === 'siege');
    expect(letter, 'письмо об осаде обязано лечь на стол').toBeTruthy();
    expect(letter?.choices).toEqual([]);
    expect(letter?.until).toBe(siege.starvesAt);
  }, 60_000);

  it('крепкий отряд по-прежнему идёт на приступ', async () => {
    // Оборона обычная — набег в неё упирается и лезет на стену, как и раньше.
    const w = makeWorld(7);
    const p = holdout({ defense: 1 });
    await w.world.sync(p);
    for (let i = 0; i < 400; i++) {
      w.advance(20_000);
      const pulse = await w.world.sync(p);
      expect(pulse.siege, 'при слабой обороне осады не бывает').toBeNull();
      if (pulse.reports.some((r) => r.kind === 'defense' && r.battle)) return;
    }
    throw new Error('боя так и не случилось');
  }, 60_000);

  it('порог осады — про мощь, а не про сид: он записан числом', () => {
    // Число живёт в одном месте и читается как доля обороны.
    expect(SIEGE_IF_BELOW).toBeGreaterThan(0);
    expect(SIEGE_IF_BELOW).toBeLessThan(1);
  });

  it('падение наступает ровно в starvesAt: ни раньше, ни позже', async () => {
    const w = makeWorld(7);
    const p = holdout();
    await w.world.sync(p);
    const at = (await besiege(w, p)).siege!.starvesAt;

    // За миллисекунду до — лагерь ещё стоит, и ничего не случилось.
    w.at(Math.floor(at) - 1);
    const before = await w.world.sync(p);
    expect(before.siege, 'до отметки осада идёт').toBeTruthy();
    expect(before.effects).toEqual([]);

    // В отметку — город пал.
    w.at(Math.ceil(at));
    const after = await w.world.sync(p);
    expect(after.siege).toBeNull();
    const effect = after.effects.find((e) => e.text.includes('Осада'));
    expect(effect, 'падение обязано приехать последствием').toBeTruthy();
    // Гарнизон рассеян — объявленной долей, а не наугад.
    expect(effect?.lostTroops?.spearman).toBe(Math.floor(10 * SIEGE_ROUT));
    // Склад вычищен в пределах грузоподъёмности: унесли, а не обнулили.
    const taken = Object.values(effect?.resources ?? {}).reduce((n, v) => n + Math.abs(v ?? 0), 0);
    expect(taken).toBeGreaterThan(0);
    // Боя не было: голод не записывается в проигранные битвы.
    expect(effect?.battle).toBeNull();
    // Лагерь снялся и пошёл домой.
    const camp = after.marches.find((m) => !m.own);
    expect(camp === undefined || camp.phase === 'back').toBe(true);
    // Письмо об осаде ушло со стола вместе с ней.
    expect((await w.world.letters()).some((l) => l.kind === 'siege')).toBe(false);
  }, 60_000);

  it('павший город нельзя осадить снова, пока держится неприкосновенность', async () => {
    const w = makeWorld(7);
    const p = holdout();
    await w.world.sync(p);
    const at = (await besiege(w, p)).siege!.starvesAt;
    w.at(Math.ceil(at));
    const fell = w.now();
    await w.world.sync(p);

    // Внутри окна лагерь под стены не встаёт, как ни ходи чужие отряды.
    while (w.now() < fell + SIEGE_IMMUNE - 60_000) {
      w.advance(20_000);
      const pulse = await w.world.sync(p);
      expect(pulse.siege, 'вторая осада подряд запрещена').toBeNull();
    }
    // А после окна — снова можно: это пауза, а не отмена механики.
    const again = await besiege(w, p);
    expect(again.siege).toBeTruthy();
    expect(w.now()).toBeGreaterThanOrEqual(fell + SIEGE_IMMUNE);
  }, 120_000);
});

describe('осада: из города не выступают', () => {
  /**
   * Точки, из которых войска и фигуры выходят наружу. Их ровно столько, сколько
   * мест в `LocalWorld`, где рождается движение: четыре `marches.push` (набег
   * ИИ, `send` игрока, война соседей между собой и отряд на выручку осаждённому
   * двору) и два `phase = 'moving'` (`moveFigure` и погоня `setChase`).
   *
   * Из четырёх походов игроку принадлежит ровно один — `send`, и только он
   * спрашивает дверь. Остальные три заводит мир: своей осадой они игрока не
   * выпускают и выпускать не должны.
   *
   * Тест читает исходник нарочно — как это делает `gems.test.ts` со своим
   * запретом. Появится третье такое место — счёт разойдётся, и тот, кто его
   * завёл, узнает об этом здесь, а не от игрока, чей приказ молча ничего не
   * сделал.
   */
  it('мест, откуда можно выйти, ровно столько, сколько закрыто', () => {
    const src = readFileSync(path.join(process.cwd(), 'src/world/local/LocalWorld.ts'), 'utf8');
    const moves = src.match(/phase = 'moving'/g) ?? [];
    const pushes = src.match(/marches\.push\(/g) ?? [];
    expect(moves.length, 'фигура трогается с места ровно в двух местах').toBe(2);
    expect(pushes.length, 'поход заводится ровно в четырёх местах').toBe(4);
    // И все четыре приказа, ведущие в эти места, спрашивают одну и ту же дверь.
    expect((src.match(/this\.siegeBlock\(now\)/g) ?? []).length).toBe(4);
  });

  it('гонец, фигура, дружина и перехват — все получают отказ с причиной', async () => {
    const w = makeWorld(7);
    const p = holdout();
    await w.world.sync(p);
    const target = await neighbour(w.world);

    // До осады всё это можно — иначе проверять было бы нечего.
    expect((await w.world.send({ target: target.id, mission: 'scout', units: { scout: 1 } })).error).toBeNull();
    expect(await w.world.moveFigure('spy', { x: target.x, y: target.y })).toBeNull();

    await besiege(w, p);

    const sent = await w.world.send({ target: target.id, mission: 'scout', units: { scout: 1 } });
    expect(sent.error).toBe(SIEGE_BLOCK);
    expect(sent.march).toBeNull();
    expect(await w.world.moveFigure('diplomat', { x: target.x, y: target.y })).toBe(SIEGE_BLOCK);
    expect(await w.world.moveFigure('general', { x: target.x, y: target.y })).toBe(SIEGE_BLOCK);
    expect(await w.world.setGarrison({ spearman: 5 })).toBe(SIEGE_BLOCK);
    expect(await w.world.intercept('m1')).toBe(SIEGE_BLOCK);

    // И карточка своей деревни говорит то же самое, а не молчит.
    const card = await w.world.settlement('home');
    expect(card?.note).toContain(SIEGE_BLOCK);
  }, 60_000);

  it('дорога домой открыта: запрет на выход не запирает снаружи', async () => {
    const w = makeWorld(7);
    const p = holdout();
    await w.world.sync(p);
    const target = await neighbour(w.world);
    expect(await w.world.moveFigure('scout', { x: target.x, y: target.y })).toBeNull();
    const walk = (await w.world.figures()).find((f) => f.id === 'scout') as FigureView;
    w.at(walk.arriveAt);
    await w.world.sync(p);

    await besiege(w, p);
    // Разведчик застигнут осадой в поле — и обязан суметь вернуться.
    expect(await w.world.recallFigure('scout')).toBeNull();
    expect((await w.world.figures()).find((f) => f.id === 'scout')?.phase).toBe('moving');
  }, 60_000);
});

describe('осада: подкрепление и часы голода', () => {
  it('отряд, вышедший до осады, доходит домой, и часы считаются заново', async () => {
    const w = makeWorld(7);
    const p = holdout();
    await w.world.sync(p);
    // Цель нарочно дальняя: дорога туда и обратно длиннее, чем предупреждение о
    // набеге, поэтому отряд заведомо ещё в пути, когда лагерь встанет у ворот.
    // Берётся она из генератора, а не из карты: за туманом её ещё не видно, а
    // послать туда отряд ничто не мешает.
    const gen = generateWorld(7);
    const far = gen.settlements
      .map((s) => ({ s, d: distance(gen.home, s) }))
      .filter((x) => x.d > 45 && x.d < 80)
      .sort((a, b) => b.d - a.d)[0];
    expect(far, 'в мире должен найтись дальний двор').toBeTruthy();

    // Ждём чужой отряд: до его прихода у нас есть предупреждение, и внутри него
    // мы и отправляем своих.
    let raid = null as ReturnType<typeof Object> | null;
    for (let i = 0; i < 400 && !raid; i++) {
      w.advance(20_000);
      const pulse = await w.world.sync(p);
      raid = pulse.marches.find((m) => !m.own && m.phase === 'out') ?? null;
    }
    expect(raid, 'чужой отряд так и не вышел').toBeTruthy();
    const comes = (raid as { arriveAt: number }).arriveAt;

    expect((await w.world.send({ target: far.s.id, mission: 'scout', units: { scout: 2 } })).error).toBeNull();
    // Разворачиваем перед самым приходом чужих: обратная дорога равна пройденной,
    // значит домой он попадёт заведомо позже, чем начнётся осада.
    w.at(comes - 30_000);
    await w.world.sync(p);
    expect(await w.world.recall((await w.world.marches()).find((m) => m.own)!.id)).toBeNull();

    const before = (await besiege(w, p)).siege!;
    const walking = (await w.world.marches()).find((m) => m.own);
    expect(walking, 'отряд, шедший домой, никуда не делся').toBeTruthy();
    expect(walking!.phase, 'и он именно идёт домой, а не подвешен').toBe('back');

    // Доводим его до ворот: он обязан дойти и привезти последствие.
    for (let i = 0; i < 400; i++) {
      w.advance(20_000);
      const pulse = await w.world.sync(p);
      if (pulse.effects.some((e) => e.text.includes('вернул'))) {
        // Приход подкрепления пересчитал окно: отметка голода уехала.
        expect(pulse.siege, 'осада при этом никуда не делась').toBeTruthy();
        expect(pulse.siege!.starvesAt).not.toBe(before.starvesAt);
        return;
      }
    }
    throw new Error('отряд так и не дошёл домой');
  }, 60_000);

  it('дружину вернуть можно, и часы голода принимают новых едоков', async () => {
    const w = makeWorld(7);
    // Дружина уже при полководце: дома её нет, и осада считает пустой гарнизон.
    const away = holdout({ army: {} });
    await w.world.sync(holdout());
    expect(await w.world.setGarrison({ spearman: 10 })).toBeNull();
    const g = (await w.world.figures()).find((f) => f.id === 'general') as FigureView;
    w.at(g.readyAt);
    await w.world.sync(away);

    const empty = (await besiege(w, away)).siege!;
    expect(empty.garrison, 'дома дружины нет').toBe(0);

    // Вернуть её в осаждённый город можно: под запретом выход, а не вход.
    expect(await w.world.setGarrison(null)).toBeNull();
    const back = (await w.world.figures()).find((f) => f.id === 'general') as FigureView;
    w.at(Math.max(w.now(), back.readyAt));
    const pulse = await w.world.sync(away);

    expect(pulse.siege!.garrison, 'десять новых ртов за стеной').toBe(10);
    // И они едят: час голода стал короче, чем был бы у пустого города.
    const held = pulse.siege!.starvesAt - w.now();
    const alone = starvesAt(window({ now: w.now(), garrison: 0 })) - w.now();
    expect(held).toBeLessThan(alone);
  }, 60_000);
});
