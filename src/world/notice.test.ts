import { describe, expect, it } from 'vitest';
import { LocalWorld, HOME_ID } from './local/LocalWorld';
import { NotifyingWorld } from './local/NotifyingWorld';
import type { StoredMarch, WorldSave } from './local/state';
import type { PlayerProfile, WorldPulse } from './types';
import { BREAD_LEAD_SHARE, WORKS_FIRE_SHARE, draftNotices, sightFrom, type NoticeWorld } from './notice';
import { inSight } from './fog';
import { marchPosition } from './geo';
import { NOTICE_KINDS, plainName, readNotices, type NoticeItem } from '../../netlify/lib/contract';

const START = 1_700_000_000_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const profile = (over: Partial<PlayerProfile> = {}): PlayerProfile => ({
  name: 'Тест',
  // Выше AI_MIN_POP: без этого набегов на деревню нет вовсе, и тест проверял бы пустоту.
  pop: 120,
  defense: 30,
  warriorPower: 3,
  units: { warrior: 10, scout: 4 },
  stock: { food: 120, wood: 80 },
  stash: 0,
  ...over,
});

/** Мир с ручными часами и сохранением в памяти: сохранение читается глазами теста. */
function makeWorld(seed: number) {
  let now = START;
  let saved: string | null = null;
  const world = new LocalWorld({
    seed,
    now: () => now,
    storage: {
      read: () => saved,
      write: (json) => {
        saved = json;
      },
    },
  });
  return {
    world,
    at: (t: number): void => {
      now = t;
    },
    now: (): number => now,
    save: (): WorldSave => JSON.parse(saved ?? 'null') as WorldSave,
  };
}

/** Чужие отряды, идущие на деревню. */
const onHome = (save: WorldSave) => save.marches.filter((m) => !m.own && m.targetId === HOME_ID);

describe('инвариант уведомлений: набег на деревню рождается только на пульсе', () => {
  /**
   * **От этого теста зависят уведомления (docs/NOTIFY.md, разделы 1 и 8).**
   *
   * Список того, о чём сервер скажет игроку, пока его нет, составляет клиент в
   * минуту ухода — из сохранения мира. Полон этот список ровно потому, что набег на
   * деревню рождается только на пульсе, в минуту пульса (`scheduleAi` с
   * `departAt: now`), и чужой отряд на деревню в мире один. Значит в минуту ухода в
   * сохранении уже лежит каждый набег, который дойдёт до ворот до следующего
   * открытия.
   *
   * Если мир начнёт жить без игрока — набеги станут рождаться в догоне задним
   * числом, «в ту минуту, на которую были назначены», — клиент перестанет знать о
   * них в минуту ухода, и **уведомления станут неполными молча**: сервер честно
   * пришлёт всё, что ему дали, а о набеге, рождённом в офлайне, не узнает никто,
   * кроме игрока, потерявшего город. Хочешь, чтобы мир жил без игрока, — сначала
   * реши, откуда тогда брать уведомления, и перепиши этот тест вместе с ними.
   *
   * Граница области: догон берётся большим шагом (три часа — дальше любой паузы
   * между набегами), и каждая точка обязана быть внутри правила — к минуте догона
   * набег **должен был** созреть (`nextAiAt` в прошлом): только тогда «задним
   * числом» ему было откуда взяться. Это проверяется утверждением, а не расчётом в
   * голове, и хоть один набег обязан родиться на догоне.
   */
  it('мир, догоняемый большим шагом, не рождает отряда на деревню задним числом', async () => {
    const STEP = 3 * HOUR;
    let born = 0;
    for (const seed of [202, 404, 606, 808]) {
      const w = makeWorld(seed);
      await w.world.sync(profile());
      for (let step = 0; step < 6; step++) {
        const before = w.save();
        const had = new Set(onHome(before).map((m) => m.id));
        const catchUp = w.now() + STEP;
        w.at(catchUp);
        await w.world.sync(profile());
        const after = w.save();
        const fresh = onHome(after).filter((m) => !had.has(m.id));

        // Отряд на деревню в мире один — в любую минуту.
        expect(onHome(after).filter((m) => m.phase === 'out').length, `сид ${seed}: отрядов на деревню`).toBeLessThanOrEqual(1);

        for (const m of fresh) {
          // Граница области: набег созрел раньше минуты догона, то есть «задним
          // числом» ему было откуда взяться.
          expect(before.nextAiAt, `сид ${seed}, шаг ${step}: набег созрел до догона`).toBeLessThan(catchUp);
          expect(
            m.departAt,
            `сид ${seed}, шаг ${step}: отряд ${m.id} на деревню вышел задним числом, за ${
              Math.round((catchUp - m.departAt) / 1000)
            } с до догона — уведомления больше не полны`,
          ).toBeGreaterThanOrEqual(catchUp);
          born++;
        }
      }
    }
    // Точки внутри области есть: хоть один набег родился на догоне.
    expect(born, 'догон родил хоть один набег на деревню').toBeGreaterThan(3);
  }, 60_000);
});

// ---------- Черновики: чистая функция ----------

const T0 = START + 10 * MINUTE;

const raidFacts = (over: Partial<NonNullable<NoticeWorld['raid']>> = {}): NonNullable<NoticeWorld['raid']> => ({
  id: 'm4',
  from: 'Логово разбойников',
  fate: 'plunder',
  departAt: T0 - 2 * MINUTE,
  arriveAt: T0 + 20 * MINUTE,
  seenFrom: T0 + 9 * MINUTE,
  freezeAt: T0 + 15 * MINUTE,
  ...over,
});

const siegeFacts = (over: Partial<NonNullable<NoticeWorld['siege']>> = {}): NonNullable<NoticeWorld['siege']> => ({
  campId: 'm9',
  from: 'Логово разбойников',
  fate: 'captives',
  since: T0,
  starvesAt: T0 + 40 * MINUTE,
  frontAt: T0 + 28 * MINUTE,
  rearAt: T0 + 56 * MINUTE,
  ...over,
});

describe('черновики: вид, ключ, «когда» и «годно до»', () => {
  it('белый список видов — три и только три, поимённо', () => {
    // Вида «вернись в игру», «стройка готова», «награда ждёт» здесь быть не может: это
    // напоминания игры о себе, и именно из-за них уведомления выключают целиком.
    expect([...NOTICE_KINDS]).toEqual(['raid', 'siege-works', 'siege-bread']);
  });

  it('набег: с минуты, когда его видно, до минуты, когда запрётся оборона', () => {
    const { items } = draftNotices({ raid: raidFacts(), siege: null, breaks: [] }, T0);
    expect(items).toEqual([
      {
        key: `raid:m4:${T0 - 2 * MINUTE}`,
        kind: 'raid',
        fireAt: T0 + 9 * MINUTE,
        until: T0 + 15 * MINUTE,
        p: { from: 'Логово разбойников', fate: 'plunder', about: T0 + 20 * MINUTE, freezeAt: T0 + 15 * MINUTE },
      },
    ]);
  });

  it('осада: рогатки на полпути к дозревшему фронту, хлеб — в последней доле окна', () => {
    const s = siegeFacts();
    const { items } = draftNotices({ raid: null, siege: s, breaks: [] }, T0 + MINUTE);
    const works = items.find((i) => i.kind === 'siege-works')!;
    const bread = items.find((i) => i.kind === 'siege-bread')!;
    expect(works.key).toBe(`siege-works:m9:${T0}`);
    expect(bread.key).toBe(`siege-bread:m9:${T0}`);
    expect(works.fireAt).toBe(T0 + 28 * MINUTE * WORKS_FIRE_SHARE);
    expect(works.until).toBe(T0 + 28 * MINUTE);
    expect(bread.fireAt).toBe(T0 + 40 * MINUTE * (1 - BREAD_LEAD_SHARE));
    expect(bread.until).toBe(T0 + 40 * MINUTE);
    // Слова берут только то, что до «годно до» не двигается само.
    expect(Object.keys(bread.p).sort()).toEqual(['about', 'fate', 'from', 'frontAt', 'rearAt']);
  });

  it('ключ — имя момента: пересчёт той же осады его не меняет, новая осада — меняет', () => {
    const a = draftNotices({ raid: null, siege: siegeFacts(), breaks: [] }, T0 + MINUTE).items.map((i) => i.key);
    const b = draftNotices({ raid: null, siege: siegeFacts({ starvesAt: T0 + 44 * MINUTE }), breaks: [] }, T0 + 2 * MINUTE).items.map((i) => i.key);
    const c = draftNotices({ raid: null, siege: siegeFacts({ since: T0 + 90 * MINUTE, starvesAt: T0 + 130 * MINUTE }), breaks: [] }, T0 + 91 * MINUTE).items.map((i) => i.key);
    expect(b).toEqual(a);
    expect(c.some((k) => a.includes(k))).toBe(false);
  });

  it('рогатки дозревают после голода — «годно до» не дальше голода', () => {
    const s = siegeFacts({ frontAt: T0 + 60 * MINUTE });
    const works = draftNotices({ raid: null, siege: s, breaks: [] }, T0).items.find((i) => i.kind === 'siege-works')!;
    expect(works.until).toBe(s.starvesAt);
  });

  it('разрыв до минуты, о которой пункт, — молчание; разрыв после неё — не помеха', () => {
    const s = siegeFacts();
    const before = draftNotices({ raid: null, siege: s, breaks: [{ kind: 'march-home', at: T0 + 35 * MINUTE }] }, T0);
    // Разрыв после «хлеб кончается» (fireAt 30 мин), но до конца хлеба — молчат оба:
    // правило держит правду до минуты, о которой пункт говорит, а не до его отправки.
    expect(before.items).toEqual([]);
    expect(before.silent).toEqual([
      { kind: 'siege-works', why: 'march-home' },
      { kind: 'siege-bread', why: 'march-home' },
    ]);
    const after = draftNotices({ raid: null, siege: s, breaks: [{ kind: 'handover', at: s.starvesAt }] }, T0);
    expect(after.items.length).toBe(2);
  });

  it('погоня молчит только о том набеге, за которым идёт', () => {
    const raid = raidFacts();
    const other = draftNotices({ raid, siege: null, breaks: [{ kind: 'chase', at: T0 + 5 * MINUTE, march: 'm7' }] }, T0);
    expect(other.items.length).toBe(1);
    const own = draftNotices({ raid, siege: null, breaks: [{ kind: 'chase', at: T0 + 5 * MINUTE, march: 'm4' }] }, T0);
    expect(own.items).toEqual([]);
    expect(own.silent).toEqual([{ kind: 'raid', why: 'chase' }]);
  });

  it('«годно до» в прошлом и пустое окно — не пункт', () => {
    const late = draftNotices({ raid: raidFacts(), siege: null, breaks: [] }, T0 + 16 * MINUTE);
    expect(late.items).toEqual([]);
    expect(late.silent).toEqual([{ kind: 'raid', why: 'passed' }]);
    // Отряд увидели уже за заморозкой обороны: окна ответа нет вовсе.
    const shut = draftNotices({ raid: raidFacts({ seenFrom: T0 + 15 * MINUTE }), siege: null, breaks: [] }, T0);
    expect(shut.silent).toEqual([{ kind: 'raid', why: 'no-window' }]);
    for (const i of draftNotices({ raid: raidFacts(), siege: siegeFacts(), breaks: [] }, T0).items) {
      expect(i.fireAt, i.key).toBeLessThan(i.until);
      expect(i.until, i.key).toBeGreaterThan(T0);
    }
  });

  it('черновик проходит разбор сервера как есть — и со странным именем двора', () => {
    const odd = draftNotices(
      { raid: raidFacts({ from: '<b>Логово</b> *разбойников* с очень-очень длинным именем до конца строки' }), siege: siegeFacts(), breaks: [] },
      T0,
    ).items;
    expect(readNotices(JSON.parse(JSON.stringify(odd)), T0)).toEqual(odd);
    expect(plainName('<b>Логово</b>')).toBe('bЛогово/b');
  });

  it('вход в живой обзор — та же минута, что у кругов обзора и движения отряда', () => {
    const m = { from: { x: 0, y: 0 }, to: { x: 100, y: 40 }, departAt: T0, arriveAt: T0 + 30 * MINUTE };
    const discs = [
      { x: 100, y: 40, r: 17 },
      { x: 50, y: 30, r: 6 },
    ];
    const at = sightFrom(m, discs);
    expect(Number.isFinite(at)).toBe(true);
    // Секундой раньше не видно, секундой позже — видно: проверка тем же кругом.
    const seen = (t: number): boolean => {
      const p = marchPosition(m, t);
      return inSight(discs, p.x, p.y);
    };
    expect(seen(at - 1000)).toBe(false);
    expect(seen(at + 1000)).toBe(true);
    expect(sightFrom({ ...m, to: { x: -100, y: 0 } }, [{ x: 100, y: 40, r: 17 }])).toBe(Infinity);
  });
});

// ---------- Разрыв держит правду: прогоном настоящего мира ----------

/**
 * Деревня, которую штурмовать бессмысленно: набег садится лагерем. Слепок тот же, на
 * котором сняты числа осады в `works.test.ts`, и в прогоне он не меняется — «без
 * действий игрока».
 */
const holdout: PlayerProfile = {
  name: 'Тест',
  pop: 120,
  defense: 100_000,
  warriorPower: 3,
  units: { warrior: 10, scout: 4 },
  army: { legionary: 40, spearman: 30, archer: 20 },
  stock: { food: 600, wood: 400 },
  stash: 0,
  food: 6000,
  foodPerHour: 6000,
  soldierFoodPerHour: 60,
};

function memory(data: string | null = null) {
  return {
    read: (): string | null => data,
    write: (json: string): void => {
      data = json;
    },
  };
}

interface Frozen {
  seed: number;
  save: string;
  since: number;
}

const frozen = new Map<number, Frozen>();

/** Мир в минуту, когда встала первая осада деревни, — сохранением. */
async function freeze(seed: number): Promise<Frozen> {
  const had = frozen.get(seed);
  if (had) return had;
  let now = START;
  const store = memory();
  const world = new LocalWorld({ seed, now: () => now, storage: store });
  await world.sync(holdout);
  for (let i = 0; i < 3000; i++) {
    now += 20_000;
    const pulse = await world.sync(holdout);
    if (pulse.siege) {
      const fz = { seed, save: store.read() as string, since: pulse.siege.since };
      frozen.set(seed, fz);
      return fz;
    }
  }
  throw new Error('осады так и не случилось');
}

/** Назначенные события, которые пересчитают окно: ставятся прямо в сохранение. */
type Inject = 'none' | 'march-home' | 'handover' | 'general-home';

function inject(save: WorldSave, kind: Inject, since: number): void {
  const home = save.home;
  if (kind === 'march-home') {
    // Разведка, вышедшая до осады, возвращается посреди неё.
    const m: StoredMarch = {
      id: 'm-scouts',
      seed: 1,
      mission: 'scout',
      units: { scout: 2 },
      own: true,
      fromId: HOME_ID,
      targetId: HOME_ID,
      from: { x: home.x + 6, y: home.y + 3 },
      to: { ...home },
      fromName: 'Поле',
      toName: 'Наша деревня',
      departAt: since - 3 * MINUTE,
      arriveAt: since + 12 * MINUTE,
      phase: 'back',
      power: 1,
      loot: null,
    };
    save.marches.push(m);
  }
  if (kind === 'handover') {
    // Дружина распускалась, когда встал лагерь, и вернётся в гарнизон через шесть минут.
    save.figures.general.handover = { troops: {}, until: since + 6 * MINUTE };
  }
  if (kind === 'general-home') {
    // Полководец без дружины идёт к своим воротам из поля.
    const g = save.figures.general;
    g.phase = 'moving';
    g.from = { x: home.x + 4, y: home.y + 1 };
    g.to = { ...home };
    g.departAt = since - MINUTE;
    g.arriveAt = since + 9 * MINUTE;
  }
}

/** Поднять мир из сохранения на минуте `at`. */
async function thaw(fz: Frozen, at: number, kind: Inject) {
  let now = at;
  const save = JSON.parse(fz.save) as WorldSave;
  inject(save, kind, fz.since);
  const world = new NotifyingWorld({ seed: fz.seed, now: () => now, storage: memory(JSON.stringify(save)) });
  const pulse = await world.sync(holdout);
  return { world, pulse, set: (t: number): void => void (now = t) };
}

/** Прогон без действий игрока: пульсы, как у клиента, до минуты `to`. Последний пульс — назад. */
async function runTo(w: Awaited<ReturnType<typeof thaw>>, from: number, to: number): Promise<WorldPulse> {
  for (let t = from + 20_000; t < to; t += 20_000) {
    w.set(t);
    await w.world.sync(holdout);
  }
  w.set(to);
  return w.world.sync(holdout);
}

const SEEDS = [7, 11, 101];

describe('разрыв держит правду', () => {
  /**
   * Каждый осадный черновик, выпущенный в минуту `t`, после прогона того же сохранения до
   * минуты, о которой он говорит (конец хлеба), без действий игрока описывает то же окно:
   * тот же конец хлеба, то же начало осады, та же участь.
   *
   * Граница области — утверждениями: осада на `t` идёт, и `t < fireAt < until ≤ about`;
   * пункты, чей `fireAt` уже прошёл к `t`, в точки не берутся (их отбросит сервер: игрок
   * их видел). Миры — чистые и с назначенными пересчётами окна: свой отряд идёт домой,
   * кончается передача дружины, полководец идёт к своим воротам. В последних черновиков
   * быть не должно вовсе; появятся — прогон покажет, на сколько окно уехало.
   */
  it('черновик осады, прогнанный до конца хлеба, описывает то же окно', async () => {
    let checked = 0;
    for (const seed of SEEDS) {
      const fz = await freeze(seed);
      for (const kind of ['none', 'march-home', 'handover', 'general-home'] as Inject[]) {
        for (const dt of [MINUTE, 5 * MINUTE]) {
          const t = fz.since + dt;
          const w = await thaw(fz, t, kind);
          expect(w.pulse.siege, `сид ${seed}, ${kind}, +${dt / MINUTE} мин: осада на t идёт`).not.toBeNull();
          const drafts = await w.world.notices();
          const points = drafts.items.filter((i) => i.kind !== 'raid' && i.fireAt > t);
          if (points.length === 0) continue;
          const about = points[0].p.about;
          for (const i of points) {
            expect(i.fireAt, `${i.key}: fireAt < until`).toBeLessThan(i.until);
            expect(i.until, `${i.key}: until ≤ about`).toBeLessThanOrEqual(i.p.about);
            expect(i.p.about, `${i.key}: одна минута на оба пункта`).toBe(about);
          }
          const end = await runTo(w, t, about - 1000);
          const label = `сид ${seed}, ${kind}, черновик с +${dt / MINUTE} мин`;
          expect(end.siege, `${label}: осада дожила до конца хлеба`).not.toBeNull();
          expect(
            Math.round((end.siege!.starvesAt - about) / 1000),
            `${label}: окно уехало за прогон, с — черновик соврал бы`,
          ).toBe(0);
          expect(end.siege!.since, `${label}: начало осады`).toBe(fz.since);
          expect(end.siege!.fate, `${label}: участь`).toBe(points[0].p.fate);
          checked += points.length;
        }
      }
    }
    expect(checked, 'точек внутри области').toBeGreaterThan(6);
  }, 120_000);

  /**
   * Молчание вместо неправды считается: мир, где до конца хлеба назначен пересчёт окна,
   * не выпускает ни одного осадного пункта и называет причину. Без этого правила
   * отправленное «хлеба до HH:MM» становилось бы неправдой без единого действия игрока.
   */
  it('назначенный пересчёт окна — ни одного осадного пункта, и причина названа', async () => {
    for (const seed of SEEDS) {
      const fz = await freeze(seed);
      for (const kind of ['march-home', 'handover', 'general-home'] as Inject[]) {
        const w = await thaw(fz, fz.since + MINUTE, kind);
        expect(w.pulse.siege, `сид ${seed}, ${kind}: осада идёт`).not.toBeNull();
        const drafts = await w.world.notices();
        const siegeItems: NoticeItem[] = drafts.items.filter((i) => i.kind !== 'raid');
        expect(siegeItems, `сид ${seed}, ${kind}: осадных пунктов`).toEqual([]);
        expect(drafts.silent.filter((s) => s.kind !== 'raid').map((s) => s.why), `сид ${seed}, ${kind}`).toEqual([kind, kind]);
      }
    }
  }, 60_000);

  /** Набег: черновик, прогнанный до прихода, говорит о том же отряде и той же минуте. */
  it('черновик набега, прогнанный до прихода, говорит о том же приходе', async () => {
    let checked = 0;
    for (const seed of [202, 404, 606]) {
      let now = START;
      const store = memory();
      const world = new NotifyingWorld({ seed, now: () => now, storage: store });
      await world.sync(profile());
      let item: NoticeItem | undefined;
      for (let i = 0; i < 400 && !item; i++) {
        now += 20_000;
        await world.sync(profile());
        item = (await world.notices()).items.find((x) => x.kind === 'raid' && x.fireAt > now);
      }
      if (!item) continue;
      const t = now;
      expect(t, `сид ${seed}: t < fireAt < until ≤ about`).toBeLessThan(item.fireAt);
      expect(item.until).toBeLessThanOrEqual(item.p.about);
      while (now < item.p.about - 20_000) {
        now += 20_000;
        await world.sync(profile());
      }
      const save = JSON.parse(store.read() as string) as WorldSave;
      const id = item.key.split(':')[1];
      const m = save.marches.find((x) => x.id === id);
      expect(m?.phase, `сид ${seed}: отряд ещё в пути`).toBe('out');
      expect(m?.arriveAt, `сид ${seed}: приход тот же`).toBe(item.p.about);
      checked++;
    }
    expect(checked, 'точек внутри области').toBeGreaterThan(0);
  }, 60_000);
});
