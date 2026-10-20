// Монотонность у ворот (слово владельца по П0 пересмотра баланса, docs/battle_eu4.md, 14.35): больше волков против того
// же гарнизона без кости берут верх не реже. `raid-mix:report`, раздел 4б, нашёл обратное с костью — на 1–3-м уровнях
// доля поражений пересекает половину по силе стаи много раз; без кости это видно боем на каждую голову стаи.
//
// КРАСНЫЙ при записи, честно (29.09.2026): 77 сбоев на 1-м уровне, 69 на 2-м, 16 на 3-м — все при нечётной стае
// (`raid-mix:report`, 4б). Нечётный волк встаёт из резерва в центр, его выбивают, и центр гарнизона, «очищенный в бою»,
// уходит в обход на волков (`sim.relocate`; docs/battle_eu4.md, 14.35). Чинит правило охвата без истории — следующий шаг
// этой работы (слово владельца, 14.35, пункт 1).
//
// Фазы EU4 (пересмотр баланса, шаг 2, 14.35) нашли ещё один сбой — 238 волков на 2-м уровне против 237. Нечётный волк
// ждал в резерве, а резерв считал местом всю ширину ряда и на первом тике ставил его одного в пустой центр: стрелы
// гарнизона тратили на него тик, край стаи сохранял мораль, и в тике, где ломались обе стороны, слом решал ещё и порядок
// счёта в пользу обороны. Чинят два правила ядра: резерв встаёт только на места, которые сторона держала
// (`sim.refill`, `SideState.held`), и кто сломан, читается на начало тика (`sim.updateMorale`).
//
// Гарнизон — мерка автопилота отчётов (`townAt`, войско `armyAt`), всё дома, без веры: так строит таблицу силы у ворот
// сам отчёт. Бой — дверью мира, как в игре: кто пришёл (`gateParty`, мощь — две на волка, `menOfPower`) и бой у своих
// ворот (`gateField`).
import { describe, expect, it } from 'vitest';
import { withDiceStep } from '@/battle/bench';
import { stackTotal } from '@/battle/setup';
import { FRONT_WIDTH } from '@/battle/config';
import { kindsOf } from '@/game/battle/price';
import { militiaArchers, militiaMen } from './bridge';
import { defense } from '@/game/derived';
import { BATTLE_MAN } from '@/game/battle/kinds';
import { TROOP_IDS } from '@/game/data/troops';
import type { GameState } from '@/game/types';
import { menOfPower } from './garrison';
import type { GateCall } from './types';
import { openSky, townAt, type Inside } from '../../scripts/autopilot';

/** Кривая — до трёх оборон посёлка, как кривая раздела 4б `raid-mix:report`. */
const TOP_DEFENSE = 3;

/**
 * Известные сбои ядра на W 95 — находка слияния Р-1…Р-5 и ДП-1 (docs/siege_v2.md, 22.2; решение владельца 20.10.2026: как
 * 19.4 — записать, ядро — отдельной работой). Оба — чётность остатка, без кости. На 3-м уровне нечётный волк ждёт в резерве, и
 * нечётные стаи 333 и 335 отбиты там, где чётные 332, 334 и 336 берут верх (бой 88–89 тиков против 76). На 2-м уровне один
 * пеший сверх (дубинщик, копейщик) делает остаток развёртывания гарнизона нечётным, и он уходит в резерв (R 1 → 2) при краях
 * по 54 человека, — гарнизон держит 235 волков вместо 239. На W 97 этих точек не было. Список точный: новый сбой и починка
 * ядра роняют тест, и список тогда переписывается или уходит; у другого W он пуст.
 */
const KNOWN_DROPS: Partial<Record<number, number[]>> = FRONT_WIDTH === 95 ? { 3: [333, 335] } : {};
const KNOWN_LESS: Partial<Record<string, number>> = FRONT_WIDTH === 95 ? { '2/clubman': -4, '2/spearman': -4 } : {};

describe('монотонность у ворот: больше волков против того же гарнизона — не реже их верх', () => {
  it.each([1, 2, 3])('без кости: гарнизон мерки %i-го уровня, стая от одного волка до трёх оборон', async (level) => {
    const g = townAt(level);
    g.faith.id = null;
    const sky = openSky(g, { seed: 7, pulse: 30, raids: true });
    await sky.pulse();
    const w: Inside = sky.world;
    const at = sky.now();
    const top = menOfPower(TOP_DEFENSE * defense(g));
    const won: boolean[] = [];
    withDiceStep(0, () => {
      for (let n = 1; n <= top; n += 1) {
        const call: GateCall = { id: `mono${n}`, foe: 'wolves', power: n * BATTLE_MAN, seed: 7919 };
        const party = w.gateParty(call);
        // Граница области: дверь правда ставит `n` волков — иначе шаг кривой был бы не на голову.
        expect(party.kinds.cavalry, `мощь ${call.power}`).toBe(n);
        won[n] = w.gateField(party, call.seed, w.save.home, at).field.won;
      }
    });
    // Граница области: на кривой есть и поражения волков, и их верх — иначе «не реже» проверялось бы даром.
    expect(won.includes(false), 'волки хоть раз отбиты').toBe(true);
    expect(won.includes(true), 'волки хоть раз взяли верх').toBe(true);
    const drops = won.flatMap((x, n) => (n > 1 && won[n - 1] && !x ? [n] : []));
    expect(drops, `${level}-й уровень: волков больше на одного — и верх уже не их`).toEqual(KNOWN_DROPS[level] ?? []);
  }, 120_000);
});

// Один боец у ворот (docs/battle_eu4.md, 14.35, «Всадник у ворот»; слово владельца — охват по излишку ширины). Прежде полосу
// занимало присутствие, а не число: один всадник гарнизона, вставший на край, держал всю стаю на краю, а центр гарнизона
// уходил в обход — и мерка 1-го уровня без всадников с одним всадником держала без кости 146 волков вместо 80
// (`raid-mix:report`, раздел 4в, на `0636bd0`). Теперь горстка держит столько, сколько занимает, а излишок идёт в охват
// (`sim.relocate`). Мерка скачка — доля владельца «+10 %»: один боец — от одного до пяти с половиной бойцов строя
// (`price.battleWeight`) при гарнизоне 145…339 (раздел 4в), и двигать стаю, которую гарнизон держит, больше чем на её десятую
// часть он не должен; и не должен её уменьшать — больше того же не хуже.
//
// Бой без кости — от сида он не зависит (кость — единственная случайность боя), поэтому это не один бой, а ожидание.
describe('один боец у ворот не двигает выдерживаемую стаю скачком', () => {
  /** Первая стая, что берёт верх над гарнизоном, без кости; с какой начать — не больше неё (граница области ниже). */
  const firstWin = async (g: GameState, from: number): Promise<{ first: number; low: boolean; men: number; edges: number }> => {
    const sky = openSky(g, { seed: 7, pulse: 30, raids: true });
    await sky.pulse();
    const w: Inside = sky.world;
    const at = sky.now();
    let first = -1;
    let low = false;
    let men = 0;
    let edges = 0;
    withDiceStep(0, () => {
      for (let n = from; n <= 4000; n += 1) {
        const call: GateCall = { id: 'one', foe: 'wolves', power: n * BATTLE_MAN, seed: 7919 };
        const r = w.gateField(w.gateParty(call), call.seed, w.save.home, at).field;
        if (n === from) {
          low = !r.won;
          men = stackTotal(r.result.sides.defender.initial);
          const s = r.result.sides.defender.sectors;
          edges = stackTotal(s.A.initial) + stackTotal(s.C.initial);
        }
        if (r.won) {
          first = n;
          break;
        }
      }
    });
    return { first, low, men, edges };
  };

  it.each([1, 2])('мерка %i-го уровня — как есть и без всадников: +1 боец любого вида', async (level) => {
    for (const bare of [false, true]) {
      const town = (): GameState => {
        const g = townAt(level);
        g.faith.id = null;
        if (bare) g.army.rider = 0;
        // Граница области 1-го уровня без всадников — края пусты и остаются пустыми с одним пешим сверх: пешие у ворот
        // (гарнизон и ополчение без стрелков, `fights.defenceKinds`) помещаются в ширину фронта с запасом на самого тяжёлого
        // бойца. При W 128 мерка помещалась как есть (114 пеших, запас 14); при W 94 (полная приёмка осады, docs/siege_v2.md,
        // 19.4) — нет: лишние легионеры уходят, пока пешие не поместятся. Пешие ровно в ширину, когда +1 выпирает на край, —
        // другая точка (находка 19.4: там «+1 щитоносец» держит на волка меньше).
        const walkers = (): number => kindsOf(g.army).spear + kindsOf(g.army).infantry + militiaMen(g) - militiaArchers(g);
        const heaviest = Math.max(...TROOP_IDS.map((id) => stackTotal(kindsOf({ [id]: 1 }))));
        if (bare && level === 1) while ((g.army.legionary ?? 0) > 0 && walkers() + heaviest > FRONT_WIDTH) g.army.legionary -= 1;
        return g;
      };
      const base = await firstWin(town(), 1);
      // Граница области: гарнизон держит стаю, и её правда берут — иначе «держит» не мерилось бы.
      expect(base.first, `${level}-й уровень${bare ? ' без всадников' : ''}: стаю берут`).toBeGreaterThan(1);
      // Граница области: на 1-м уровне без всадников края гарнизона пусты, и всадник встаёт на край один — случай, из-за
      // которого правило меняли. На 2-м пеших шире ширины фронта, и на краях стоят они сами — горсткой (второй облик того же:
      // до правила горстка на краях держала стаю — мерка 2-го уровня без всадников держала 206 волков, теперь 133, раздел 4в).
      if (bare && level === 1) expect(base.edges, `${level}-й уровень без всадников: на краях гарнизона пусто`).toBe(0);
      const held = base.first - 1;
      for (const id of TROOP_IDS) {
        const g = town();
        g.army[id] = (g.army[id] ?? 0) + 1;
        const one = await firstWin(g, Math.floor(held / 2));
        // Граница области: боец правда вошёл в бой, и счёт начался ниже того, что гарнизон держит.
        expect(one.men, `${id}: боец в бою`).toBeGreaterThan(base.men);
        expect(one.low, `${id}: половину стаи гарнизон держит`).toBe(true);
        if (bare && (id === 'rider' || id === 'knight')) {
          // Граница области: одинокий всадник встал на край — ровно тот случай, из-за которого правило и меняли.
          expect(one.edges, `${id}: всадник на краях гарнизона`).toBeGreaterThan(0);
        }
        const moved = one.first - base.first;
        const known = bare ? undefined : KNOWN_LESS[`${level}/${id}`];
        if (known !== undefined) expect(moved, `${level}-й уровень, +1 ${id}: известный сбой ядра на W ${FRONT_WIDTH}`).toBe(known);
        else expect(moved, `${level}-й уровень${bare ? ' без всадников' : ''}, +1 ${id}: стая меньше`).toBeGreaterThanOrEqual(0);
        expect(moved, `${level}-й уровень${bare ? ' без всадников' : ''}, +1 ${id}: держит ${held}, с ним — ${one.first - 1}`).toBeLessThanOrEqual(held / 10);
      }
    }
  }, 180_000);
});
