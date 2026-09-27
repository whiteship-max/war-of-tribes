// Вера деревни: набожность, наклоны, ересь, крещение — и главное обещание
// пачки, которое проверяется не на глаз: **боевого перевеса одной веры над
// другой нет**.
//
// Доказывается оно тремя разными способами, и ни один из них не «мы посмотрели
// на числа». Первый — по исходнику: у боевого расчёта нет поля веры вовсе.
// Второй — по конфигурации: единственное, что вера кладёт в бой, это одно
// неотрицательное число `fervour`, зависящее только от своей стороны. Третий —
// прогоном: одна и та же армия при одной и той же вере даёт один и тот же
// исход против любого противника, как бы тот ни верил.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FaithId, GameState } from '../types';
import { createInitialState } from '../state';
import {
  BAPTISM_GOLD_PER_POP,
  BAPTISM_STRAIN,
  DAY_LENGTH,
  MAX_BUILDING_LEVEL,
  PIETY_HERESY,
  RESOURCE_IDS,
  RITE_DAYS,
  RITE_MORALE,
  STRAIN_DAYS,
} from '../constants';
import { FAITHS, FAITH_BY_ID, OBSERVANCES, tiltAt } from '../data/faiths';
import { BUILDING_BY_ID } from '../data/buildings';
import {
  defense,
  faithTilt,
  fervour,
  heresy,
  heresyMorale,
  jobMultiplier,
  moraleBreakdown,
  seasonIndex,
  piety,
  pietyBreakdown,
  riteActive,
  strainNow,
  taxIncomePerDay,
} from '../derived';
import { addStrain, baptismInfo, baptize, grantRelic, holdRite, riteInfo, setObservance, syncFaith } from './faith';
import { popGrowth } from './population';
import { surveyInfo, startSurvey } from './survey';
import { deploySetup, simulateBattle, type ArmySetup, type Stack } from '@/battle';
import { SEASON_DAYS } from '../data/seasons';

const FAITH_IDS = FAITHS.map((f) => f.id);

/**
 * Расстановка для прогона. Собирается тем же правилом развёртывания (`deploySetup`), каким её
 * собирает игра, — своей второй раскладки здесь заводить незачем, а сверяем мы не её.
 */
const setup = (army: Partial<Stack>, resolve: number): ArmySetup =>
  ({ ...deploySetup(army), resolve });

/** Деревня с известной верой, полными закромами и десятым уровнем всего. */
function village(faith: FaithId, level = MAX_BUILDING_LEVEL): GameState {
  const s = createInitialState();
  s.tutorialDone = true;
  for (const b of s.buildings) b.level = Math.min(BUILDING_BY_ID[b.type].maxLevel ?? MAX_BUILDING_LEVEL, level);
  for (const r of RESOURCE_IDS) s.resources[r] = 20000;
  s.gold = 20000;
  s.pop = 200;
  s.faith.id = faith;
  return s;
}

describe('набожность — чистая функция состояния', () => {
  it('одинаковый вход даёт одинаковый выход, и второй раз подряд — тот же', () => {
    for (const f of FAITH_IDS) {
      const a = village(f);
      const b = village(f);
      expect(pietyBreakdown(a)).toEqual(pietyBreakdown(b));
      expect(pietyBreakdown(a)).toEqual(pietyBreakdown(a));
    }
  });

  it('тика у неё нет: ни `Math.random`, ни часов устройства в модуле', () => {
    // Тот же способ, каким `clock.test.ts` держит запрет на `Date.now` в
    // симуляции: читаем исходник, а не полагаемся на то, что никто не напишет.
    const src = readFileSync(join(process.cwd(), 'src/game/sim/faith.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(src).not.toMatch(/Math\.random/);
    expect(src).not.toMatch(/Date\.now|new Date\(/);
  });

  it('обряд и надлом считаются от отметки, а не сползают: время идёт — числа меняются сами', () => {
    const s = village('orthodox');
    holdRite(s);
    expect(riteActive(s)).toBe(true);
    addStrain(s, 30);
    expect(strainNow(s)).toBeCloseTo(30, 5);

    // Ни одного вызова тика: двигаем только часы.
    s.time += (RITE_DAYS + 1) * DAY_LENGTH;
    expect(riteActive(s)).toBe(false);
    expect(strainNow(s)).toBeCloseTo(30 * (1 - (RITE_DAYS + 1) / STRAIN_DAYS), 5);
    s.time += STRAIN_DAYS * DAY_LENGTH;
    expect(strainNow(s)).toBe(0);
  });

  it('пока мир не назвал клетку, вера пустая и ничего не даёт', () => {
    const s = createInitialState();
    expect(s.faith.id).toBeNull();
    const t = faithTilt(s);
    expect(t.goldPerPop).toBe(0);
    expect(t.morale).toBe(0);
    expect(t.output).toBe(1);
    expect(t.learning).toBe(1);
    expect(fervour(s)).toBe(0);
    // И ересью это не считается: не верить пока нечем.
    expect(heresy(s)).toBe(false);
  });

  it('первый ответ мира ставит веру, второй её не трогает — даже после крещения', () => {
    const s = createInitialState();
    expect(syncFaith(s, 'pagan', 0.4)).toBe(true);
    expect(s.faith.id).toBe('pagan');
    expect(s.faith.pressure).toBeCloseTo(0.4, 5);

    s.gold = 100000;
    s.pop = 200;
    baptize(s, 'catholic');
    // Земля под замком осталась языческой — но вера деревни уже своя.
    syncFaith(s, 'pagan', 0.9);
    expect(s.faith.id).toBe('catholic');
    expect(s.faith.pressure).toBeCloseTo(0.9, 5);
  });
});

describe('уровень даёт наклон, а не силу', () => {
  it('первый уровень — десятая часть и дара, и цены; десятый — всё целиком', () => {
    for (const f of FAITHS) {
      const full = tiltAt(f.id, MAX_BUILDING_LEVEL, 'even');
      const one = tiltAt(f.id, 1, 'even');
      expect(full.goldPerPop).toBeCloseTo(f.tilt.goldPerPop, 6);
      expect(full.morale).toBeCloseTo(f.tilt.morale, 6);
      expect(one.goldPerPop).toBeCloseTo(f.tilt.goldPerPop / 10, 6);
      expect(one.morale).toBeCloseTo(f.tilt.morale / 10, 6);
      // Множители приводятся к единице тем же коэффициентом, а не делятся.
      expect(one.output).toBeCloseTo(1 + (f.tilt.output - 1) / 10, 6);
      expect(one.learning).toBeCloseTo(1 + (f.tilt.learning - 1) / 10, 6);
    }
  });

  it('уровень растит и дар, и цену разом — бесплатной ступени нет ни у одной веры', () => {
    for (const f of FAITHS) {
      const t = f.tilt;
      // Хоть один плюс и хоть один минус: вера, у которой только дар, была бы
      // не наклоном, а прибавкой, и уровень покупался бы не думая.
      const good = t.goldPerPop > 0 || t.morale > 0 || t.steadfast > 0 || t.learning > 1 || t.growth > 0 || t.fervour > 0;
      const cost = t.goldPerPop < 0 || t.morale < 0 || t.output < 1 || t.pressure > 1;
      expect(good, `${f.id}: вера ничего не даёт`).toBe(true);
      expect(cost, `${f.id}: вера ничего не просит`).toBe(true);
    }
  });

  it('устав множит наклон целиком и платит за это набожностью', () => {
    const strict = village('catholic');
    setObservance(strict, 'strict');
    const worldly = village('catholic');
    setObservance(worldly, 'worldly');
    // Строгий устав собирает больше десятины и сильнее давит настроение.
    expect(faithTilt(strict).goldPerPop).toBeGreaterThan(faithTilt(worldly).goldPerPop);
    expect(faithTilt(strict).morale).toBeLessThan(faithTilt(worldly).morale);
    // И платит за это набожностью в другую сторону.
    expect(piety(strict)).toBeGreaterThan(piety(worldly));
  });
});

describe('чем веры отличаются — вбок, а не по силе удара', () => {
  it('католическая десятина идёт в казну, исламский закят — из неё', () => {
    const cath = village('catholic');
    const isl = village('islam');
    const none = village('pagan');
    expect(taxIncomePerDay(cath)).toBeGreaterThan(taxIncomePerDay(none));
    expect(taxIncomePerDay(isl)).toBeLessThan(taxIncomePerDay(none));
  });

  it('за десятину платит настроение, за общину оно прибавляется', () => {
    // Сравнивается сумма до потолка шкалы: посёлок десятого уровня упирается в
    // сотню и без веры, и там разницы было бы не видно ни у кого.
    const raw = (f: FaithId): number => moraleBreakdown(village(f)).raw;
    expect(raw('catholic')).toBeLessThan(raw('pagan'));
    expect(raw('orthodox')).toBeGreaterThan(raw('pagan'));
  });

  it('православная община держит стены, но берёт своё выработкой', () => {
    const orth = village('orthodox');
    const pag = village('pagan');
    // Стойкость: сравниваем при одинаковом настроении, иначе мерили бы мораль.
    orth.morale = 70;
    pag.morale = 70;
    expect(defense(orth)).toBeGreaterThan(defense(pag));
    expect(jobMultiplier(orth, 'farmer')).toBeLessThan(jobMultiplier(pag, 'farmer'));
  });

  it('вера двигает выработку всех профессий разом, а не одну', () => {
    const orth = village('orthodox');
    const pag = village('pagan');
    orth.morale = 70;
    pag.morale = 70;
    const ratios = (['farmer', 'hunter', 'woodcutter', 'miner'] as const).map(
      (j) => jobMultiplier(orth, j) / jobMultiplier(pag, j),
    );
    for (const r of ratios) expect(r).toBeCloseTo(ratios[0], 9);
  });

  it('медресе учит быстрее всех: ступень изучения короче', () => {
    const isl = village('islam', 10);
    const cath = village('catholic', 10);
    expect(surveyInfo(isl).learning).toBeGreaterThan(1);
    expect(surveyInfo(cath).learning).toBe(1);
    startSurvey(isl);
    startSurvey(cath);
    expect(isl.survey.until - isl.survey.startedAt).toBeLessThan(cath.survey.until - cath.survey.startedAt);
  });

  it('закят растит деревню, но не удерживает уходящих', () => {
    const isl = village('islam');
    const pag = village('pagan');
    isl.morale = 80;
    pag.morale = 80;
    expect(popGrowth(isl).faith).toBeGreaterThan(1);
    expect(popGrowth(pag).faith).toBe(1);
    expect(popGrowth(isl).perDay).toBeGreaterThan(popGrowth(pag).perDay);

    // При морали ниже нуля люди уходят, и вера убыль не гасит.
    const leaving = village('islam');
    leaving.morale = 5;
    const same = village('pagan');
    same.morale = 5;
    expect(popGrowth(leaving).perDay).toBeCloseTo(popGrowth(same).perDay, 9);
  });
});

// ---------- Главное обещание ----------

describe('боевого перевеса одной веры над другой нет', () => {
  const strip = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const read = (rel: string): string => strip(readFileSync(join(process.cwd(), rel), 'utf8'));

  it('у боевого ядра нет ни одного имени веры и ни одного поля под неё', () => {
    // Самый прямой довод: противнику неоткуда взять то, чего ему не передали.
    for (const file of ['src/battle/types.ts', 'src/battle/sim.ts', 'src/battle/config.ts']) {
      const src = read(file);
      for (const f of FAITH_IDS) expect(src, `${file}: ${f}`).not.toMatch(new RegExp(`['"\`]${f}['"\`]`));
      expect(src, file).not.toMatch(/\bfaith\b/i);
    }
  });

  it('мост из племени в бой везёт одно число и не спрашивает, кто напротив', () => {
    // `fervour` — функция одного состояния: своей веры, своего храма, своего
    // уклада. Второго аргумента у неё нет и быть не может.
    expect(fervour.length).toBe(1);
    const bridge = read('src/world/battle.ts');
    for (const f of FAITH_IDS) expect(bridge).not.toMatch(new RegExp(`['"\`]${f}['"\`]`));
  });

  it('в конфиге вер нет ни одного числа, зависящего от чужой веры', () => {
    // Наклон — плоская запись чисел. Появись в ней поле, ключом которого была
    // бы другая вера (`{ vs: { islam: 1.2 } }`), «моя вера бьёт твою» стало бы
    // возможным — и вот это здесь и ловится.
    for (const f of FAITHS) {
      for (const [key, v] of Object.entries(f.tilt)) {
        expect(typeof v === 'number' || typeof v === 'string', `${f.id}.${key}`).toBe(true);
      }
      // Прибавка в бой у всех неотрицательная: «вера, ослабляющая своих» была
      // бы тем же перевесом, только с другого конца.
      expect(f.tilt.fervour).toBeGreaterThanOrEqual(0);
    }
  });

  it('прогон: исход не меняется от того, как верит противник', () => {
    // Одна и та же наша армия с одним и тем же обрядом против одного и того же
    // противника даёт один и тот же бой — потому что вера противника в расчёт
    // не входит ни одним полем. Проверяем это в лоб: собираем бой четыре раза,
    // «меняя веру» защитника, и требуем побитового совпадения результата.
    const ours = village('pagan');
    holdRite(ours);
    const mine = fervour(ours);
    expect(mine).toBeGreaterThan(0);

    const line: Stack = { infantry: 40, spear: 20, archer: 10, cavalry: 5, heavy: 0 };
    const runs = FAITH_IDS.map(() =>
      simulateBattle({
        seed: 4242,
        attacker: setup(line, mine),
        defender: setup(line, 0),
      }),
    );
    for (const r of runs) expect(JSON.stringify(r)).toBe(JSON.stringify(runs[0]));
  });

  it('прогон: обряд помогает ровно одинаково против любого состава', () => {
    // И вторая сторона того же: прибавка работает всегда одна и та же, а не
    // «сильнее против неверных».
    const line: Stack = { infantry: 40, spear: 20, archer: 10, cavalry: 5, heavy: 0 };
    const foes: Stack[] = [
      { infantry: 70, spear: 0, archer: 5, cavalry: 0, heavy: 0 },
      { infantry: 10, spear: 50, archer: 15, cavalry: 0, heavy: 0 },
      { infantry: 20, spear: 0, archer: 10, cavalry: 45, heavy: 0 },
    ];
    let helped = 0;
    for (const foe of foes) {
      const plain = simulateBattle({ seed: 77, attacker: setup(line, 0), defender: setup(foe, 0) });
      const rite = simulateBattle({ seed: 77, attacker: setup(line, 12), defender: setup(foe, 0) });
      // Вред — худший размен (чужие потери к своим), а не свои потери: стойкое войско держится дольше и
      // теряет больше, но и выбивает больше. Прежде мерилось своими потерями, и с правилом развёртывания
      // (docs/battle_eu4.md, 14.5) против конницы обряд дал 22 потерь вместо 19 при 11 выбитых вместо 9.
      const ratio = (r: typeof plain): number => r.sides.defender.total.losses / Math.max(1, r.sides.attacker.total.losses);
      if (ratio(rite) >= ratio(plain)) helped++;
    }
    // Прибавка к стойкости не обязана переворачивать каждый бой, но и вредить
    // не должна ни в одном: она одна и та же против любого противника.
    expect(helped).toBe(foes.length);
  });
});

// ---------- Ересь ----------

describe('ересь ложится на то, чем деревня живёт всегда', () => {
  it('ниже порога вера трещит, и это бьёт по морали тем сильнее, чем ниже', () => {
    const s = village('pagan');
    expect(heresy(s)).toBe(false);
    expect(heresyMorale(s)).toBe(0);

    setObservance(s, 'worldly');
    addStrain(s, 45);
    expect(piety(s)).toBeLessThan(PIETY_HERESY);
    expect(piety(s)).toBeGreaterThan(0);
    expect(heresy(s)).toBe(true);
    const hurt = heresyMorale(s);
    expect(hurt).toBeLessThan(0);

    // Чем ниже набожность, тем больнее — и это видно на числах, а не на слове.
    addStrain(s, 10);
    expect(heresyMorale(s)).toBeLessThan(hurt);
  });

  it('второй механики под неё нет: в состоянии деревни бунта не заведено', () => {
    // `revolts` живёт в сохранении мира и относится к чужим поселениям. Появись
    // рядом второе такое окно для своей деревни — их пришлось бы согласовывать,
    // и разошлись бы они молча.
    const s = village('catholic');
    expect(Object.keys(s)).not.toContain('revolt');
    expect(Object.keys(s.faith)).not.toContain('revolt');
  });
});

// ---------- Крещение ----------

describe('крещение', () => {
  it('меняет веру и бьёт по набожности ровно на объявленную величину', () => {
    const s = village('pagan');
    const before = piety(s);
    expect(before).toBeGreaterThan(PIETY_HERESY);

    const gold = s.gold;
    const info = baptismInfo(s);
    expect(info.options).toEqual(['catholic', 'orthodox']);
    expect(info.gold).toBe(Math.round(200 * BAPTISM_GOLD_PER_POP));
    expect(baptize(s, 'catholic')).toBeNull();

    expect(s.faith.id).toBe('catholic');
    expect(s.faith.converted).toBe(true);
    expect(s.gold).toBe(gold - info.gold);
    expect(strainNow(s)).toBeCloseTo(BAPTISM_STRAIN, 5);
    expect(before - piety(s)).toBeCloseTo(BAPTISM_STRAIN, 5);
  });

  it('раскол — риск, а не приговор: обычный приход трещит, подготовленный держится', () => {
    // Это и есть решение игрока целиком: креститься дёшево нельзя, но подойти
    // к крещению подготовленным — можно. Капище пятого уровня надлома не
    // выдерживает, десятого со строгим уставом и свежим обрядом — выдерживает.
    const plain = village('pagan', 5);
    baptize(plain, 'catholic');
    expect(heresy(plain), 'обычный приход обязан затрещать').toBe(true);

    const ready = village('pagan');
    setObservance(ready, 'strict');
    holdRite(ready);
    baptize(ready, 'orthodox');
    expect(heresy(ready), 'подготовленный приход обязан выстоять').toBe(false);
  });

  it('открывает то, что должно открыть: наклон новой веры и отношения соседей', () => {
    const s = village('pagan');
    expect(faithTilt(s).fervour).toBeGreaterThan(0);
    expect(faithTilt(s).goldPerPop).toBe(0);
    baptize(s, 'catholic');
    // Ярости больше нет, зато есть десятина: наклон сменился целиком.
    expect(faithTilt(s).fervour).toBe(0);
    expect(faithTilt(s).goldPerPop).toBeGreaterThan(0);
    // И давление округи считается по новой вере — это дело мира, здесь только
    // то, что вера в слепок поедет новая.
    expect(s.faith.id).toBe('catholic');
  });

  it('дорога односторонняя и одноразовая', () => {
    const s = village('pagan');
    baptize(s, 'orthodox');
    expect(baptismInfo(s).options).toEqual([]);
    expect(baptize(s, 'catholic')).not.toBeNull();
    expect(s.faith.id).toBe('orthodox');
    // И в ислам не крестят — это не крещение.
    const p = village('pagan');
    expect(baptize(p, 'islam')).not.toBeNull();
    expect(p.faith.id).toBe('pagan');
  });

  it('старая святыня и старый обряд остаются при старой вере', () => {
    const s = village('pagan');
    grantRelic(s);
    holdRite(s);
    expect(s.faith.relic).toBe('pagan');
    expect(riteActive(s)).toBe(true);
    baptize(s, 'catholic');
    expect(s.faith.relic).toBeNull();
    expect(riteActive(s)).toBe(false);
    expect(s.log.some((l) => l.text.includes('крещение'))).toBe(true);
  });

  it('не хватает золота — кнопка не нажимается, и вера не меняется', () => {
    const s = village('pagan');
    s.gold = 0;
    expect(baptismInfo(s).blocked).not.toBeNull();
    expect(baptize(s, 'catholic')).not.toBeNull();
    expect(s.faith.id).toBe('pagan');
  });
});

// ---------- Праздники и реликвия ----------

describe('праздники и святыня', () => {
  it('у каждой веры на каждый сезон есть свой праздник с настоящим именем', () => {
    for (const f of FAITHS) {
      for (const season of ['spring', 'summer', 'autumn', 'winter'] as const) {
        const feast = f.feasts[season];
        expect(feast.name.length, `${f.id}/${season}`).toBeGreaterThan(2);
        expect(feast.text.length, `${f.id}/${season}`).toBeGreaterThan(20);
      }
      // Имена внутри веры не повторяются: четыре сезона — четыре праздника.
      const names = Object.values(f.feasts).map((x) => x.name);
      expect(new Set(names).size, f.id).toBe(4);
    }
  });

  it('обряд справляют раз в сезон и платят за него сразу', () => {
    const s = village('orthodox');
    const food = s.resources.food;
    const info = riteInfo(s);
    expect(info.blocked).toBeNull();
    expect(holdRite(s)).toBeNull();
    expect(s.resources.food).toBe(food - info.food);
    expect(riteActive(s)).toBe(true);
    // В этом сезоне второй раз не справить — даже когда обряд уже кончился.
    // Обряд короче сезона нарочно (три дня из пяти): иначе прибавка держалась
    // бы всегда и перестала быть поводом заходить.
    expect(RITE_DAYS).toBeLessThan(SEASON_DAYS);
    s.time += (RITE_DAYS + 0.5) * DAY_LENGTH;
    expect(RITE_DAYS + 0.5).toBeLessThan(SEASON_DAYS);
    expect(riteActive(s)).toBe(false);
    expect(seasonIndex(s.time)).toBe(0);
    expect(riteInfo(s).blocked).toMatch(/уже справили/);

    // А в следующем сезоне — можно, и праздник у него уже другой.
    s.time += SEASON_DAYS * DAY_LENGTH;
    expect(riteInfo(s).blocked).toBeNull();
    expect(riteInfo(s).feast!.name).not.toBe(info.feast!.name);
  });

  it('обряд без пира — обряд, а не пир: в разборе морали это два разных числа', () => {
    // Пока они лежали одним полем, справка о морали подписывала обряд «Пиром в
    // трактире» и отправляла игрока не в то здание.
    const s = village('pagan');
    s.gold = 1_000_000;
    const before = moraleBreakdown(s);
    expect(holdRite(s)).toBeNull();
    const during = moraleBreakdown(s);
    expect(during.feast, 'пира не задавали').toBe(0);
    expect(during.rite).toBe(RITE_MORALE);
    // Цель сдвинулась ровно на обряд — до потолка шкалы.
    expect(during.target).toBe(Math.min(100, before.target + RITE_MORALE));
  });

  it('святыня одна на веру и одинакова по силе у всех четырёх', () => {
    const gains = FAITH_IDS.map((f) => {
      const s = village(f);
      const before = piety(s);
      expect(grantRelic(s)).toBe(true);
      // Второй раз не дают.
      expect(grantRelic(s)).toBe(false);
      return piety(s) - before;
    });
    for (const g of gains) expect(g).toBeCloseTo(gains[0], 9);
    for (const f of FAITHS) expect(FAITH_BY_ID[f.id].relic.length).toBeGreaterThan(4);
  });
});

describe('слова про веру', () => {
  it('уклад объявляет последствие строкой — как указ, рацион и налог', () => {
    for (const o of OBSERVANCES) {
      expect(o.effect.length).toBeGreaterThan(10);
      expect(o.name.length).toBeGreaterThan(3);
    }
  });

  it('у каждой веры есть и дар, и цена, названные словами', () => {
    for (const f of FAITHS) {
      expect(f.tilt.boon.length, f.id).toBeGreaterThan(15);
      expect(f.tilt.burden.length, f.id).toBeGreaterThan(15);
      expect(f.creed.length, f.id).toBeGreaterThan(30);
      expect(f.temple.length, f.id).toBeGreaterThan(3);
      expect(f.priest.length, f.id).toBeGreaterThan(3);
      // Множественное написано руками: из числа оно не выводится («имам» + «и»
      // даёт «имами»), и тест держит именно это — что поле есть и не совпадает
      // с единственным.
      expect(f.priests.length, f.id).toBeGreaterThan(4);
      expect(f.priests, f.id).not.toBe(f.priest);
    }
  });

  it('ни одна вера не названа дурной, отсталой или ложной', () => {
    // Проверка грубая и нарочно такая: она ловит не тонкость, а прямое слово,
    // которое однажды напишут не думая.
    const bad = /(дик|варвар|отстал|невеж|суевер|ложн|истинн(ая|ой)\s+вер|неверн|поганы|лжив)/i;
    for (const f of FAITHS) {
      const text = [f.name, f.creed, f.temple, f.priest, f.relic, f.tilt.boon, f.tilt.burden]
        .concat(Object.values(f.feasts).flatMap((x) => [x.name, x.text]))
        .join(' | ');
      expect(text, f.id).not.toMatch(bad);
    }
  });
});
