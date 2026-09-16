import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createInitialState } from '@/game/state';
import { RESOURCE_IDS, SIEGE_FOOD_YIELD, SIEGE_YIELD } from '@/game/constants';
import { productionPerDay, underSiege } from '@/game/derived';
import { catchUp, tick } from '@/game/sim/tick';
import { LocalWorld } from './local/LocalWorld';
import { generateWorld } from './gen';
import { distance } from './geo';
import {
  CAMP_LEAVE,
  SIEGE_BLOCK,
  consumptionPerHour,
  immuneUntil,
  openSiege,
  siegeActive,
  siegeImmune,
  starvesAt,
  type SiegeWindow,
} from './siege';
import { AI_BONDED_SHARE, BURN_IMMUNE, FALL_BUILDINGS, SIEGE_CHANCE, SIEGE_COOLDOWN, SIEGE_IF_BELOW, SIEGE_IMMUNE, SIEGE_ROUT } from './data/tuning';
import { FATE_DEFAULT, FATE_IDS, burnImmuneUntil, fallSeed, fate, lead } from './spoils';
import { stackCarry, stackEscort } from './data/units';
import { applyEffects, playerProfile, syncSiege } from './bridge';
import { bondedTotal } from '@/game/derived';
import type { GameState } from '@/game/types';
import { fallPool, fallenText } from '@/game/sim/expedition';
import { troopTotal } from '@/game/battle/kinds';
import type { GenSettlement } from './gen';
import type { WorldSave } from './local/state';
import type { Fate, FigureView, PlayerProfile, SettlementView, SiegeView, WorldPulse } from './types';
import type { TroopStack } from '@/game/battle/kinds';

/**
 * Спящие случаи. Чужих дворов на карте не осталось ни одного: мир стал общим, а
 * замки на нём появятся при регистрации живых игроков. Механика цела — участников
 * у неё пока нет, и притворяться, что случай проверен, нельзя. Полный список:
 * `grep -rn waitsForPlayers src`.
 */
const waitsForPlayers = it.skip;

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
  army: { spearman: 10 },
  stock: { food: 600, wood: 400 },
  stash: 0,
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
    s.siege = { byName: 'Соседи', until };
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

  it('при игроке осаду снимает мир, а не свой срок племени', () => {
    // Срок голода, переведённый в игровое время, уже прошёл: точка там, где две правды
    // о сроке и расходились бы — часы племени говорят «кончилась», мир ещё не сказал.
    const s = besieged(100);
    s.time = 99;
    tick(s, 2);
    expect(s.time, 'точка за отметкой срока').toBeGreaterThanOrEqual(100);
    expect(underSiege(s), 'поле лежит — осада идёт').toBe(true);
    expect(productionPerDay(s).food).toBe(0);
    // Снимает её пульс мира — и срез кончается тем же пульсом.
    syncSiege(s, null, START);
    expect(underSiege(s)).toBe(false);
    expect(productionPerDay(s).food).toBeGreaterThan(0);
  });

  it('офлайн-догон, у которого мира нет, снимает осаду по сроку голода — ровно на нём', () => {
    const s = besieged(100);
    s.time = 90;
    catchUp(s, 8, 2);
    expect(s.time, 'до отметки').toBeLessThan(100);
    expect(underSiege(s)).toBe(true);
    catchUp(s, 2, 2);
    expect(s.time, 'на отметке').toBe(100);
    expect(s.siege, 'догон снял поле сам').toBeNull();
    expect(productionPerDay(s).food).toBeGreaterThan(0);
  });

  it('срок осады у племени читает одно место — догон; при игроке его не сверяет никто', () => {
    // Вторая правда о сроке заводится одной строкой: сверкой `s.time` с `siege.until`
    // в производных или в панели. Поэтому перечисляются все чтения срока по всему `src`.
    const root = path.join(__dirname, '..');
    const strip = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = path.join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(p);
      }
    };
    walk(root);
    const code = new Map(files.map((f) => [path.relative(root, f).split(path.sep).join('/'), strip(readFileSync(f, 'utf8'))]));
    const reads = /siege[?!]?\.until\b/;
    const readers = [...code].filter(([, src]) => reads.test(src)).map(([f]) => f);
    expect(readers.sort()).toEqual(['game/sim/tick.ts', 'world/bridge.ts']);
    // В тике — только за флагом догона.
    const line = (code.get('game/sim/tick.ts') ?? '').split('\n').find((l) => reads.test(l)) ?? '';
    expect(line, 'срок в тике читается только в догоне').toMatch(/opts\.offline/);
    // Производная осады на часы не смотрит.
    const derived = code.get('game/derived.ts') ?? '';
    const body = derived.slice(derived.indexOf('export const underSiege'), derived.indexOf('export const siegeYield'));
    expect(body, 'underSiege найдена').toMatch(/underSiege/);
    expect(body, 'underSiege сверяет срок').not.toMatch(/\btime\b|until/);
  });

  it('склад не уходит в минус: осада режет приток, а не разоряет задним числом', () => {
    const s = createInitialState();
    s.siege = { byName: 'Соседи', until: s.time + 100_000 };
    // Амбар пуст, племя большое: под осадой еда не придёт вовсе.
    for (const r of RESOURCE_IDS) s.resources[r] = 0;
    for (let i = 0; i < 200; i++) tick(s, 1);
    for (const r of RESOURCE_IDS) expect(s.resources[r], r).toBeGreaterThanOrEqual(0);

    // А накопленное осада не отнимает: то, что лежало, лежит — минус только
    // обычный расход, который был бы и без неё.
    const rich = createInitialState();
    rich.siege = { byName: 'Соседи', until: rich.time + 100_000 };
    const before = rich.resources.stone;
    tick(rich, 1);
    expect(rich.resources.stone).toBeGreaterThanOrEqual(before);
  });

  it('мост переводит мировые часы в игровые, а не кладёт их в состояние', () => {
    const s = createInitialState();
    s.time = 500;
    const view: SiegeView = {
      byId: 'S1',
      byName: 'Соседи',
      since: START,
      starvesAt: START + 120_000,
      garrison: 7,
      foodAtStart: 6000,
      campMen: 6,
      fate: FATE_DEFAULT,
      fall: { goods: 0, gold: 0, hidden: 0, ledBonded: 0, ledPop: 0, scatterPop: 0, scatterBonded: 0, buildings: 0, levels: 0, burnsWorks: false, routed: 0 },
      palisade: 1,
    };
    expect(syncSiege(s, view, START)).toBe(true);
    expect(s.siege?.until).toBeCloseTo(500 + 120, 6);
    // В племя едут имя и срок — и ничего больше: гарнизон окно осады берёт у мира.
    expect(Object.keys(s.siege ?? {}).sort()).toEqual(['byName', 'until']);
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

  it('павший голодом город невольников не теряет: ступень «ограбить» людей не уводит', async () => {
    // Прежде падение голодом уводило невольников всегда, а прорвавшийся набег —
    // никогда: два пути, два правила. Решено владельцем: уводит их только ступень
    // участи, уводящая людей, а её в игре пока нет (docs/DEFEAT_LADDER.md).
    const w = makeWorld(7);
    const p = holdout({ bonded: 400 });
    await w.world.sync(p);
    const pulse = await besiege(w, p);
    const at = pulse.siege!.starvesAt;
    const camp = pulse.marches.find((m) => !m.own && m.siege)!;
    expect(camp, 'лагерь стоит у ворот').toBeTruthy();
    // Граница области: увести было бы кого и было бы кому. Без этого «никого
    // не увели» получалось бы и от пустого конвоя.
    expect(lead(400, stackEscort(camp.units)).taken, 'конвой лагеря увёл бы невольников').toBeGreaterThan(0);

    w.at(Math.ceil(at));
    const after = await w.world.sync(p);
    const effect = after.effects.find((e) => e.text.includes('Осада'));
    expect(effect, 'город пал').toBeTruthy();
    expect(effect?.bonded ?? 0, 'невольники остаются при ступени «ограбить»').toBe(0);
    const report = after.reports.find((r) => r.title === 'Хлеб кончился');
    expect(report?.text).not.toContain('Уведено');
  }, 60_000);

  it('город без невольников при падении никого не теряет', async () => {
    const w = makeWorld(7);
    const p = holdout();
    await w.world.sync(p);
    const at = (await besiege(w, p)).siege!.starvesAt;
    w.at(Math.ceil(at));
    const effect = (await w.world.sync(p)).effects.find((e) => e.text.includes('Осада'));
    expect(effect).toBeTruthy();
    expect(effect?.bonded ?? 0).toBe(0);
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
    expect(moves.length, 'фигура трогается с места ровно в трёх местах').toBe(3);
    expect(pushes.length, 'поход заводится ровно в четырёх местах').toBe(4);
    // И все четыре приказа, ведущие в эти места, спрашивают одну и ту же дверь.
    expect((src.match(/this\.siegeBlock\(now\)/g) ?? []).length).toBe(4);
    // Третье место — удар по лагерю из поля — из города не выводит по учёту, а не
    // по двери: дома дружина — гарнизон (`fieldTroops`), и бить из поля некому.
    const strike = src.slice(src.indexOf('private strikeCheck('), src.indexOf('async strikePlan('));
    expect(strike, 'удар из поля спрашивает, в поле ли дружина').toMatch(/fieldTroops\(f, now\)/);
    expect(strike).toMatch(/STRIKE_FROM_TOWN/);
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
  waitsForPlayers('отряд, вышедший до осады, доходит домой, и часы считаются заново', async () => {
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
    // Дружина при полководце, а полководец в поле: за стеной она не ест, и осада
    // считает пустой гарнизон. Слепок везёт всё войско, как и везде: кто из него
    // в обороне, мир считает сам.
    const away = holdout();
    await w.world.sync(away);
    expect(await w.world.setGarrison({ spearman: 10 })).toBeNull();
    const g = (await w.world.figures()).find((f) => f.id === 'general') as FigureView;
    w.at(g.readyAt);
    await w.world.sync(away);
    const home = (await w.world.info()).home;
    expect(await w.world.moveFigure('general', { x: home.x + 4, y: home.y + 3 })).toBeNull();
    const out = (await w.world.figures()).find((f) => f.id === 'general') as FigureView;
    w.at(out.arriveAt);
    await w.world.sync(away);

    const empty = (await besiege(w, away)).siege!;
    expect(empty.garrison, 'дружина в поле — за стеной её нет').toBe(0);

    // Вернуться в осаждённый город можно: под запретом выход, а не вход. Встал у
    // своих ворот — дружина в обороне и ест за стеной.
    expect(await w.world.moveFigure('general', { ...home })).toBeNull();
    const walking = (await w.world.figures()).find((f) => f.id === 'general') as FigureView;
    w.at(Math.max(w.now(), walking.arriveAt));
    const pulse = await w.world.sync(away);

    expect(pulse.siege!.garrison, 'десять новых ртов за стеной').toBe(10);
    // И они едят: час голода стал короче, чем был бы у пустого города.
    const held = pulse.siege!.starvesAt - w.now();
    const alone = starvesAt(window({ now: w.now(), garrison: 0 })) - w.now();
    expect(held).toBeLessThan(alone);

    // Роспуск в осаждённом городе: пока он идёт, эти люди не едят нигде, а
    // вернувшись в гарнизон — едят снова.
    expect(await w.world.setGarrison(null)).toBeNull();
    expect((await w.world.sync(away)).siege!.garrison, 'в роспуске за стеной не едят').toBe(0);
    const back = (await w.world.figures()).find((f) => f.id === 'general') as FigureView;
    w.at(Math.max(w.now(), back.readyAt));
    expect((await w.world.sync(away)).siege!.garrison, 'вернулись в гарнизон').toBe(10);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Вторая половина осады: приказ игрока, лагерь как цель, вылазка.
// ---------------------------------------------------------------------------

/** Дружина, с которой ходят осаждать: заметно крупнее любого соседа. */
const HOST: TroopStack = { legionary: 30, spearman: 24, archer: 16 };

/** Слепок деревни, которая сама никого не боится: с ней и ходят в осаду. */
const host = (over: Partial<PlayerProfile> = {}): PlayerProfile => ({
  ...holdout(),
  defense: 900,
  army: { ...HOST },
  ...over,
});

/** Довести полководца с дружиной до ближайшего соседа. */
async function marchGeneral(
  w: ReturnType<typeof makeWorld>,
  p: PlayerProfile,
): Promise<SettlementView> {
  await w.world.sync(p);
  expect(await w.world.setGarrison({ ...HOST })).toBeNull();
  const ready = (await w.world.figures()).find((f) => f.id === 'general') as FigureView;
  w.at(Math.max(w.now(), ready.readyAt));
  await w.world.sync(p);
  const target = await neighbour(w.world);
  expect(await w.world.moveFigure('general', { x: target.x, y: target.y })).toBeNull();
  const walking = (await w.world.figures()).find((f) => f.id === 'general') as FigureView;
  w.at(Math.max(w.now(), walking.arriveAt));
  await w.world.sync(p);
  return target;
}

describe('осада: приказ игрока — та же осада, что и чужая', () => {
  it('полководец садится в осаду тем же окном и теми же часами голода', async () => {
    const w = makeWorld(7);
    const p = host();
    const target = await marchGeneral(w, p);

    expect(await w.world.besiege()).toBeNull();
    const card = await w.world.settlement(target.id);
    expect(card?.siege, 'лагерь под стенами виден').toBeTruthy();
    expect(card?.siege?.mine, 'и он наш').toBe(true);
    // Участник осады видит часы голода и в карточке — те же, что в окне своего лагеря:
    // прежде карточка молчала, и два места говорили об одной осаде разное. Совпадение на
    // любом состоянии держит `world/hunger.test.ts`; здесь — что поле на месте.
    expect(Object.keys(card?.siege ?? {})).toEqual(['mine', 'byName', 'since', 'wood', 'fate', 'starvesAt']);
    // Полководец занят: пока лагерь стоит, других дел у него нет.
    const fig = (await w.world.figures()).find((f) => f.id === 'general');
    expect(fig?.besieging).toBe(target.id);
    // Второй лагерь тем же полководцем не поставить.
    expect(await w.world.besiege()).toBeTruthy();
  }, 60_000);

  it('одна реализация на обе стороны: осада живёт в одном месте и одним окном', () => {
    const src = readFileSync(path.join(process.cwd(), 'src/world/local/LocalWorld.ts'), 'utf8');
    // Окно заводится ровно одной функцией — и своей, и чужой осадой.
    expect((src.match(/openSiege\(\{/g) ?? []).length, 'окно открывает одна функция').toBe(1);
    // Часы голода считает одна функция на обе стороны.
    expect((src.match(/private openSiegeAt\(/g) ?? []).length).toBe(1);
    expect((src.match(/private resiege\(/g) ?? []).length).toBe(1);
    // Осада пропадает из сохранения ровно в одном месте.
    expect((src.match(/delete this\.save\.sieges\[/g) ?? []).length, 'снимает осаду одно место').toBe(1);
    // И бой с лагерем один: вылазка, выручка и удар полководца зовут его же.
    expect((src.match(/private campBattle\(/g) ?? []).length).toBe(1);
    // Ветки «а если это наша осада» в падении города ровно одна — та, где
    // расходится добыча; всё остальное общее.
    expect((src.match(/private siegeFalls\(/g) ?? []).length).toBe(1);
  });

  it('увод полководца снимает осаду, и приказ об этом говорит заранее', async () => {
    const w = makeWorld(7);
    const p = host();
    const target = await marchGeneral(w, p);
    expect(await w.world.besiege()).toBeNull();

    // Слова о цене приказа живут в одном месте и стоят в панели до нажатия.
    expect(CAMP_LEAVE).toContain('осада снята');
    const menu = readFileSync(path.join(process.cwd(), 'src/ui/map/ActionMenu.tsx'), 'utf8');
    expect(menu, 'меню действий говорит цену увода').toContain('CAMP_LEAVE');

    const home = await w.world.info();
    expect(await w.world.moveFigure('general', { ...home.home })).toBeNull();
    await w.world.sync(p);
    const card = await w.world.settlement(target.id);
    expect(card?.siege, 'осада снята уходом').toBeNull();
    expect((await w.world.figures()).find((f) => f.id === 'general')?.besieging).toBeNull();
  }, 60_000);

  it('армия в лагере занята: перехвата нет, а удар по осаждённому городу — это штурм, и он снимает лагерь', async () => {
    // Прежде из-под своей осады не били вовсе. Окно осаждающего завело три приказа —
    // отступить, штурмовать, осаждать (решение владельца), — и штурм это удар по тому
    // самому городу: лагерь снимается до боя, а другие дела полководцу по-прежнему
    // заказаны.
    const w = makeWorld(7);
    const p = host();
    const target = await marchGeneral(w, p);
    expect(await w.world.besiege()).toBeNull();
    expect(await w.world.intercept('m1')).toContain('осаду');
    expect((await w.world.camp())?.targetId, 'окно лагеря видит свой город').toBe(target.id);
    const hit = await w.world.attack({ setup: null });
    expect(hit.error, 'штурм своего осаждённого города — приказ, а не отказ').toBeNull();
    expect((await w.world.settlement(target.id))?.siege, 'штурм снял лагерь').toBeNull();
    expect((await w.world.figures()).find((f) => f.id === 'general')?.besieging ?? null).toBeNull();
  }, 60_000);

  it('город падает от голода, и добыча едет домой', async () => {
    const w = makeWorld(7);
    const p = host();
    const target = await marchGeneral(w, p);
    expect(await w.world.besiege()).toBeNull();

    for (let i = 0; i < 900; i++) {
      w.advance(20_000);
      const pulse = await w.world.sync(p);
      const fell = pulse.reports.find((r) => r.title.startsWith('Город взят голодом'));
      if (!fell) continue;
      expect(fell.won).toBe(true);
      // Боя не было ни у нас, ни у них: голод в битвы не записывается.
      expect(fell.battle).toBeNull();
      const gain = pulse.effects.find((e) => e.text.includes('сдался голоду'));
      expect(gain, 'падение приезжает последствием').toBeTruthy();
      expect(gain?.battle).toBeNull();
      // Осада снята, полководец свободен.
      expect((await w.world.figures()).find((f) => f.id === 'general')?.besieging).toBeNull();
      // И второй раз подряд тот же город не осадить: в амбаре пусто.
      expect(await w.world.besiege()).toContain('доели');
      const card = await w.world.settlement(target.id);
      expect(card?.can.besiege).toBe(false);
      return;
    }
    throw new Error('город так и не пал');
  }, 120_000);

  it('чужой город, взятый голодом, невольников не отдаёт — тем же правилом, каким не отдаёт наш', async () => {
    const w = makeWorld(7);
    const p = host();
    const target = await marchGeneral(w, p);
    expect(await w.world.besiege()).toBeNull();
    const save = (w.world as unknown as { save: WorldSave }).save;
    const peek = w.world as unknown as {
      bondedAt(pop: number): number;
      popNow(s: GenSettlement, now: number): number;
      gen: { settlements: GenSettlement[] };
    };
    const town = peek.gen.settlements.find((x) => x.id === target.id)!;

    // Доводим осаду до последнего пульса перед падением: вылазка и выручка к
    // этому времени разобраны, и следующим событием будет только голод.
    for (let i = 0; i < 900; i++) {
      const win = save.sieges[target.id];
      expect(win, 'осада не должна сняться сама').toBeTruthy();
      if (starvesAt(win) - w.now() <= 30_000) break;
      w.advance(20_000);
      await w.world.sync(p);
    }
    const fallAt = starvesAt(save.sieges[target.id]);
    // У бота невольники — доля его людей, выведенная при чтении, как тайник из склада.
    const bonded = peek.bondedAt.call(w.world, peek.popNow.call(w.world, town, fallAt));
    expect(bonded).toBe(Math.round(peek.popNow.call(w.world, town, fallAt) * AI_BONDED_SHARE));
    const men = troopTotal(save.figures.general.troops ?? {});
    // Граница области: уводить есть кого и есть чем стеречь — иначе ноль ниже
    // получался бы без всякого правила.
    expect(lead(bonded, stackEscort({ warrior: men })).taken, 'дружина увела бы невольников').toBeGreaterThan(0);

    w.at(Math.ceil(fallAt));
    const pulse = await w.world.sync(p);
    const gain = pulse.effects.find((e) => e.text.includes('сдался голоду'));
    expect(gain, 'падение приезжает последствием').toBeTruthy();
    expect(gain?.bonded ?? 0, 'ступень «ограбить» людей не уводит и у чужого города').toBe(0);
  }, 120_000);
});

describe('осада: вылазка', () => {
  /** Осаждённая деревня с гарнизоном, которым есть чем выйти. */
  const holed = (): PlayerProfile => holdout({ army: { legionary: 40, spearman: 30, archer: 20 } });

  waitsForPlayers('победа снимает осаду, поражение — нет, и в обоих случаях лагерю достаётся', async () => {
    // Два прогона одного и того же положения: вылазка всем гарнизоном и
    // вылазка горсткой. Что бы ни вышло, лагерь обязан недосчитаться людей —
    // вылазка без урона противнику была бы чистым минусом, и кнопку не нажал
    // бы никто ни разу.
    let wins = 0;
    let losses = 0;
    for (const going of [{ legionary: 40, spearman: 30, archer: 20 }, { spearman: 3 }] as TroopStack[]) {
      const w = makeWorld(7);
      const p = holed();
      await w.world.sync(p);
      const start = await besiege(w, p);
      const camp = start.marches.find((m) => m.siege);
      expect(camp, 'лагерь стоит под стенами').toBeTruthy();

      const res = await w.world.sortie(going);
      expect(res.error).toBeNull();
      const after = await w.world.sync(p);
      const report = (await w.world.reports()).find((r) => r.id === res.reportId);
      expect(report, 'у боя есть отчёт').toBeTruthy();
      // Лагерю досталось в любом случае — это и есть смысл кнопки.
      expect(report!.enemyLost, 'лагерь недосчитался людей').toBeGreaterThan(0);
      if (res.won) {
        wins++;
        expect(after.siege, 'победа снимает осаду').toBeNull();
      } else {
        losses++;
        expect(after.siege, 'поражение осаду не снимает').toBeTruthy();
      }
    }
    expect(wins, 'полным гарнизоном вылазка выигрывает').toBeGreaterThan(0);
    expect(losses, 'горсткой — нет').toBeGreaterThan(0);
  }, 120_000);

  waitsForPlayers('часы голода пересчитаны после вылазки — и ровно один раз', async () => {
    const w = makeWorld(7);
    const p = holed();
    await w.world.sync(p);
    const before = (await besiege(w, p)).siege!;

    // Вылазка горсткой: осада останется, а гарнизон поредеет.
    const res = await w.world.sortie({ spearman: 3 });
    expect(res.error).toBeNull();
    expect(res.won).toBe(false);
    const after = (await w.world.sync(p)).siege!;
    expect(after, 'осада стоит').toBeTruthy();
    // Отметка голода уехала: часы пошли от нового гарнизона и остатка еды.
    expect(after.starvesAt).not.toBe(before.starvesAt);
    // Ровно один раз: пересчёт живёт в событии, а не в пульсе. Три пульса
    // подряд без единого события обязаны дать одну и ту же отметку.
    const a = (await w.world.sync(p)).siege!.starvesAt;
    w.advance(2000);
    const b = (await w.world.sync(p)).siege!.starvesAt;
    w.advance(2000);
    const c = (await w.world.sync(p)).siege!.starvesAt;
    expect(b).toBe(a);
    expect(c).toBe(a);
  }, 60_000);

  it('вылазка отказывает, когда выходить некому и не на кого', async () => {
    const w = makeWorld(7);
    const p = holed();
    await w.world.sync(p);
    // Под стенами никого — выходить не на кого.
    expect((await w.world.sortie({ spearman: 1 })).error).toContain('никого');
    await besiege(w, p);
    expect((await w.world.sortie({})).error).toContain('пустой');
    expect((await w.world.sortie({ spearman: 9999 })).error).toContain('нет');
  }, 60_000);
});

describe('осада: лагерь как цель на карте', () => {
  it('удар по лагерю из поля снимает осаду, и бьёт по нему тот же бой, что и вылазка', async () => {
    // Полководец с дружиной стоит в поле, когда под стены садится чужой лагерь.
    // Ударить по нему он может приказом издалека: бой — в минуту прихода, с тыла.
    const w = makeWorld(7);
    const p = holdout({ army: { legionary: 40, spearman: 30, archer: 20 } });
    await w.world.sync(p);
    // Дружину он берёт заранее и выводит в поле: во время осады из города её не вывести.
    expect(await w.world.setGarrison({ legionary: 40, spearman: 30, archer: 20 })).toBeNull();
    const g = (await w.world.figures()).find((f) => f.id === 'general') as FigureView;
    w.at(Math.max(w.now(), g.readyAt));
    await w.world.sync(p);
    const info = await w.world.info();
    expect(await w.world.moveFigure('general', { x: info.home.x + 3, y: info.home.y + 2 })).toBeNull();
    w.at((await w.world.figures()).find((f) => f.id === 'general')!.arriveAt);
    await w.world.sync(p);

    const start = await besiege(w, p);
    expect(start.siege).toBeTruthy();

    expect(await w.world.strikeCamp('home', false)).toBeNull();
    const moving = (await w.world.figures()).find((f) => f.id === 'general') as FigureView;
    expect(moving.arriveAt, 'дойдёт до голода').toBeLessThan(start.siege!.starvesAt);
    w.at(moving.arriveAt);
    const after = await w.world.sync(p);
    const hit = (await w.world.reports()).find((r) => r.id.startsWith('camp'));
    expect(hit, 'бой в минуту прихода').toBeTruthy();
    expect(hit!.won, 'дружина сильнее лагеря').toBe(true);
    expect(after.siege, 'разбитый лагерь снимает осаду').toBeNull();
  }, 60_000);
});

describe('осада: частота от ИИ', () => {
  it('под теми же стенами лагерь не встаёт чаще, чем раз в остывание', async () => {
    const w = makeWorld(7);
    const p = holdout();
    await w.world.sync(p);
    const first = await besiege(w, p);
    const startedAt = first.siege!.since;

    // Снимаем осаду вылазкой — то есть без падения города, а значит и без
    // неприкосновенности. Остаётся только остывание, и держать оно обязано.
    const res = await w.world.sortie({ spearman: 10 });
    expect(res.error).toBeNull();

    // До конца остывания второй лагерь под теми же стенами не встаёт.
    while (w.now() < startedAt + SIEGE_COOLDOWN - 60_000) {
      w.advance(30_000);
      const pulse = await w.world.sync(p);
      expect(pulse.siege, 'остывание держит').toBeNull();
    }
  }, 180_000);

  it('порог осады — не единственное условие: доля и остывание объявлены числами', () => {
    // Порог отвечает за смысл (штурм безнадёжен), доля и остывание — за
    // редкость. Разведены они нарочно и крутятся врозь.
    expect(SIEGE_IF_BELOW).toBeGreaterThan(0);
    expect(SIEGE_CHANCE).toBeGreaterThan(0);
    expect(SIEGE_CHANCE).toBeLessThan(1);
    expect(SIEGE_COOLDOWN).toBeGreaterThan(SIEGE_IMMUNE / 2);
    const src = readFileSync(path.join(process.cwd(), 'src/world/local/LocalWorld.ts'), 'utf8');
    // Оба ограничителя стоят в самом решении, а не где-то рядом.
    expect(src).toContain('SIEGE_CHANCE');
    expect(src).toContain('siegeAgainAt');
  });
});

describe('осада: цена падения известна заранее', () => {
  const banner = readFileSync(path.join(process.cwd(), 'src/ui/SiegeBanner.tsx'), 'utf8');
  const panel = readFileSync(path.join(process.cwd(), 'src/ui/panels/SiegePanel.tsx'), 'utf8');

  it('плашка говорит, чем кончится голод, рядом с часами, а окно — подробно и до действий', () => {
    // Падение случается и в отсутствие игрока, и цена обязана стоять там, где
    // принимают решение уходить, — под счётчиком голода. Плашка — вход в окно: в ней
    // объявленная участь; в окне — что именно город потеряет.
    expect(banner).toContain('siege-fall');
    expect(banner).toMatch(/Объявлено/);
    // Порядок: сначала «сколько осталось», потом «чем кончится», потом вход в окно.
    expect(banner.indexOf('siege-clock')).toBeLessThan(banner.indexOf('siege-fall'));
    expect(banner.indexOf('siege-fall')).toBeLessThan(banner.indexOf('siege-open'));
    // В окне цена стоит первой после шапки, раньше часов и раньше действий.
    expect(panel).toMatch(/Кончится хлеб/);
    expect(panel).toMatch(/тайник/);
    expect(panel.indexOf('Объявлено:')).toBeLessThan(panel.indexOf('Своей еды хватит на'));
    expect(panel.indexOf('Своей еды хватит на')).toBeLessThan(panel.indexOf('Что делать'));
  });

  it('что уйдёт при падении, окно берёт из мира, а не пишет словами', () => {
    // То же правило, что у строки дебафа: своей арифметики у окна нет, иначе оно
    // однажды покажет не то, что делает мир. Доля рассеянного гарнизона и потеря
    // склада приезжают готовыми (`SiegeView.fall`).
    expect(panel).toContain('siege.fall');
    expect(panel).not.toMatch(/SIEGE_ROUT|FALL_BUILDINGS|FALL_LEVELS|BURN_|LED_POP/);
    expect(panel).not.toMatch(/уйдёт 50/);
  });

  it('правила отсутствия нет нигде: враг подходит и осаждает, в игре хозяин или нет', () => {
    // Прежде набег, пришедшийся на время без игрока, не состоялся бы, и осада без
    // игрока не начиналась (`AWAY_GRACE` в `resolveIncoming` до `beginSiege`). Правило
    // снято решением владельца (docs/DEFEAT_LADDER.md). Держит это не только чтение
    // кода: то же самое проверяет прогон в `world.test.ts` — набег, пришедшийся на
    // отсутствие, кончается так же, как при игроке.
    const code = readFileSync(path.join(process.cwd(), 'src/world/local/LocalWorld.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(code, 'правило отсутствия вернулось').not.toMatch(/AWAY_GRACE|prevSeen|seenAt\s*=|save\.seenAt/);
    // Приход отряда и падение города не спрашивают, когда игрок смотрел в последний раз.
    const incoming = code.slice(code.indexOf('private resolveIncoming('), code.indexOf('private letterCandidates('));
    expect(incoming.indexOf('this.beginSiege(m, at)'), 'лагерь садится первым делом').toBeGreaterThan(0);
    expect(incoming.slice(0, incoming.indexOf('this.beginSiege(m, at)'))).not.toMatch(/return/);
  });
});

describe('участь взятого города в мире: казна и пять построек', () => {
  /** Настоящий посёлок: каждая постройка выше первого уровня, тайника не касается ничто. */
  const town = () => {
    const s = createInitialState();
    s.buildings.forEach((b, i) => {
      b.level = b.type === 'cache' ? 1 : 2 + (i % 8);
    });
    s.gold = 9000;
    return s;
  };

  /** Мир с хранилищем в памяти: сохранение можно перечитать вторым миром. */
  function storedWorld(seed: number, box: { json: string | null }, start = START) {
    let now = start;
    const world = new LocalWorld({
      seed,
      now: () => now,
      storage: { read: () => box.json, write: (json) => void (box.json = json) },
    });
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

  it('падение голодом уносит казну тем же правилом и роняет ровно те постройки, что названы в отчёте', async () => {
    const s = town();
    const w = makeWorld(7);
    const p = holdout({ gold: s.gold, levels: fallPool(s), stock: { food: 600, wood: 400 } });
    await w.world.sync(p);
    const pulse = await besiege(w, p);
    const camp = pulse.marches.find((m) => !m.own && m.siege)!;
    const at = Math.ceil(pulse.siege!.starvesAt);

    w.at(at);
    const after = await w.world.sync(p);
    const report = after.reports.find((r) => r.title === 'Хлеб кончился')!;
    const effect = after.effects.find((e) => e.text.includes('Осада'))!;
    expect(report, 'город пал').toBeTruthy();

    // Казна — тем же дележом, что склад: дверь, прогнанная на тех же числах.
    const expected = fate({
      fate: FATE_DEFAULT,
      stock: p.stock,
      gold: s.gold,
      stash: p.stash,
      pop: p.pop,
      bonded: 0,
      carry: stackCarry(camp.units),
      escort: stackEscort(camp.units),
      levels: p.levels,
      seed: fallSeed(7, at),
    });
    // Граница области: обоз лагеря что-то уносит из казны.
    expect(expected.taken.gold ?? 0, 'обоз лагеря берёт из казны').toBeGreaterThan(0);
    expect(effect.resources.gold).toBe(-(expected.taken.gold ?? 0));
    expect(report.loot?.gold).toBe(-(expected.taken.gold ?? 0));

    // Список в отчёте — тот же, что уехал в последствие, и тот же, что выбрала дверь.
    expect(report.fallen).toEqual(expected.fallen);
    expect(effect.fallen).toEqual(expected.fallen);
    // Граница области: все пять ударов пришлись выше первого уровня.
    expect(report.fallen!.filter((f) => f.to < f.from).length).toBe(FALL_BUILDINGS);

    // Замер настоящим применением: какие уровни на деле сошли с посёлка.
    const before = new Map(s.buildings.map((b) => [b.type as string, b.level]));
    const goldBefore = s.gold;
    applyEffects(s, [effect]);
    const measured = s.buildings
      .filter((b) => b.level !== before.get(b.type))
      .map((b) => ({ id: b.type as string, from: before.get(b.type)!, to: b.level }))
      .sort((a, b) => a.id.localeCompare(b.id));
    expect(measured).toEqual([...report.fallen!].sort((a, b) => a.id.localeCompare(b.id)));
    expect(s.gold).toBe(goldBefore - (expected.taken.gold ?? 0));
    expect(s.buildings.find((b) => b.type === 'cache')!.level).toBe(1);
    // Проигравший читает список поимённо — одними словами в отчёте и в летописи.
    const words = fallenText(s, report.fallen!);
    expect(words.split(', ').length).toBe(FALL_BUILDINGS);
    expect(s.log.some((l) => l.text === `Постройки потеряли уровни: ${words}.`)).toBe(true);
  }, 60_000);

  it('перечитанное сохранение мира даёт тот же список построек', async () => {
    const s = town();
    const box = { json: null as string | null };
    const a = storedWorld(7, box);
    const p = holdout({ gold: s.gold, levels: fallPool(s) });
    await a.world.sync(p);
    const siege = await besiege(a as unknown as ReturnType<typeof makeWorld>, p);
    const at = Math.ceil(siege.siege!.starvesAt);
    a.at(at - 60_000);
    await a.world.sync(p);
    const saved = box.json;
    expect(saved, 'сохранение записано').toBeTruthy();

    a.at(at);
    const first = (await a.world.sync(p)).reports.find((r) => r.title === 'Хлеб кончился');
    // Второй мир поднимается из той же строки и доживает до той же минуты.
    const again = { json: saved };
    const b = storedWorld(7, again, at - 60_000);
    b.at(at);
    const second = (await b.world.sync(p)).reports.find((r) => r.title === 'Хлеб кончился');
    expect(first?.fallen?.length, 'город пал и в первом мире').toBe(FALL_BUILDINGS);
    expect(second?.fallen).toEqual(first?.fallen);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Лестница в мире: объявленная участь, защита от цепочки, окно обороняющегося.
// ---------------------------------------------------------------------------

/**
 * Дождаться осады, отряд которой объявил участь `fate`. Живых соперников на карте
 * нет, и логово объявляет «ограбить» всегда; чужой город, объявивший вторую или
 * третью ступень, здесь заводится руками — полем отряда в сохранении, тем самым,
 * которое заполнил бы приказ живого игрока.
 */
async function besiegeDeclaring(w: ReturnType<typeof makeWorld>, p: PlayerProfile, declared: Fate): Promise<WorldPulse> {
  const save = (w.world as unknown as { save: WorldSave }).save;
  for (let i = 0; i < 4000; i++) {
    w.advance(20_000);
    for (const m of save.marches) if (!m.own && m.targetId === 'home' && m.phase === 'out') m.fate = declared;
    const pulse = await w.world.sync(p);
    if (pulse.siege) return pulse;
  }
  throw new Error('осады так и не случилось');
}

/** Посёлок под осадой: постройки выше первого, стройка в работе, люди, невольники, казна. */
function besiegedTown(): GameState {
  const s = createInitialState();
  s.buildings.forEach((b, i) => {
    b.level = b.type === 'cache' ? 2 : b.type === 'storage' ? 10 : 2 + (i % 7);
  });
  const smithy = s.buildings.find((b) => b.type === 'smithy')!;
  smithy.work = 5;
  smithy.workRequired = 700;
  s.pop = 320;
  s.bonded = 45;
  s.gold = 7000;
  for (const r of RESOURCE_IDS) s.resources[r] = 4000;
  return s;
}

/** Слепок такого посёлка, который штурмовать бессмысленно: отряд садится лагерем. */
const besiegedProfile = (s: GameState): PlayerProfile => ({
  ...playerProfile(s),
  defense: 100_000,
  army: {},
  food: 6000,
  foodPerHour: 6000,
  soldierFoodPerHour: 60,
});

describe('лестница в мире: объявлено при приказе, видно осаждённому, сделано при падении', () => {
  it('окно обороняющегося называет ровно то, что племя потеряет, — замером на посёлке, на всех трёх ступенях', async () => {
    for (const declared of FATE_IDS) {
      const s = besiegedTown();
      const p = besiegedProfile(s);
      const w = makeWorld(7);
      await w.world.sync(p);
      const start = await besiegeDeclaring(w, p, declared);
      const at = Math.ceil(start.siege!.starvesAt);
      // Окно — за секунду до голода: слепок и лагерь те же, что будут в минуту падения.
      w.at(at - 1000);
      const view = (await w.world.sync(p)).siege!;
      expect(view.fate, `${declared}: осаждённый видит объявленное`).toBe(declared);
      w.at(at);
      const after = await w.world.sync(p);
      const effect = after.effects.find((e) => e.id.endsWith('-fell'))!;
      const report = after.reports.find((r) => r.id.endsWith('-fell'))!;
      expect(effect, `${declared}: город пал`).toBeTruthy();

      const before = { goods: RESOURCE_IDS.reduce((n, r) => n + s.resources[r], 0) + s.gold, pop: s.pop, bonded: bondedTotal(s) };
      const works = s.buildings.filter((b) => b.workRequired > 0).length;
      applyEffects(s, [effect]);
      const lost = {
        goods: before.goods - (RESOURCE_IDS.reduce((n, r) => n + s.resources[r], 0) + s.gold),
        pop: before.pop - s.pop,
        bonded: before.bonded - bondedTotal(s),
      };
      const f = view.fall;
      // Граница области: каждой ступени есть что сделать с этим посёлком.
      expect(f.goods + f.gold, `${declared}: брать нечего`).toBeGreaterThan(0);
      expect(f.buildings, `${declared}: ронять нечего`).toBeGreaterThan(0);
      expect(lost.goods, `${declared}: добро`).toBe(f.goods + f.gold);
      expect(lost.pop, `${declared}: горожане`).toBe(f.ledPop + f.scatterPop);
      expect(lost.bonded, `${declared}: невольники`).toBe(f.ledBonded + f.scatterBonded);
      expect(report.fallen!.length, `${declared}: сколько построек под ударом`).toBe(f.buildings);
      expect(works - s.buildings.filter((b) => b.workRequired > 0).length > 0, `${declared}: стройка`).toBe(f.burnsWorks);
      expect(effect.lost.warrior ?? 0, `${declared}: гарнизон`).toBe(f.routed);
      if (declared !== 'plunder') expect(lost.pop + lost.bonded, `${declared}: людей не стало`).toBeGreaterThan(0);
    }
  }, 240_000);

  it('сожжённый город сутки не сжечь: следующая осада с тем же объявлением кончается грабежом', async () => {
    const s = besiegedTown();
    const p = besiegedProfile(s);
    const w = makeWorld(7);
    const save = (w.world as unknown as { save: WorldSave }).save;
    await w.world.sync(p);

    const first = await besiegeDeclaring(w, p, 'burn');
    const firstAt = Math.ceil(first.siege!.starvesAt);
    w.at(firstAt);
    const burned = await w.world.sync(p);
    const fell = burned.effects.find((e) => e.id.endsWith('-fell'))!;
    expect(fell.burned, 'первый раз — сожгли').toBe(true);
    expect(save.burnImmune.home, 'защита на сутки от минуты пожара').toBe(burnImmuneUntil(firstAt));

    const second = await besiegeDeclaring(w, p, 'burn');
    // Граница области: вторая осада встала и падёт внутри суток после пожара.
    const secondAt = Math.ceil(second.siege!.starvesAt);
    expect(secondAt, 'вторая осада — внутри суток').toBeLessThan(firstAt + BURN_IMMUNE);
    // Осаждённый видит не объявленное впустую, а то, что случится.
    expect(second.siege!.fate).toBe(FATE_DEFAULT);
    w.at(secondAt);
    const robbed = await w.world.sync(p);
    const again = robbed.effects.find((e) => e.id.endsWith('-fell'))!;
    const report = robbed.reports.find((r) => r.id.endsWith('-fell'))!;
    expect(again.burned, 'второй раз не сожгли').toBeUndefined();
    expect(report.fallen!.length, 'пять построек, а не все').toBe(FALL_BUILDINGS);
    expect(again.resources, 'а ограбили — можно').not.toEqual({});
    // Защита не продлилась грабежом: срок тот же, от первого пожара.
    expect(save.burnImmune.home).toBe(burnImmuneUntil(firstAt));
  }, 240_000);

  it('логову сжечь не объявить ни осадой, ни ударом, ни заново у своего лагеря — а увести людей можно', async () => {
    const w = makeWorld(7);
    const p = host();
    const target = await marchGeneral(w, p);
    const card = await w.world.settlement(target.id);
    const burn = card!.fates.find((o) => o.id === 'burn')!;
    expect(burn.can, 'строка сожжения погашена').toBe(false);
    expect(burn.reason).toMatch(/Сжечь можно только город игрока/);
    expect(card!.fates.filter((o) => o.can).map((o) => o.id)).toEqual(['plunder', 'captives']);
    expect(await w.world.besiege('burn')).toBe(burn.reason);
    expect((await w.world.attack({ setup: null, fate: 'burn' })).error).toBe(burn.reason);

    expect(await w.world.besiege('captives')).toBeNull();
    const camp = await w.world.camp();
    expect(camp?.fate, 'объявлено приказом').toBe('captives');
    expect(await w.world.besiege('burn'), 'и заново у своего лагеря — тоже нет').toBe(burn.reason);
    expect((await w.world.camp())?.fate).toBe('captives');
    // Объявить заново мягче — можно, и окно видит это сразу.
    expect(await w.world.besiege('plunder')).toBeNull();
    expect((await w.world.camp())?.fate).toBe('plunder');
  }, 60_000);

  it('уведённые из логова приезжают невольниками — скольких увела дверь по людям логова до разгрома', async () => {
    const w = makeWorld(7);
    const p = host();
    const target = await marchGeneral(w, p);
    const save = (w.world as unknown as { save: WorldSave }).save;
    expect(await w.world.besiege('captives')).toBeNull();
    const peek = w.world as unknown as {
      popNow(s: GenSettlement, now: number): number;
      bondedAt(pop: number): number;
      gen: { settlements: GenSettlement[] };
    };
    const town = peek.gen.settlements.find((x) => x.id === target.id)!;
    for (let i = 0; i < 900; i++) {
      const win = save.sieges[target.id];
      expect(win, 'осада не должна сняться сама').toBeTruthy();
      if (starvesAt(win) - w.now() <= 30_000) break;
      w.advance(20_000);
      await w.world.sync(p);
    }
    const fallAt = Math.ceil(starvesAt(save.sieges[target.id]));
    const men = troopTotal(save.figures.general.troops ?? {});
    const pop = peek.popNow.call(w.world, town, fallAt);
    // Людей уводят по населению логова до того, как рассеянный гарнизон его убавит, —
    // той же дверью, конвоем той дружины, что стоит лагерем. Склад на увод не влияет.
    const expected = fate({
      fate: 'captives',
      stock: {},
      gold: 0,
      stash: 0,
      pop,
      bonded: peek.bondedAt.call(w.world, pop),
      carry: Infinity,
      escort: stackEscort({ warrior: men }),
      seed: fallSeed(7, fallAt),
    });
    // Граница области: уводят хоть кого-то, и горожан тоже.
    expect(expected.ledPop.taken, 'горожан уводят').toBeGreaterThan(0);
    w.at(fallAt);
    const pulse = await w.world.sync(p);
    const gain = pulse.effects.find((e) => e.text.includes('сдался голоду'))!;
    expect(gain.bonded, 'уведённые — невольниками').toBe(expected.ledBonded.taken + expected.ledPop.taken);
  }, 120_000);
});
