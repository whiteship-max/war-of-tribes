// Осада и падение города глазами карты и карточки — и имя своего города.
//
// Три свойства, и все три меряются на настоящем мире, а не сравниваются с константой:
//   * часы голода одни: карточка города, окно осады, окно лагеря и вид на карте дают
//     одно и то же число на одном и том же состоянии;
//   * знак павшего города — та участь, что на самом деле случилась (не объявленная),
//     и сходит ровно через `FALL_MARK`;
//   * осаду со стороны видно только в живом обзоре, и срока голода посторонний не узнаёт.
import { describe, expect, it } from 'vitest';
import { LocalWorld, HOME_ID } from './local/LocalWorld';
import { distance } from './geo';
import { openSiege, starvesAt } from './siege';
import { FALL_MARK, SIEGE_IMMUNE, SIEGE_COOLDOWN } from './data/tuning';
import { FATE_META } from './data/fates';
import { hungerLeft } from '@/ui/parts/hunger';
import { cityOr } from '../../netlify/lib/contract';
import type { TroopStack } from '@/game/battle/kinds';
import type { Fate, FigureView, PlayerProfile, SettlementView, WorldPulse } from './types';
import type { WorldSave } from './local/state';

const START = 1_700_000_000_000;
const MIN = 60_000;

function memory(data: string | null = null) {
  return {
    read: (): string | null => data,
    write: (json: string): void => {
      data = json;
    },
  };
}

/** Деревня, которую штурмовать бессмысленно: набег садится лагерем. */
const holdout = (over: Partial<PlayerProfile> = {}): PlayerProfile => ({
  name: 'Тест',
  pop: 120,
  defense: 100_000,
  warriorPower: 3,
  units: { warrior: 10, scout: 4 },
  command: 100,
  army: { spearman: 10 },
  stock: { food: 600, wood: 400 },
  stash: 0,
  food: 6000,
  foodPerHour: 6000,
  soldierFoodPerHour: 60,
  ...over,
});

/** Вид своего города в куске карты. */
async function homeView(world: LocalWorld): Promise<SettlementView> {
  const info = await world.info();
  const chunk = await world.region({ x: info.home.x - 2, y: info.home.y - 2, w: 4, h: 4 });
  const home = chunk.settlements.find((s) => s.id === HOME_ID);
  expect(home, 'свой город в куске').toBeTruthy();
  return home as SettlementView;
}

async function viewOf(world: LocalWorld, s: { id: string; x: number; y: number }): Promise<SettlementView> {
  const chunk = await world.region({ x: s.x - 2, y: s.y - 2, w: 4, h: 4 });
  const v = chunk.settlements.find((o) => o.id === s.id);
  expect(v, `поселение ${s.id} в куске`).toBeTruthy();
  return v as SettlementView;
}

/** Мир до первой осады своего города — и его сохранение в эту минуту. */
async function frozenHomeSiege(seed = 7, p = holdout()): Promise<{ save: string; at: number; pulse: WorldPulse }> {
  let now = START;
  const store = memory();
  const world = new LocalWorld({ seed, now: () => now, storage: store });
  await world.sync(p);
  for (let i = 0; i < 6000; i++) {
    now += 20_000;
    const pulse = await world.sync(p);
    if (pulse.siege) return { save: store.read() as string, at: now, pulse };
  }
  throw new Error('осады так и не случилось');
}

function thaw(save: string, at: number, seed = 7, edit?: (s: WorldSave) => void, reveal = false) {
  let now = at;
  const data = JSON.parse(save) as WorldSave;
  edit?.(data);
  const store = memory(JSON.stringify(data));
  const world = new LocalWorld({ seed, now: () => now, storage: store, reveal });
  return { world, store, set: (t: number): void => void (now = t), now: (): number => now };
}

describe('часы голода одни на карточку, окна осады и карту', () => {
  it('свой город в осаде: окно, карточка и вид на карте называют одну минуту на каждой точке окна', async () => {
    const fz = await frozenHomeSiege();
    const end = fz.pulse.siege!.starvesAt;
    // Точки — внутри области правила: осада идёт на каждой, это утверждение, а не расчёт.
    const points = [0, 0.13, 0.37, 0.61, 0.88].map((k) => Math.round(fz.at + (end - fz.at) * k));
    for (const at of points) {
      const t = thaw(fz.save, at);
      const pulse = await t.world.sync(holdout());
      expect(pulse.siege, `осада идёт в ${at - fz.at} мс`).toBeTruthy();
      const siege = pulse.siege!;
      expect(t.now()).toBeLessThan(siege.starvesAt);
      const card = await t.world.settlement(HOME_ID);
      const view = await homeView(t.world);
      expect(card?.siege?.starvesAt, 'карточка несёт часы участнику').toBe(siege.starvesAt);
      expect(view.besieged?.starvesAt, 'вид на карте — ту же минуту').toBe(siege.starvesAt);
      // И слова одни: у интерфейса один переводчик минуты в строку.
      expect(hungerLeft(card!.siege!.starvesAt!, t.now())).toBe(hungerLeft(siege.starvesAt, t.now()));
    }
  }, 120_000);

  it('на окнах с другим амбаром и другим гарнизоном — снова одна минута во всех местах', async () => {
    const fz = await frozenHomeSiege();
    const seen = new Set<number>();
    for (const [food, garrison] of [
      [1500, 0],
      [6000, 40],
      [24_000, 300],
      [90_000, 5],
    ]) {
      const t = thaw(fz.save, fz.at + MIN, 7, (s) => {
        s.sieges[HOME_ID] = { ...s.sieges[HOME_ID], foodAtStart: food, garrisonAtStart: garrison, startedAt: fz.at };
      });
      const siege = (await t.world.sync(holdout())).siege!;
      expect(siege, `осада идёт (${food}/${garrison})`).toBeTruthy();
      expect(t.now()).toBeLessThan(siege.starvesAt);
      seen.add(siege.starvesAt);
      expect((await t.world.settlement(HOME_ID))?.siege?.starvesAt).toBe(siege.starvesAt);
      expect((await homeView(t.world)).besieged?.starvesAt).toBe(siege.starvesAt);
    }
    // Проверка не пустая: окна действительно разные, и минута голода у них разная.
    expect(seen.size).toBeGreaterThan(1);
  }, 120_000);

  it('свой лагерь под чужим городом: окно лагеря, карточка и карта — одна минута', async () => {
    let now = START;
    const store = memory();
    const world = new LocalWorld({ seed: 7, now: () => now, storage: store });
    const HOST: TroopStack = { legionary: 30, spearman: 24, archer: 16 };
    const p = holdout({ defense: 900, army: { ...HOST }, command: 200 });
    await world.sync(p);
    expect(await world.setGarrison({ ...HOST })).toBeNull();
    now = Math.max(now, ((await world.figures()).find((f) => f.id === 'general') as FigureView).readyAt);
    await world.sync(p);
    const info = await world.info();
    const near = (await world.region({ x: info.home.x - 24, y: info.home.y - 24, w: 48, h: 48 })).settlements
      .filter((s) => !s.mine)
      .sort((a, b) => distance(info.home, a) - distance(info.home, b))[0];
    expect(await world.moveFigure('general', { x: near.x, y: near.y })).toBeNull();
    now = Math.max(now, ((await world.figures()).find((f) => f.id === 'general') as FigureView).arriveAt);
    await world.sync(p);
    expect(await world.besiege('captives')).toBeNull();
    const camp0 = await world.camp();
    expect(camp0).toBeTruthy();
    let checked = 0;
    for (const k of [0.05, 0.3, 0.7]) {
      now = Math.round(camp0!.since + (camp0!.starvesAt - camp0!.since) * k);
      await world.sync(p);
      const camp = await world.camp();
      if (!camp) break; // лагерь могли разбить — дальше точек нет, и это не про часы
      checked++;
      expect(now).toBeLessThan(camp.starvesAt);
      const card = await world.settlement(near.id);
      expect(card?.siege?.mine).toBe(true);
      expect(card?.siege?.starvesAt).toBe(camp.starvesAt);
      expect((await viewOf(world, near)).besieged?.starvesAt).toBe(camp.starvesAt);
    }
    expect(checked, 'хотя бы одна точка внутри осады проверена').toBeGreaterThan(0);
  }, 120_000);
});

describe('осаду со стороны видно по правилу тумана', () => {
  it('чужой лагерь: вне живого обзора рогаток нет, в обзоре — есть, но без срока голода', async () => {
    const fz = await frozenHomeSiege();
    // Разведана вся земля: иначе дальний двор не попал бы в кусок карты вовсе, и «вне
    // обзора рогаток нет» проверялось бы на поселении, которого игрок и так не видит.
    const probe = thaw(fz.save, fz.at, 7, undefined, true);
    const info = await probe.world.info();
    const list = (await probe.world.region({ x: info.home.x - 100, y: info.home.y - 100, w: 200, h: 200 })).settlements
      .filter((s) => !s.mine && !s.ruin);
    const seen = list.find((s) => s.visible);
    const unseen = list.find((s) => !s.visible);
    expect(seen && unseen, 'в округе есть и видимый, и невидимый двор').toBeTruthy();
    const other = (id: string) => list.find((s) => s.id !== id)!.id;
    // Чужой лагерь под обоими: осада мира, в которой игрок не участвует.
    const t = thaw(fz.save, fz.at + MIN, 7, (save) => {
      delete save.sieges[HOME_ID];
      for (const s of [seen!, unseen!]) {
        save.sieges[s.id] = openSiege({
          byId: other(s.id),
          campId: `foreign-${s.id}`,
          now: fz.at,
          food: 1e9,
          garrison: 5,
          townPerHour: 10,
          perManPerHour: 1,
        });
      }
    }, true);
    const a = await viewOf(t.world, seen!);
    const b = await viewOf(t.world, unseen!);
    expect(a.visible && !b.visible, 'видимость та же, что до осады').toBe(true);
    expect(a.besieged, 'в обзоре рогатки видно').toBeTruthy();
    expect(a.besieged?.starvesAt, 'но срок голода посторонним не едет').toBeUndefined();
    expect(b.besieged, 'вне обзора рогаток нет').toBeNull();
    const card = await t.world.settlement(seen!.id);
    expect(card?.siege?.starvesAt, 'и карточка посторонним срока не называет').toBeUndefined();
  }, 120_000);
});

describe('знак павшего города — та участь, что случилась', () => {
  /** Довести осаду своего города до голода с объявленной участью. */
  async function fall(declared: Fate, edit?: (s: WorldSave) => void) {
    const fz = await frozenHomeSiege();
    const end = fz.pulse.siege!.starvesAt;
    const t = thaw(fz.save, end + 1_000, 7, (save) => {
      save.sieges[HOME_ID].fate = declared;
      edit?.(save);
    });
    const pulse = await t.world.sync(holdout());
    return { t, pulse, end, fz };
  }

  it('каждая объявленная участь даёт знак ровно той участи, какой город пал', async () => {
    for (const fate of ['plunder', 'captives', 'burn'] as Fate[]) {
      const { t, pulse } = await fall(fate);
      const report = pulse.reports.find((r) => r.title === 'Хлеб кончился');
      expect(report, `город пал голодом (${fate})`).toBeTruthy();
      const view = await homeView(t.world);
      expect(view.fell, `знак стоит (${fate})`).toBeTruthy();
      // Что случилось на самом деле, говорит отчёт о падении, а не приказ лагеря.
      expect(report!.text).toContain(`«${FATE_META[view.fell!.fate].name.toLowerCase()}»`);
      expect(view.fell!.fate).toBe(fate);
    }
  }, 240_000);

  it('объявили сжечь, а сжечь нельзя — знак говорит, что город ограблен', async () => {
    // Сутки после сожжения город нельзя сжечь снова (`BURN_IMMUNE`), и падение подменяет
    // участь умолчанием. Знак обязан показать подменённую, а не объявленную.
    const { t, pulse } = await fall('burn', (save) => {
      save.burnImmune[HOME_ID] = START + 365 * 24 * 60 * MIN;
    });
    const report = pulse.reports.find((r) => r.title === 'Хлеб кончился');
    expect(report?.text).toContain(`«${FATE_META.plunder.name.toLowerCase()}»`);
    expect((await homeView(t.world)).fell?.fate).toBe('plunder');
  }, 120_000);

  it('знак держится `FALL_MARK` и сходит сам, без события', async () => {
    const { t, end } = await fall('captives');
    const at = (await homeView(t.world)).fell!.at;
    expect(at).toBeGreaterThanOrEqual(end);
    t.set(at + FALL_MARK - 1);
    expect((await homeView(t.world)).fell?.fate).toBe('captives');
    t.set(at + FALL_MARK);
    expect((await homeView(t.world)).fell).toBeNull();
  }, 120_000);

  it('новое падение того же города перезаписывает участь: у города одна — последняя', async () => {
    const { t, end, fz } = await fall('captives');
    const at = (await homeView(t.world)).fell!.at;
    // Вторая осада после неприкосновенности и остывания, с другой участью и пустым амбаром.
    const again = Math.max(at + SIEGE_IMMUNE, at + SIEGE_COOLDOWN) + MIN;
    const save = JSON.parse(t.store.read() as string) as WorldSave;
    const w = fz.pulse.siege!;
    const window2 = {
      ...openSiege({ byId: w.byId, campId: 'second', now: again, food: 0, garrison: 0, townPerHour: 10, perManPerHour: 1 }),
      fate: 'burn' as Fate,
    };
    // Точка внутри области правила: вторая осада уже доела город к минуте подъёма мира.
    expect(starvesAt(window2)).toBeLessThanOrEqual(again + 2_000);
    const second = thaw(JSON.stringify(save), again + 2_000, 7, (s) => {
      s.sieges[HOME_ID] = window2;
    });
    await second.world.sync(holdout());
    const view = await homeView(second.world);
    expect(view.fell?.fate).toBe('burn');
    expect(view.fell!.at).toBeGreaterThan(end);
  }, 120_000);
});

describe('имя своего города', () => {
  it('названное имя стоит на карте, в отчёте и в письме — очищенным', async () => {
    const fz = await frozenHomeSiege();
    const raw = '  <b>Ольхо\u200bвец</b>\u0007  на   Реке ';
    const t = thaw(fz.save, fz.at + MIN);
    const pulse = await t.world.sync(holdout({ city: raw }));
    const clean = cityOr(raw);
    expect(clean).toBe('bОльховец/b на Реке');
    expect((await homeView(t.world)).name).toBe(clean);
    const letters = await t.world.letters();
    const siegeLetter = letters.find((l) => l.kind === 'siege');
    expect(siegeLetter, 'письмо об осаде на столе').toBeTruthy();
    expect(siegeLetter!.body).toContain(`«${clean}»`);
    // Отчёт, написанный после имени, называет город им.
    t.set(pulse.siege!.starvesAt + 1_000);
    const fell = (await t.world.sync(holdout({ city: raw }))).reports.find((r) => r.title === 'Хлеб кончился');
    expect(fell?.target.name).toBe(clean);
  }, 120_000);

  it('не назвал — город безымянный, а не «Наша деревня»', async () => {
    const fz = await frozenHomeSiege();
    const t = thaw(fz.save, fz.at + MIN);
    await t.world.sync(holdout({ city: ' \u200b\u200e ' }));
    expect((await homeView(t.world)).name).toBe(cityOr(undefined));
  }, 120_000);
});
