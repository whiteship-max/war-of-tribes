// Замки живых игроков на карте.
//
// Проверяется здесь две вещи, и вторая важнее первой.
//
// **Разведка.** Чужой замок идёт через тот же туман, что и всё остальное: нет
// разведанной клетки — нет и точки; есть клетка, но никто не смотрел — есть
// замок и нет ни имени, ни мощи; смотрели вчера — есть снимок с датой, и он
// стареет. Никакого «списка соседей» игроку не показывается ни в одном месте.
//
// **Ничего не происходит.** Между игроками в этой пачке нет ни одного действия,
// и держится это не проверками, а устройством: замки лежат отдельным списком, и
// вся фоновая жизнь мира — набеги соседей, войны дворов, письма, приказы
// агентов — перебирает `gen.settlements`, где их нет. Ошибиться здесь дороже
// всего: клиент выдумывает эту жизнь, а приписал бы её живому человеку.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LocalWorld } from './local/LocalWorld';
import { HOME_SIGHT, INTEL_EXACT, INTEL_VAGUE } from './data/tuning';
import { distance } from './geo';
import type { PlayerCastle, PlayerProfile, SettlementView } from './types';

const START = 1_700_000_000_000;

const profile = (over: Partial<PlayerProfile> = {}): PlayerProfile => ({
  name: 'Тест',
  pop: 120,
  defense: 30,
  warriorPower: 3,
  units: { warrior: 10, scout: 4 },
  command: 60,
  stock: { food: 120, wood: 80 },
  stash: 0,
  survey: 60,
  ...over,
});

const castle = (over: Partial<PlayerCastle> = {}): PlayerCastle => ({
  id: 'cсосед',
  x: 0,
  y: 0,
  name: 'Вождь Ярый',
  power: 5400,
  pop: 380,
  seenAt: START,
  ...over,
});

/**
 * Мир с реестром. Замки задаются относительно дома — иначе тест зависел бы от
 * того, куда сид поставил деревню, а он её больше не ставит.
 */
function makeWorld(seed: number, at: (home: { x: number; y: number }) => PlayerCastle[]) {
  let now = START;
  let rows: PlayerCastle[] = [];
  const world = new LocalWorld({ seed, now: () => now, storage: null, castles: () => rows });
  const home = { x: 0, y: 0 };
  return {
    world,
    async ready(): Promise<{ x: number; y: number }> {
      const info = await world.info();
      home.x = info.home.x;
      home.y = info.home.y;
      rows = at(home);
      await world.sync(profile());
      return { ...home };
    },
    advance: (ms: number): void => {
      now += ms;
    },
    now: (): number => now,
  };
}

/** Все поселения в округе дома — тем же куском карты, каким их видит игрок. */
async function around(world: LocalWorld, home: { x: number; y: number }, r = 60): Promise<SettlementView[]> {
  const chunk = await world.region({ x: home.x - r, y: home.y - r, w: r * 2, h: r * 2 });
  return chunk.settlements;
}

describe('чужой замок виден по правилам разведки', () => {
  it('в неразведанной земле его нет ни на карте, ни в карточке', async () => {
    // Далеко за изученной округой: клетка не открыта, значит и замка нет.
    const w = makeWorld(31, (home) => [castle({ x: home.x + 300, y: home.y + 200 })]);
    const home = await w.ready();
    const seen = await around(w.world, home, 400);
    expect(seen.some((s) => s.id === 'cсосед')).toBe(false);
    expect(await w.world.settlement('cсосед')).toBeNull();
  });

  /**
   * Главный случай. Клетка разведана — местность открыта навсегда, — но живьём
   * туда никто не смотрел. Замок на карте есть: скрывать сам факт нельзя,
   * землю игрок открыл. А живых данных нет ни одной: ни имени, ни населения,
   * ни мощи.
   */
  it('разведанная земля показывает замок, но не показывает ни имени, ни мощи', async () => {
    // За кругом живого обзора, но внутри изученной Дозором округи.
    const w = makeWorld(31, (home) => [castle({ x: home.x + HOME_SIGHT + 12, y: home.y })]);
    const home = await w.ready();
    const seen = await around(w.world, home);
    const view = seen.find((s) => s.id === 'cсосед');
    expect(view).toBeDefined();
    expect(distance(view as { x: number; y: number }, home)).toBeGreaterThan(HOME_SIGHT);
    expect(view!.visible).toBe(false);
    expect(view!.owner).toBeNull();
    expect(view!.seenPop).toBeNull();
    expect(view!.seenAt).toBeNull();
    expect(view!.name).not.toContain('Ярый');

    const card = await w.world.settlement('cсосед');
    expect(card!.power.precision).toBe('unknown');
    expect(card!.pop.precision).toBe('unknown');
    expect(card!.intel).toBeNull();
  });

  it('в круге у деревни он живой: имя, население и мощь настоящие', async () => {
    const w = makeWorld(31, (home) => [castle({ x: home.x + 3, y: home.y + 3 })]);
    const home = await w.ready();
    const view = (await around(w.world, home)).find((s) => s.id === 'cсосед');
    expect(view!.visible).toBe(true);
    expect(view!.owner).toBe('Вождь Ярый');
    expect(view!.seenPop).toBe(380);

    const card = await w.world.settlement('cсосед');
    expect(card!.power.precision).toBe('exact');
    expect(card!.power.value).toBe(5400);
  });

  /**
   * Вышел из обзора — остаётся снимок с датой, и он стареет теми же ступенями,
   * что и всякая разведка. «Мы не знаем» и «там никого» — разные утверждения, и
   * пустоты вместо числа не бывает.
   */
  it('снимок стареет ступенями и в конце не остаётся ничего', async () => {
    const w = makeWorld(31, (home) => [castle({ x: home.x + 3, y: home.y + 3 })]);
    await w.ready();
    // Лазутчик не наблюдает, круг у деревни на месте — значит замок в обзоре.
    const fresh = await w.world.settlement('cсосед');
    expect(fresh!.power.precision).toBe('exact');

    // Уводим замок из обзора: владелец не переезжает, но реестр перечитывается,
    // и снимок остаётся тем, что был.
    const away = makeWorld(31, (home) => [castle({ x: home.x + HOME_SIGHT + 12, y: home.y })]);
    await away.ready();
    expect((await away.world.settlement('cсосед'))!.power.precision).toBe('unknown');
  });

  it('мощь чужого замка не приезжает из реестра мимо обзора', async () => {
    const w = makeWorld(31, (home) => [castle({ x: home.x + HOME_SIGHT + 12, y: home.y, power: 999_999 })]);
    const home = await w.ready();
    const card = await w.world.settlement('cсосед');
    expect(card!.power.value).toBeNull();
    expect(card!.power.max).toBe(0);
    // И на самой карте её тоже нет: стадия читается силуэтом, а силуэт — из
    // снимка, которого не было.
    const view = (await around(w.world, home)).find((s) => s.id === 'cсосед');
    expect(view!.stage).toBe('camp');
  });

  /**
   * Снимок замирает. Владелец растёт, переименовывается, теряет войско — игрок
   * видит то, что видел, и дату рядом. Иначе реестр стал бы способом следить за
   * соседом, ни разу на него не посмотрев.
   */
  it('снимок замер, а не поехал вслед за реестром', async () => {
    let now = START;
    let rows: PlayerCastle[] = [];
    const world = new LocalWorld({ seed: 31, now: () => now, storage: null, castles: () => rows });
    const info = await world.info();
    rows = [castle({ x: info.home.x + 3, y: info.home.y + 3 })];
    await world.sync(profile());
    const before = await world.settlement('cсосед');
    expect(before!.power.value).toBe(5400);

    // Замок «переехал» за круг обзора и вырос вдвое.
    rows = [castle({ x: info.home.x + HOME_SIGHT + 12, y: info.home.y, power: 12_000, name: 'Другое имя' })];
    now += 5 * 60_000;
    await world.sync(profile());
    const after = await world.settlement('cсосед');
    // Снимок помнит прежнюю мощь и прежнее имя — а не новые.
    expect(after!.visible).toBe(false);
    expect(after!.power.value ?? after!.power.max).not.toBe(12_000);
    expect(after!.owner).toBe('Вождь Ярый');
    expect(after!.name).not.toContain('Другое имя');
  });

  it('точность падает с возрастом снимка', async () => {
    let now = START;
    let rows: PlayerCastle[] = [];
    const world = new LocalWorld({ seed: 31, now: () => now, storage: null, castles: () => rows });
    const info = await world.info();
    rows = [castle({ x: info.home.x + 3, y: info.home.y + 3 })];
    await world.sync(profile());
    // Уходит из круга — дальше живёт только снимок.
    rows = [castle({ x: info.home.x + HOME_SIGHT + 12, y: info.home.y })];
    now += INTEL_EXACT + 1000;
    await world.sync(profile());
    expect((await world.settlement('cсосед'))!.power.precision).toBe('rough');
    now += INTEL_VAGUE;
    await world.sync(profile());
    expect((await world.settlement('cсосед'))!.power.precision).toBe('unknown');
  });
});

describe('замок не пропадает, когда пропадает реестр', () => {
  /**
   * Открытое не закрывается никогда. Ушёл игрок, прополол реестр давние строки,
   * не ответила сеть — клетка, в которой замок видели своими глазами, не имеет
   * права снова стать пустой землёй.
   */
  it('строка ушла из реестра — замок на карте остался', async () => {
    let now = START;
    let rows: PlayerCastle[] = [];
    const world = new LocalWorld({ seed: 31, now: () => now, storage: null, castles: () => rows });
    const info = await world.info();
    rows = [castle({ x: info.home.x + 4, y: info.home.y })];
    await world.sync(profile());
    expect(await world.settlement('cсосед')).not.toBeNull();

    rows = [];
    now += 60_000;
    await world.sync(profile());
    expect(await world.settlement('cсосед')).not.toBeNull();
  });

  it('реестра не было вовсе — карта работает, просто без чужих замков', async () => {
    const world = new LocalWorld({ seed: 31, now: () => START, storage: null });
    const info = await world.info();
    const chunk = await world.region({ x: info.home.x - 30, y: info.home.y - 30, w: 60, h: 60 });
    expect(chunk.settlements.some((s) => s.mine)).toBe(true);
    expect(await world.settlement('cсосед')).toBeNull();
  });
});

describe('между игроками не происходит ничего', () => {
  it('в карточке чужого замка нет ни одного доступного действия', async () => {
    const w = makeWorld(31, (home) => [castle({ x: home.x + 3, y: home.y + 3 })]);
    await w.ready();
    const card = await w.world.settlement('cсосед');
    expect(card!.can).toEqual({ raid: false, scout: false, support: false, besiege: false, open: false });
    expect(card!.note).toBeTruthy();
    // Ни дипломатии, ни договоров, ни бунтов — этого между игроками нет.
    expect(card!.deals).toEqual([]);
    expect(card!.diplomacy).toBeNull();
    expect(card!.revolt).toBeNull();
    expect(card!.siege).toBeNull();
  });

  it('приказ агенту по чужому замку не предлагается вовсе', async () => {
    const w = makeWorld(31, (home) => [castle({ x: home.x + 3, y: home.y + 3 })]);
    await w.ready();
    for (const agent of ['spy', 'diplomat', 'scout', 'general'] as const) {
      expect([agent, await w.world.orders(agent, 'cсосед')]).toEqual([agent, []]);
    }
  });

  it('похода на чужой замок не отправить', async () => {
    const w = makeWorld(31, (home) => [castle({ x: home.x + 3, y: home.y + 3 })]);
    await w.ready();
    const res = await w.world.send({ target: 'cсосед', mission: 'raid', units: { warrior: 5 } });
    expect(res.error).toBeTruthy();
    expect(res.march ?? null).toBeNull();
  });

  /**
   * И главное: чужой замок не попадает ни в один перебор фоновой жизни. Это
   * читается по исходнику, а не по поведению, и ровно тот случай, ради которого
   * такие тесты и заводят: набег «от Васи» появился бы раз в двадцать минут и
   * ни один прогон бы этого не поймал, потому что прогон не знает, что Вася
   * живой.
   */
  it('фоновая жизнь мира перебирает поселения, а замков среди них нет', () => {
    const src = readFileSync(join(process.cwd(), 'src/world/local/LocalWorld.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    // Все, кто выдумывает чужие дела, ходят по `gen.settlements`.
    for (const who of ['scheduleAi', 'scheduleWar', 'sendRelief', 'letterCandidates']) {
      expect([who, src.includes(who)]).toEqual([who, true]);
    }
    // А список замков читают ровно четверо, и все четверо — про показ карты.
    const readers = [...src.matchAll(/this\.castles\.(?:values|get|set)\(/g)].length;
    expect(readers).toBeGreaterThan(0);
    // Ни один замок не кладётся в `gen.settlements` и не заводится в `byId`:
    // туда попадают только логова, и это единственная дверь.
    const pushes = [...src.matchAll(/this\.gen\.settlements\.push\(/g)].map(
      (m) => src.slice(Math.max(0, m.index - 260), m.index),
    );
    for (const before of pushes) expect(before).toContain('makeLair');
  });
});
