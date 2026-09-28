// Автопилот один, и держится это двумя половинами.
//
// **По исходникам.** Всё, что в `scripts/` гоняет племя во времени или кладёт в него пульс мира, идёт
// через `scripts/autopilot.ts`. Кто нарушает, тест находит сам — по импортам шагов, а не по списку
// отчётов: список ловит только те файлы, о которых подумали, а шестой автопилот заводится как раз в
// новом файле. Шаги — время племени (`tick`, `catchUp`), пульс и его части (`tribePulse`, `syncAway`,
// `syncSiege`, `syncFaith`, `setAway`) и последствие в племя (`applyEffects`, `applyExpedition`).
// Той же меркой проверяется игра: `world/store` пульсует через `tribePulse` и частей пульса не зовёт.
//
// **Прогоном.** Дверь не пустая: игрок в ней отвечает на события и берёт веру, которую называет мир, —
// ровно то, чего не делали прежние копии.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createInitialState } from '@/game/state';
import { MUTINY_EVENT } from '@/game/data/order';
import { faithAt } from '@/world/faith';
import { eventId } from '@/game/sim/mail';
import { setTimeScale, timeScale } from '@/game/pace';
import {
  FLOOR_TROOPS,
  MIX,
  hands,
  hireMastersByMeans,
  openMix,
  pilot,
  played,
  player,
  readyToStrike,
  spareHands,
  spareOf,
  stackOf,
  townAt,
  type Inside,
} from './autopilot';
import type { FigureView } from '@/world/types';
import { FREE_JOBS } from '@/game/data/jobs';
import { idleCount, masterWage, mastersCount, taxIncomePerDay, wagesPerDay } from '@/game/derived';
import { ADMIN_LEVELS, MASTERS_AT } from '@/game/data/realm';
import { mastersInfo } from '@/game/sim/masters';
import { placeOpen, techLevel, troopOpen } from '@/game/sim/tech';
import { pointsOf } from '@/game/sim/points';
import { diploLevelOf, levelPrice, levelsOf, warLevelOfGear, warLevelOfTroop } from '@/game/data/realm';
import { FIGURE_IDS } from '@/world/data/figures';
import { sum } from './raid-common';
import type { TroopId } from '@/game/types';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = path.join(ROOT, 'scripts');
const DOOR = path.join(SCRIPTS, 'autopilot.ts');

/** Шаги, которые идут только через дверь: модуль (по хвосту пути) → имена. */
const STEPS: [string, string[]][] = [
  ['game/sim/tick', ['tick', 'catchUp', 'liveStep', 'absence']],
  ['world/bridge', ['tribePulse', 'syncAway', 'syncSiege', 'applyEffects']],
  ['game/sim/faith', ['syncFaith']],
  ['game/sim/expedition', ['applyExpedition', 'setAway']],
];

const code = (abs: string): string =>
  readFileSync(abs, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const abs = path.join(dir, name);
    if (statSync(abs).isDirectory()) out.push(...sources(abs));
    else if (/\.(ts|mts|mjs|js)$/.test(name) && !/\.test\.(ts|mts|mjs|js)$/.test(name)) out.push(abs);
  }
  return out;
}

/** Что файл берёт из модулей шагов: имена статических импортов, целый модуль (`* as`, `import()`) — как `*`. */
function stepsTaken(src: string): string[] {
  const taken: string[] = [];
  const modOf = (spec: string): [string, string[]] | null => STEPS.find(([m]) => spec.replace(/\.(ts|js)$/, '').endsWith(m)) ?? null;
  for (const m of src.matchAll(/import\s+(type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g)) {
    if (m[1]) continue;
    const step = modOf(m[3]);
    if (!step) continue;
    const clause = m[2];
    if (/\*\s+as\s+/.test(clause)) {
      taken.push(`${step[0]}:*`);
      continue;
    }
    const names = (clause.match(/\{([\s\S]*)\}/)?.[1] ?? '')
      .split(',')
      .map((x) => x.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0])
      .filter(Boolean);
    for (const n of names) if (step[1].includes(n)) taken.push(`${step[0]}:${n}`);
  }
  for (const m of src.matchAll(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const step = modOf(m[1]);
    if (step) taken.push(`${step[0]}:*`);
  }
  return taken;
}

describe('автопилот один: по исходникам', () => {
  it('в scripts/ время племени и пульс мира идут только через scripts/autopilot.ts', () => {
    const files = sources(SCRIPTS).filter((f) => f !== DOOR);
    // Точка внутри области: скрипты найдены, и среди них есть те, кто гоняет мир.
    expect(files.length, 'скрипты найдены').toBeGreaterThan(10);
    const bypass = files
      .map((f) => ({ file: path.relative(ROOT, f).split(path.sep).join('/'), steps: stepsTaken(code(f)) }))
      .filter((x) => x.steps.length > 0)
      .map((x) => `${x.file}: ${x.steps.join(', ')}`);
    expect(bypass, 'скрипты, которые шагают племя или пульсуют мир мимо автопилота').toEqual([]);
  });

  it('дверь живая: шаги в ней, и отчёты её зовут', () => {
    const door = stepsTaken(code(DOOR));
    // Сама проверка импортов обязана видеть шаги там, где они есть, — иначе пустой список выше даром.
    expect(door, 'дверь берёт время и пульс').toEqual(expect.arrayContaining(['game/sim/tick:tick', 'game/sim/tick:catchUp', 'world/bridge:tribePulse', 'world/bridge:applyEffects']));
    const users = sources(SCRIPTS).filter((f) => f !== DOOR && /from\s+['"]\.\/autopilot['"]/.test(code(f)) && /\b(pilot|openSky|stand|away|playedFor)\s*\(/.test(code(f)));
    expect(users.length, 'отчётов, идущих через дверь').toBeGreaterThan(5);
  });

  it('игра пульсует той же дверью: world/store зовёт tribePulse и частей пульса не берёт', () => {
    const store = code(path.join(ROOT, 'src/world/store.ts'));
    expect(store, 'store зовёт tribePulse').toMatch(/\btribePulse\s*\(/);
    expect(stepsTaken(store).filter((s) => !s.endsWith(':tribePulse')), 'части пульса в сторе').toEqual([]);
  });
});

describe('полководец бьёт логово только полной дружиной', () => {
  // Слово владельца (docs/battle_eu4.md, 14.31): автопилот — модель разумного игрока; уставшую дружину он не посылает,
  // перехват — не ждёт. Правило одно (`readyToStrike`), и каждый цикл удара в приборах спрашивает его перед ударом.
  const general = (rest?: FigureView['rest']): FigureView => ({ id: 'general', ...(rest ? { rest } : {}) }) as FigureView;

  it('полная — бьёт, уставшая — нет', () => {
    expect(readyToStrike(general())).toBe(true);
    expect(readyToStrike(general({ share: 0.99, fullAt: 1 }))).toBe(false);
  });

  it('каждый цикл, где прибор выбирает, когда ударить по логову, спрашивает правило перед ударом', () => {
    const strip = (code: string): string => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    // Циклы игрока: лазарет (`raid-hiring`), служба агентов (`time`), логова (`lair`), набеги по дворам (`sack`). Замеры
    // в названную минуту (`sack`: удар через минуту и через час после первого) правилом не охраняются — они мерят
    // грабёж в эту минуту, и ждать им нельзя.
    for (const [file, loops] of [
      ['raid-infirmary.ts', 1],
      ['time-report.ts', 1],
      ['lair-report.ts', 1],
      ['sack-report.ts', 1],
    ] as const) {
      const src = strip(readFileSync(path.join(ROOT, 'scripts', file), 'utf8'));
      expect(src.match(/readyToStrike\(/g)?.length ?? 0, `${file}: удар — только полной дружиной`).toBe(loops);
    }
  });
});

describe('посёлок мерки подчиняется гейту', () => {
  /**
   * Мерке ставят жильё, войско и склад прямо, минуя стройку и найм. С гейтом это значит,
   * что она обязана быть **сыгранной** партией, а не новой: у новой место лазутчика
   * закрыто второй ступенью дипломатической ветви, и отчёты мерили бы деревню, которой в
   * игре не бывает (решение владельца 12).
   *
   * Область правила — гейтованное место: у разведчика, дипломата и полководца гейта нет,
   * и на них эта проверка зелёная при любом коде.
   */
  it('у посёлка мерки места агентов есть, а ступень ему засчитана дверью', () => {
    const fresh = createInitialState(7);
    expect(placeOpen(fresh, 'spy'), 'точка внутри области: у новой партии место закрыто').toBe(false);

    const town = townAt(5);
    for (const id of FIGURE_IDS) expect(town.agents[id].vacant, `${id}: человек на месте`).toBe(false);
    expect(techLevel(town, 'diplo'), 'ступень засчитана, а не подарена сверх пройденного').toBe(diploLevelOf('spy'));
    expect(placeOpen(town, 'spy')).toBe(true);
  });

  it('дверь засчитывания одна: та же, что у ступени сохранения', () => {
    const g = createInitialState(7);
    expect(techLevel(played(g), 'diplo')).toBe(diploLevelOf('spy'));
  });
});

describe('автопилот один: прогоном', () => {
  afterEach(() => setTimeScale());

  // Область правила: шкала отлична от единицы (при единице перевод неотличим от его отсутствия),
  // и пульс короче шага племени в игровых секундах — остаток обязан перейти следующему пульсу.
  // Срок прогона — игровое время: племя проживает ровно его, а мир за это время бьётся пульсом по
  // настоящим секундам — в шкалу раз чаще, чем прожито игровых.
  it('пульс мира — настоящие секунды, срок прогона — игровые: перевод у двери времени', async () => {
    setTimeScale(30);
    expect(timeScale(), 'точка внутри области: шкала отлична от единицы').not.toBe(1);
    const g = createInitialState(7);
    g.tutorialDone = true;
    g.nextEventAt = Infinity;
    const t0 = g.time;
    const flown = await pilot({
      g,
      seconds: 20,
      player: player(null, { staff: false, build: false }),
      world: { seed: 7, pulse: 60, raids: false },
      economy: 'live',
      tick: 3,
      decide: 15,
    });
    expect(60 / 30, 'точка внутри области: пульс короче шага племени').toBeLessThan(3);
    // Пульс — две игровые секунды, шаг — три: остаток переходит следующему пульсу, и за десять пульсов
    // племя делает шесть шагов, а не ноль и не десять.
    expect(g.time - t0, 'двадцать игровых секунд срока — шесть шагов по три').toBe(18);
    expect(flown.cost.ticks, 'шагов племени — по игровым секундам, а не по настоящим').toBe(6);
    // Десять настоящих минут мира при пульсе в минуту — десять пульсов и первый, открывающий мир.
    expect(flown.cost.pulses, 'пульсов мира — по настоящим секундам').toBe((20 * 30) / 60 + 1);
  });

  // Область правила: новая партия, у которой веры ещё нет, и прогон, в котором весть приходит
  // (сутки настоящего времени против сетки в восемь часов). Обе точки проверяются утверждением: без них «вера пришла» и «событие
  // разобрано» проходили бы даром.
  it('игрок отвечает на события и берёт веру, которую называет мир', async () => {
    const g = createInitialState(7);
    g.tutorialDone = true;
    expect(g.faith.id, 'точка внутри области: у новой партии веры ещё нет').toBeNull();
    const raised = new Set<string>();
    let open = 0;
    const flown = await pilot({
      g,
      // Вести приходят по сетке настоящих часов (шаг 8 ч): сутки прогона — три прихода.
      seconds: 24 * 3600,
      player: player(null),
      world: { seed: 7, pulse: 30, raids: false },
      economy: 'live',
      tick: 30,
      decide: 30,
      watch: {
        after: ({ g: x }) => {
          for (const e of x.inbox) if (e.defId !== MUTINY_EVENT) raised.add(eventId(e));
        },
        decided: (x) => {
          open += x.inbox.filter((e) => e.defId !== MUTINY_EVENT).length;
        },
      },
    });
    expect(raised.size, 'точка внутри области: события поднимались').toBeGreaterThan(0);
    expect(open, 'событие висит после решения игрока').toBe(0);
    // Пришедшее после последнего решения ещё ждёт на столе — его разберут следующим решением.
    const waiting = g.inbox.filter((e) => e.defId !== MUTINY_EVENT).length;
    expect(flown.ledger.answered + waiting, 'игрок разобрал поднявшиеся события').toBeGreaterThanOrEqual(raised.size);
    const home = (flown.world as Inside).save.home;
    expect(g.faith.id, 'вера пришла пульсом — та, что под замком').toBe(faithAt(home.x, home.y));
  });
});

describe('военный гейт в приборе', () => {
  /**
   * Мерке ставят войско прямо, минуя найм, — значит ступень военной ветви ей обязана быть
   * засчитана той же дверью, что и сохранению. Иначе прибор мерил бы деревню, которой в
   * игре не бывает: с латниками в строю и кузницей, которая доспеха не знает.
   *
   * Область правила названа: состав мерки и правда носит самую дорогую вещь.
   */
  it('посёлку мерки военная ветвь засчитана по тому войску, которое в нём стоит', () => {
    const top = Math.max(...(Object.keys(MIX) as TroopId[]).map((t) => warLevelOfTroop(t)));
    expect(top, 'точка внутри области: мерка носит не только копьё').toBeGreaterThan(warLevelOfGear('spear'));

    const town = townAt(5);
    expect(techLevel(town, 'war'), 'ступень засчитана ровно по мерке').toBe(top);
    for (const t of Object.keys(MIX) as TroopId[]) {
      expect(troopOpen(town, t), `${t}: вид мерки нанимается`).toBe(true);
    }
    // И ни ступенью выше: даром ветвь мерке не проходится.
    expect(techLevel(town, 'war')).toBeLessThan(levelsOf('war'));
  });

  /**
   * Состав найма под гейтом: закрытый вид выпадает, его доля уходит виду, открытому без ступени
   * (`FLOOR_TROOPS`), и целевое число не меняется — игрок тратит те же деньги на то, что у него
   * есть (решение владельца, docs/hiring.md, раздел 15). Три точки, каждая внутри своей области: на
   * первом уровне закрыт каждый вид мерки, на уровне лука — часть, на изученной ветви — ни один.
   * Мутация «закрытая доля пропадает» (прежнее правило прибора) роняет «на первом уровне вся доля
   * мерки — полу ветви».
   */
  it('закрытый вид выпадает, его доля уходит полу ветви, а целевое число то же', () => {
    expect(FLOOR_TROOPS, 'пол ветви выводится из снаряжения: без ступени открыты дубинщики').toEqual(['clubman']);
    const fresh = createInitialState(7);
    expect(techLevel(fresh, 'war'), 'точка внутри области: новая партия на первом уровне').toBe(1);
    expect((Object.keys(MIX) as TroopId[]).filter((t) => troopOpen(fresh, t)), 'из мерки не открыт ни один вид').toEqual([]);
    expect(openMix(fresh, MIX), 'на первом уровне вся доля мерки — полу ветви').toEqual({ clubman: sum(Object.values(MIX).map((n) => n ?? 0)) });

    const town = townAt(5);
    const open = openMix(town, MIX);
    expect(Object.keys(open), 'ветвь засчитана — состав тот же, и ключи в том же порядке').toEqual(Object.keys(MIX));
    expect(stackOf(100, open), 'и разложение то же до бойца').toEqual(stackOf(100, MIX));

    // Между ними: на уровне лука открыты копейщики и лучники, остальное — полу ветви.
    const half = createInitialState(7);
    half.realm.tech.war = warLevelOfGear('bow');
    const part = openMix(half, MIX);
    expect(Object.keys(part), 'открыты те, чьи вещи изучены, и пол ветви').toEqual(['spearman', 'archer', 'clubman']);
    expect(part.clubman, 'полу ветви — доля закрытых').toBe((MIX.legionary ?? 0) + (MIX.rider ?? 0));
    const split = stackOf(100, part);
    expect(sum(Object.values(split).map((n) => n ?? 0)), 'целевое число не потерялось').toBe(100);
  });

  /**
   * Игрок автопилота учится сам: ступень, на которую хватило очков, он покупает в том же
   * заходе. Без этого прибор мерил бы игрока, который ни разу не открыл «Технологии», —
   * а такой игрок в отчёте есть, и он стоит отдельной строкой.
   */
  it('игрок автопилота изучает ступень, как только хватает очков', async () => {
    const g = createInitialState(7);
    g.tutorialDone = true;
    expect(techLevel(g, 'war'), 'точка внутри области: начинает с первого уровня').toBe(1);
    expect(pointsOf(g, 'war'), 'и очков ровно на первую покупку').toBe(levelPrice('war', 2));

    await pilot({
      g,
      seconds: 120,
      player: player(null),
      world: { seed: 7, pulse: 30, raids: false },
      economy: 'live',
      tick: 1,
      decide: 30,
    });
    expect(techLevel(g, 'war'), 'ступень куплена на первом же решении').toBeGreaterThan(1);
    expect(troopOpen(g, 'spearman'), 'и копейщики открылись').toBe(true);

    // А игрок, который «Технологии» не открывает, остаётся на первом уровне.
    const idle = createInitialState(7);
    idle.tutorialDone = true;
    await pilot({
      g: idle,
      seconds: 120,
      player: player(null, { study: false }),
      world: { seed: 7, pulse: 30, raids: false },
      economy: 'live',
      tick: 1,
      decide: 30,
    });
    expect(techLevel(idle, 'war'), 'не учится — не открывается').toBe(1);
  });
});

describe('найм того, кто строит, в приборе', () => {
  /**
   * Прибор не спорит сам с собой: расстановка держит пятую часть племени свободной под стройку
   * (`spareHands`), и найм её не забирает — **при любом поведении**. Забирал — и получалась петля, а
   * не игрок: найм выгребал запас на каждом решении, расстановка тут же снимала с работ новый,
   * пропорционально убывшему племени, и деревня новой партии съедала себя — у «всё, что прокормит»
   * к шестому часу до пяти человек (docs/hiring.md, раздел 14), у «по средствам» с дешёвыми
   * дубинщиками до тринадцати (раздел 15). Решение владельца: запас берегут все, кто строит.
   *
   * Точек две — по поведению, и область названа у каждой: найм был, и упирался он в руки — иначе
   * правило «не из запаса» не спрашивалось бы ни разу и тест был бы зелёным при любом коде. «По
   * средствам» взят с дубинщиками и без технологий: казна их не держит, и до рук дело доходит.
   * Мутация «нанимать из всех свободных» роняет «после найма запас цел» у обоих; мутация «запас —
   * только у «всё, что прокормит»», как было, — у «по средствам».
   */
  const builders: [string, ReturnType<typeof player>][] = [
    ['всё, что прокормит', player('feed', { tax: 'moderate' })],
    ['по средствам, дубинщики', player('means', { tax: 'high', study: false })],
  ];
  for (const [name, who] of builders) {
    it(`найм не забирает запас рук, который прибор держит под стройку: ${name}`, async () => {
      const g = createInitialState(7);
      g.tutorialDone = true;
      let hired = 0;
      let decisions = 0;
      let handsBound = 0;
      await pilot({
        g,
        seconds: 600,
        player: who,
        world: { seed: 7, pulse: 30, raids: false },
        economy: 'live',
        tick: 1,
        decide: 30,
        watch: {
          decided: (s, l) => {
            if (l.hired > hired) {
              decisions++;
              expect(idleCount(s), `${name}: после найма запас цел, ${s.time} с`).toBeGreaterThanOrEqual(spareHands(s));
            }
            hired = l.hired;
            handsBound = l.stops['руки'] ?? 0;
          },
        },
      });
      expect(decisions, `${name}: точка внутри области — найм был`).toBeGreaterThan(0);
      expect(handsBound, `${name}: и упирался он в руки — правило спрашивалось`).toBeGreaterThan(0);
    });
  }

  /**
   * Запас — под стройку, и держит его только тот, кто строит. Посёлок мерки, где уровни стоят,
   * не строит ничего, и там «всё, что прокормит» нанимает из всех свободных рук, как прежде:
   * запас, который ничего не держит, превратил бы поведение в найм по капле (замер раздела А
   * `raid-hiring:report` на 6f04e5f, где запас берёгся всегда: прорывов у стены на 7-м уровне
   * 74 % против 0 % до правки). Мутация «беречь запас всегда» роняет «не строит — запас не
   * бережёт».
   */
  it('кто не строит, запаса не держит: найм берёт все свободные руки', async () => {
    const g = createInitialState(7);
    g.tutorialDone = true;
    let below = 0;
    let hired = 0;
    await pilot({
      g,
      seconds: 600,
      player: player('feed', { tax: 'moderate', build: false }),
      world: { seed: 7, pulse: 30, raids: false },
      economy: 'live',
      tick: 1,
      decide: 30,
      watch: {
        decided: (s, l) => {
          if (l.hired > hired && idleCount(s) < spareHands(s)) below++;
          hired = l.hired;
        },
      },
    });
    expect(hired, 'точка внутри области: найм был').toBeGreaterThan(0);
    expect(below, 'не строит — запас не бережёт').toBeGreaterThan(0);
  });

  /**
   * Запас — того племени, каким оно станет после найма (`hands`). Найм оставляет свободными ровно
   * запас нового племени: ни рукой меньше — то была бы рука строителя, — ни рукой больше: её отдало
   * бы в войско следующее решение, и сколько войску достаётся за раз, решала бы частота решений
   * (docs/hiring.md, раздел 16). Область — племена до тысячи и все доли свободных; точки, где найм
   * вообще возможен, считаются и обязаны быть. Мутация «запас нынешнего племени» роняет «ни рукой
   * больше запаса».
   */
  it('найм строящего оставляет свободными ровно запас племени после найма', () => {
    let asked = 0;
    for (let pop = 2; pop <= 1000; pop += 7) {
      for (let idle = 0; idle <= pop; idle += Math.max(1, Math.floor(pop / 13))) {
        const g = createInitialState(7);
        g.pop = pop;
        g.workers = {};
        g.bondedWork = {};
        g.freeJobs = { [FREE_JOBS[0]]: pop - idle };
        expect(idleCount(g), 'свободных столько, сколько задано').toBe(idle);
        expect(hands(g, false), 'кто не строит — отдаёт все свободные руки').toBe(idle);
        const n = hands(g, true);
        if (n > 0) {
          asked++;
          expect(idle - n, `племя ${pop}, свободных ${idle}: после найма запас цел`).toBeGreaterThanOrEqual(spareOf(pop - n));
        }
        if (n < idle) expect(idle - (n + 1), `племя ${pop}, свободных ${idle}: ни рукой больше запаса`).toBeLessThan(spareOf(pop - n - 1));
      }
    }
    expect(asked, 'точки внутри области: найм был возможен').toBeGreaterThan(100);
  });

  /**
   * Исход не зависит от того, как часто прибор решает. У того, кто строит и нанимает, войско — из
   * новорождённых: их первым встречает найм, а не расстановка (`decide`). Прежде расстановка шла
   * первой: при частых решениях новорождённые уходили в войско все, при редких часть успевала на
   * работы, и пол ветви кончал партию на 115 и на 707 жителях при решениях раз в полдня и раз в
   * полтора дня (docs/hiring.md, раздел 16).
   *
   * Область: пол ветви — дубинщики при высоком налоге: казна их не держит, найм упирается в руки,
   * и делёж новорождённых решает всё; новорождённые были. Мутация «расстановка первой» роняет
   * «племя то же».
   */
  it('войско из новорождённых одно и то же при любой частоте решений', async () => {
    const at: Record<number, { pop: number; hired: number; born: number; hands: number; decisions: number }> = {};
    for (const decide of [30, 90]) {
      const g = createInitialState(7);
      g.tutorialDone = true;
      const f = await pilot({
        g,
        seconds: 3600,
        player: player('means', { tax: 'high', study: false }),
        world: { seed: 7, pulse: 30, raids: false },
        economy: 'live',
        tick: 1,
        decide,
      });
      const stops = Object.values(f.ledger.stops).reduce((a, v) => a + (v ?? 0), 0);
      at[decide] = { pop: g.pop, hired: f.ledger.hired, born: g.stats.born, hands: f.ledger.stops['руки'] ?? 0, decisions: stops };
    }
    for (const d of [30, 90]) {
      expect(at[d].born, `раз в ${d} с: точка внутри области — новорождённые были`).toBeGreaterThan(30);
      expect(at[d].hands / at[d].decisions, `раз в ${d} с: и найм упирался в руки, а не в казну`).toBeGreaterThan(0.8);
    }
    expect(Math.abs(at[30].pop - at[90].pop), `племя то же: ${at[30].pop} и ${at[90].pop}`).toBeLessThanOrEqual(10);
    expect(Math.abs(at[30].hired - at[90].hired), `и войску досталось то же: ${at[30].hired} и ${at[90].hired}`).toBeLessThanOrEqual(10);
  });
});

describe('наёмные мастера в приборе', () => {
  /**
   * Ручка «вложился в админветвь» берёт мастеров тем же правилом «по средствам», что и войско:
   * ведомость после найма не больше дохода казны, и найм встаёт ровно там, где следующий мастер
   * её перевесил бы. Область: места и ступень ветви пускают больше, чем тянет казна, — иначе
   * останавливали бы места, а не правило.
   */
  it('мастера по средствам: ведомость не больше дохода, и встаёт найм ровно на границе', () => {
    const g = createInitialState(7);
    g.tutorialDone = true;
    g.tax = 'high';
    g.pop = 400;
    g.buildings.find((b) => b.type === MASTERS_AT)!.level = 10;
    g.realm.tech.admin = ADMIN_LEVELS;
    // Войско съедает казну так, что на мастеров остаётся меньше, чем мест. Боец платит налог как
    // житель — доход растёт вместе с войском, — поэтому войско подбирается шагом, а не формулой.
    const fitOf = (): number => Math.floor((taxIncomePerDay(g) - wagesPerDay(g)) / masterWage(g));
    while (fitOf() >= 30) g.army.spearman += 5;
    const room = mastersInfo(g).room;
    const fit = fitOf();
    expect(fit, 'точка внутри области: казна тянет хоть кого-то').toBeGreaterThan(0);
    expect(room, 'и мест больше, чем тянет казна').toBeGreaterThan(fit);
    hireMastersByMeans(g);
    expect(mastersCount(g), 'взято ровно столько, сколько тянет казна').toBe(fit);
    expect(wagesPerDay(g), 'ведомость не больше дохода').toBeLessThanOrEqual(taxIncomePerDay(g));
    expect(wagesPerDay(g) + masterWage(g), 'следующий мастер её перевесил бы').toBeGreaterThan(taxIncomePerDay(g));
  });
});
