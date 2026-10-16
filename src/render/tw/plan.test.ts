// Режиссура ролика TW: один `k` на обе стороны, потолки уровней, строй, сшибка на линии, гибель по журналу,
// детерминизм (docs/battle_tw.md, разделы 2–4).
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { QUALITIES, type Quality } from '../quality';
import { STAND_GROUND, standBattle } from '../battle-stand';
import { GROUND_CROSSING, GROUND_LAND, GROUND_RIDGE } from '@/world/place';
import { twPlanOfRecord } from './record';
import { TW_SPEC } from '../reel/spec';
import { FRONT_WIDTH, UNIT_STATS } from '@/battle/config';
import {
  CONTACT_HALF,
  FORM,
  CHASE_SECONDS,
  GALLOP_SPEED,
  WAVER_SECONDS,
  advanceOf,
  pushOf,
  aliveFigures,
  poseFigures,
  ratioOf,
  unitPose,
  type TwPlan,
} from './plan';
import { bearerOf, figureFrame } from '../reel/troupe';
import { MAX_SECONDS, MIN_SECONDS } from '../reel/clock';

/** Число людей боя, записанное при W 128, — в той же глубине строя при нынешнем W. */
const atW = (men: number): number => Math.round((men * FRONT_WIDTH) / 128);

const planOf = (query: string, quality: Quality = 'medium'): TwPlan => {
  const b = standBattle(new URLSearchParams(query));
  return twPlanOfRecord(b.result, b.us, b.troops, quality, undefined, b.place, b.beastSide);
};

describe('ролик TW: сколько фигур', () => {
  it('k один на обе стороны: соотношение сил видно глазами', () => {
    // 500 против 20: фигур у сторон столько же раз меньше, во сколько раз меньше бойцов.
    const p = planOf('replay=tw&men=500&foe=20&seed=3', 'low');
    expect(p.k).toBe(ratioOf(p.cast.men.attacker, p.cast.men.defender, TW_SPEC.low.perSide));
    const ratioMen = p.cast.men.attacker / p.cast.men.defender;
    const ratioFig = p.sideFigures.attacker / p.sideFigures.defender;
    expect(Math.abs(ratioFig - ratioMen) / ratioMen).toBeLessThan(0.2);
  });

  it('ни одна сторона не стоит больше потолка уровня, и фигуры отрядов сходятся со стороной', () => {
    for (const q of QUALITIES) {
      for (const size of [30, 300, 1500, 5000]) {
        const p = planOf(`replay=tw&men=${size}&foe=${Math.round(size * 0.8)}&seed=5`, q);
        for (const side of ['attacker', 'defender'] as const) {
          expect(p.sideFigures[side]).toBeLessThanOrEqual(TW_SPEC[q].perSide);
          const sum = p.units.filter((u) => u.side === side && u.row !== 'general').reduce((n, u) => n + u.figures, 0);
          expect(sum).toBe(p.sideFigures[side]);
        }
        // Меньшая армия не нарезается мельче нужного: k — наименьшее, при котором большая влезает в потолок.
        if (p.k > 1) expect(Math.max(p.cast.men.attacker, p.cast.men.defender) / (p.k - 1)).toBeGreaterThan(TW_SPEC[q].perSide);
      }
    }
  });

  it('низкий уровень ставит меньше фигур, чем средний, средний — меньше высокого', () => {
    const n = (q: Quality): number => planOf('replay=tw&men=2000&foe=2000&seed=2', q).figures;
    expect(n('low')).toBeLessThan(n('medium'));
    expect(n('medium')).toBeLessThan(n('high'));
  });

  it('отряд не больше потолка рода: больше — соседний со своим знаменем', () => {
    const p = planOf('replay=tw&men=3000&foe=3000&seed=1', 'high');
    for (const u of p.units) expect(u.figures).toBeLessThanOrEqual(FORM[u.form].cap);
  });
});

describe('ролик TW: строй и место', () => {
  it('отряды одной стороны на построении не налезают друг на друга', () => {
    for (const q of QUALITIES) {
      const p = planOf('replay=tw&men=900&foe=700&seed=4', q);
      const box = (u: TwPlan['units'][number]) => {
        const back = u.ours ? -1 : 1;
        const z1 = u.z;
        const z2 = u.z + back * u.depth;
        return { x0: u.x - u.width / 2, x1: u.x + u.width / 2, z0: Math.min(z1, z2) - 0.3, z1: Math.max(z1, z2) + 0.3 };
      };
      const list = p.units.filter((u) => u.row !== 'general');
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          if (list[i].side !== list[j].side) continue;
          const a = box(list[i]);
          const b = box(list[j]);
          const overlap = a.x0 < b.x1 - 0.01 && b.x0 < a.x1 - 0.01 && a.z0 < b.z1 && b.z0 < a.z1;
          expect(overlap, `${list[i].sector}/${list[i].face} и ${list[j].sector}/${list[j].face}`).toBe(false);
        }
      }
    }
  });

  it('наши смотрят на +Z и стоят на −Z, чужие — наоборот; конница на краю своей полосы', () => {
    const p = planOf('replay=tw&men=600&foe=600&seed=9');
    for (const u of p.units) {
      if (u.row === 'general') continue;
      expect(Math.sign(u.z)).toBe(u.ours ? -1 : 1);
      expect(u.yaw).toBe(u.ours ? 0 : Math.PI);
    }
    // Наша левая полоса (A) — у +X: камера стоит за нами и смотрит на +Z, левый край экрана — +X.
    const a = p.units.filter((u) => u.ours && u.sector === 'A');
    const c = p.units.filter((u) => u.ours && u.sector === 'C');
    if (a.length && c.length) expect(Math.min(...a.map((u) => u.x))).toBeGreaterThan(Math.max(...c.map((u) => u.x)));
  });

  it('к сшибке передняя шеренга первой линии стоит на линии соприкосновения', () => {
    const p = planOf('replay=tw&men=400&foe=400&seed=7');
    for (const side of ['attacker', 'defender'] as const) {
      const a = advanceOf(p, side, p.clashAt);
      expect(Math.abs(Math.abs(p.deployZ[side]) - a.dist)).toBeCloseTo(CONTACT_HALF, 5);
    }
    for (const u of p.units.filter((x) => x.row === 'front' && x.fleeAt === null)) {
      const pose = unitPose(p, u, p.clashAt + 0.01);
      expect(Math.abs(pose.z)).toBeCloseTo(CONTACT_HALF, 1);
    }
  });

  it('до начала сближения строй стоит, на сближении идёт вперёд и не обгоняет линию', () => {
    const p = planOf('replay=tw&men=400&foe=400&seed=7');
    for (const side of ['attacker', 'defender'] as const) {
      let last = -1;
      for (let t = 0; t <= p.clashAt; t += 0.1) {
        const d = advanceOf(p, side, t).dist;
        expect(d).toBeGreaterThanOrEqual(last - 1e-9);
        last = d;
      }
    }
  });

  it('поле накрывает все отряды на построении', () => {
    const p = planOf('replay=tw&men=2500&foe=2500&seed=11', 'high');
    for (const u of p.units) {
      expect(Math.abs(u.x) + u.width / 2).toBeLessThan(p.field.halfX);
      expect(u.z).toBeGreaterThan(p.field.minZ);
      expect(u.z).toBeLessThan(p.field.maxZ);
    }
  });
});

describe('ролик TW: гибель и время', () => {
  it('павших фигур к концу столько, сколько бойцов потерял каждый род отряда, в долях k', () => {
    const p = planOf('replay=tw&men=500&foe=500&seed=6');
    let checked = 0;
    for (const u of p.units) {
      if (u.men <= 0) continue;
      for (const pt of u.parts) {
        let figs = 0;
        let dead = 0;
        for (let i = u.first; i < u.first + u.figures; i++) {
          if (p.faceIds[p.faceOf[i]].kind !== pt.kind) continue;
          figs++;
          if (p.deathAt[i] <= p.seconds) dead++;
        }
        expect(figs).toBe(pt.figures);
        expect(dead).toBe(Math.min(figs, Math.round((figs * (pt.men - pt.finalMen)) / pt.men)));
        if (pt.men > pt.finalMen) checked++;
      }
    }
    // Точки внутри области правила: в бою есть рода, которые теряли людей (правило 11).
    expect(checked).toBeGreaterThan(3);
  });

  it('павших только прибывает: живых фигур со временем не больше, чем было', () => {
    const p = planOf('replay=tw&men=300&foe=350&seed=8');
    for (const u of p.units) {
      let last = Infinity;
      for (let t = 0; t <= p.seconds; t += 0.5) {
        const n = aliveFigures(p, u, t);
        expect(n).toBeLessThanOrEqual(last);
        last = n;
      }
    }
  });

  it('ролик в поле — от 15 до 40 с', () => {
    for (const q of ['replay=tw&men=500&foe=500&seed=1', 'replay=tw&men=60&foe=60&seed=2', 'replay=tw&men=900&foe=40&seed=3']) {
      const s = planOf(q).seconds;
      expect(s).toBeLessThanOrEqual(MAX_SECONDS);
      expect(s).toBeGreaterThanOrEqual(MIN_SECONDS);
    }
  });

  it('тот же журнал — тот же ролик до фигуры', () => {
    const a = planOf('replay=tw&men=700&foe=650&seed=12&place=ford,woods&hour=17');
    const b = planOf('replay=tw&men=700&foe=650&seed=12&place=ford,woods&hour=17');
    const fa = figureFrame(a.figures);
    const fb = figureFrame(b.figures);
    for (const t of [0, 5, 13, 30, a.seconds]) {
      poseFigures(a, t, fa);
      poseFigures(b, t, fb);
      expect(Array.from(fa.x)).toEqual(Array.from(fb.x));
      expect(Array.from(fa.clip)).toEqual(Array.from(fb.clip));
      expect(Array.from(fa.time)).toEqual(Array.from(fb.time));
    }
  });

  it('стая — без знамён, люди — со знаменем у каждого отряда', () => {
    const p = planOf('replay=tw&beasts=1&men=60&foe=40&seed=7');
    for (const u of p.units) {
      if (u.face === 'wolf') expect(u.banner).toBeNull();
      else expect(u.banner).not.toBeNull();
    }
  });
});

describe('ролик TW: переправа', () => {
  it('стенд штрафует место нападающему числами мира: лес и холмы, гребень, переправа', () => {
    expect(STAND_GROUND.land).toBe(GROUND_LAND.hills);
    expect(STAND_GROUND.land).toBe(GROUND_LAND.forest);
    expect(STAND_GROUND.ridge).toBe(GROUND_RIDGE);
    expect(STAND_GROUND.crossing).toBe(GROUND_CROSSING);
  });

  it('штраф переправы ядра — река между линиями, нападающий её переходит и бьётся из воды', () => {
    const p = planOf('replay=tw&men=400&foe=400&seed=5&place=river,ford&hour=12');
    expect(p.crossing).toBe('attacker');
    const r = p.field.river!;
    expect(r.between).toBe(true);
    // Река — между построениями сторон, у линии соприкосновения со стороны нападающего.
    const a = p.deployZ.attacker;
    const d = p.deployZ.defender;
    expect((r.z - a) * (d - a)).toBeGreaterThan(0);
    expect(Math.abs(r.z)).toBeLessThan(Math.abs(a));
    // На сближении нападающий в воде идёт медленнее, чем по суше.
    let wet = 0;
    let dry = 0;
    for (let t = 3; t < p.clashAt; t += 0.05) {
      const adv = advanceOf(p, 'attacker', t);
      const z = a + Math.sign(d - a) * adv.dist;
      if (Math.abs(z - r.z) < r.half - 0.2) wet = Math.max(wet, adv.speed);
      else dry = Math.max(dry, adv.speed);
    }
    expect(wet).toBeGreaterThan(0);
    expect(wet).toBeLessThan(dry);
    // Через реку не разбегаются: бега у нападающего нет.
    for (let t = 3; t < p.clashAt; t += 0.1) expect(advanceOf(p, 'attacker', t).running).toBe(false);
  });

  it('без штрафа (манёвр снял или стенд без него) — река не между линиями', () => {
    const p = planOf('replay=tw&men=400&foe=400&seed=5&place=river,ford&hour=12&ground=0');
    expect(p.crossing).toBeNull();
    expect(p.field.river?.between).toBe(false);
  });
});

describe('ролик TW: показ не считает бой', () => {
  it('в коде ролика нет ни симуляции, ни мира, ни Math.random', () => {
    const dir = join(__dirname);
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.ts') || f.endsWith('.test.ts') || f === 'stand.ts') continue;
      const src = readFileSync(join(dir, f), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(src, f).not.toMatch(/Math\.random/);
      expect(src, f).not.toMatch(/battle\/sim|simulateBattle|@\/world\//);
    }
  });
});

describe('ролик TW: хореография по журналу', () => {
  // Большой бой: у обеих армий резерв, и ядро вводит его понемногу, фаза за фазой.
  // Размеры боёв хореографии — от W (записаны при W 128, `atW`): глубина строя в ширинах та же, и бой — тот же по устройству.
  // При W 94 (полная приёмка осады, docs/siege_v2.md, 19.4) те же числа ставили строй на треть глубже, резерв входил
  // волнами, и бои уходили из области своих проверок (ходов в обход, погони, давления по полосе).
  const big = planOf(`replay=tw&men=${atW(3000)}&foe=${atW(2600)}&seed=9&place=road&hour=13`);
  // Неровный бой: меньший ломается, и у большего есть кому гнать.
  const uneven = planOf(`replay=tw&men=${atW(900)}&foe=${atW(400)}&seed=4`);

  it('резерв входит понемногу: фигур в полосы уходит не больше, чем людей ввёл журнал, и не разом', () => {
    for (const side of ['attacker', 'defender'] as const) {
      const pool = big.units.filter((u) => u.side === side && u.row === 'reserve');
      const entered = big.cast.marks.filter((m) => m.id === 'reserve-committed' && m.side === side).reduce((n, m) => n + m.amount, 0);
      // Граница области: резерв у стороны есть, и журнал его вводил.
      expect(pool.length, `${side}: резерв`).toBeGreaterThan(0);
      expect(entered, `${side}: журнал вводил резерв`).toBeGreaterThan(big.k * 4);
      const left: number[] = [];
      for (const u of pool) for (let i = u.first; i < u.first + u.figures; i++) if (big.goKind[i] === 1) left.push(big.goAt[i]);
      expect(left.length, `${side}: резерв ушёл`).toBeGreaterThan(0);
      expect(left.length, `${side}: ушло не больше введённого`).toBeLessThanOrEqual(Math.ceil(entered / big.k) + pool.length);
      // Не блоком: секунды ухода разные, и струя длится, а не срывается в один миг.
      expect(new Set(left.map((t) => t.toFixed(2))).size, `${side}: уходят в разные секунды`).toBeGreaterThan(left.length / 4);
      expect(Math.max(...left) - Math.min(...left), `${side}: струя длится`).toBeGreaterThan(2);
    }
  });

  it('в обход уходят те, кого записал ход ядра, и встают у чужого фланга; без ходов обхода нет', () => {
    const b = standBattle(new URLSearchParams(`replay=tw&men=${atW(600)}&foe=${atW(560)}&seed=7&place=woods,road&hour=10`));
    // Граница области: ходы в обход у этого боя есть.
    expect(b.result.moves?.length ?? 0).toBeGreaterThan(0);
    const p = twPlanOfRecord(b.result, b.us, b.troops, 'medium', undefined, b.place, b.beastSide);
    expect(p.flankers).toBeGreaterThan(0);
    const owed = b.result.moves!.reduce((n, m) => n + Object.values(m.men).reduce((a, v) => a + Math.round((v ?? 0) / p.k), 0), 0);
    expect(p.flankers, 'ушло не больше, чем записали ходы').toBeLessThanOrEqual(owed);
    for (let i = 0; i < p.figures; i++) {
      if (p.goKind[i] !== 2) continue;
      const u = p.units[p.unitOf[i]];
      const slot = u.ours ? p.goLane[i] : 2 - p.goLane[i];
      const x1 = p.path[i * 8 + 4];
      // Встают за краем строя полосы обхода — у фланга, а не в чужом строю.
      expect(Math.abs(x1 - p.slotX[slot]), `фигура ${i}`).toBeGreaterThanOrEqual(p.slotW[slot] / 2);
    }
    // Запись без ходов (старая или из сохранения мира): показ не угадывает, кто ушёл.
    const { moves: _moves, ...old } = b.result;
    const q = twPlanOfRecord(old, b.us, b.troops, 'medium', undefined, b.place, b.beastSide);
    expect(q.flankers).toBe(0);
  });

  it('гонит только тот, кто быстрее бегущего (скорость рода ядра), и только недавно побежавших', () => {
    // Бой, где ближний к коннице отряд бежал раньше слома своей стороны больше чем на срок погони: правило «недавно» в
    // нём спрашивается (самопроверка: давно бежавший был бы ближней целью).
    const early = planOf(`replay=tw&men=${atW(600)}&foe=${atW(300)}&seed=7`);
    const chasers = [big, uneven, early].flatMap((p) => p.units.filter((u) => u.chase).map((u) => ({ u, e: p.units[u.chase!.target] })));
    const stale = early.units.some((e) => e.fleeAt !== null && e.row !== 'general' && e.fleeAt < Math.min(early.brokenAt.attacker ?? Infinity, early.brokenAt.defender ?? Infinity) - CHASE_SECONDS);
    expect(stale, 'граница области: давно бежавший отряд в бою есть').toBe(true);
    // Граница области: погоня в этих боях есть.
    expect(chasers.length).toBeGreaterThan(0);
    for (const { u, e } of chasers) {
      expect(UNIT_STATS[u.kind].speed, `${u.kind} гонит ${e.kind}`).toBeGreaterThan(UNIT_STATS[e.kind].speed);
      // Гонят только недавно побежавших: бежавший полминуты назад уже за краем поля.
      expect(e.fleeAt!, `${u.kind} гонит давно бежавших`).toBeGreaterThanOrEqual(u.chase!.from - CHASE_SECONDS);
    }
    // И не быстрее галопа: погоня — бег за спиной бегущих, а не скольжение через поле.
    for (const p of [big, uneven]) {
      for (const u of p.units.filter((x) => x.chase)) {
        for (let t = u.chase!.from; t < u.chase!.from + CHASE_SECONDS; t += 0.1) {
          const a = unitPose(p, u, t);
          const b = unitPose(p, u, t + 0.1);
          expect(Math.hypot(b.x - a.x, b.z - a.z), `отряд ${u.id}, t ${t.toFixed(1)}`).toBeLessThanOrEqual(GALLOP_SPEED * 0.1 + 0.05);
        }
      }
    }
    // И никто медленный не гонит того, кто его быстрее или вровень.
    for (const p of [big, uneven]) {
      for (const u of p.units) {
        if (u.chase || u.fleeAt !== null || u.row === 'reserve' || u.row === 'rear') continue;
        const foe = p.brokenAt[u.side === 'attacker' ? 'defender' : 'attacker'];
        if (foe === null) continue;
        const catchable = p.units.some((e) => e.side !== u.side && e.fleeAt !== null && e.row !== 'general' && UNIT_STATS[e.kind].speed < UNIT_STATS[u.kind].speed);
        expect(catchable, `${u.kind} мог гнать, но не гонит`).toBe(false);
      }
    }
  });

  it('своим путём уходит только тот, чей отряд ещё не бежал, и знаменосец — последним', () => {
    for (const p of [big, uneven]) {
      let left = 0;
      for (const u of p.units) {
        const bearer = bearerOf(p, u);
        let lastGo = -Infinity;
        for (let i = u.first; i < u.first + u.figures; i++) {
          if (!Number.isFinite(p.goAt[i])) continue;
          left += 1;
          // Отряд побежал раньше, чем фигура тронулась, — фигура бежит с ним (иначе бегство считалось бы дважды).
          if (u.fleeAt !== null) expect(p.goAt[i], `фигура ${i}`).toBeLessThan(u.fleeAt);
          if (i !== bearer) lastGo = Math.max(lastGo, p.goAt[i]);
        }
        // Обход позже может увести пришедших резервом из полосы — это другой ход; правило знамени — у струи резерва.
        let flanked = false;
        for (let i = u.first; i < u.first + u.figures; i++) if (p.goKind[i] === 2) flanked = true;
        if (!flanked && Number.isFinite(p.goAt[bearer])) expect(p.goAt[bearer], `знаменосец отряда ${u.id}`).toBeGreaterThanOrEqual(lastGo);
      }
      // Граница области: свои пути в этих боях есть.
      expect(left).toBeGreaterThan(0);
    }
  });

  it('перед бегством отряд дрожит: рыхлеет и пятится, а раньше дрожи — стоит', () => {
    const fled = big.units.filter((u) => u.fleeAt !== null && u.row !== 'general' && u.fleeAt > WAVER_SECONDS + 1);
    expect(fled.length).toBeGreaterThan(0);
    for (const u of fled) {
      const at = unitPose(big, u, u.fleeAt! - 0.2);
      expect(at.waver, `отряд ${u.id}`).toBeGreaterThan(0.5);
      expect(at.loose).toBeGreaterThan(1.3);
      expect(unitPose(big, u, u.fleeAt! - WAVER_SECONDS - 0.05).waver).toBe(0);
    }
  });

  it('линия полосы уходит к тому, кто в ней теряет больше', () => {
    let checked = 0;
    for (const p of [big, uneven]) {
      for (let slot = 0; slot < 3; slot++) {
        for (let t = p.clashAt + 0.5; t < p.timing.melee[1]; t += 1) {
          const v = pushOf(p, slot, t);
          if (Math.abs(v) < 0.05) continue;
          // Знак давления — знак разницы долей потерь передних секторов полосы: чужие теряют больше — к чужим.
          const ours = p.units.filter((u) => u.row === 'front' && u.ours && u.lane === slot);
          const theirs = p.units.filter((u) => u.row === 'front' && !u.ours && u.lane === 2 - slot);
          const lostShare = (list: typeof ours): number => {
            const men = list.reduce((n, u) => n + u.men, 0);
            const down = list.reduce((n, u) => n + (u.figures - aliveFigures(p, u, t)) * p.k, 0);
            return men > 0 ? down / men : 0;
          };
          // Граница области: разница заметна и больше шага мерки — доля по фигурам у каждой стороны отстаёт от записи меньше
          // чем на одну фигуру (`p.k` людей отряда), и знак двух долей различим, только если они разошлись больше суммы этих
          // шагов. При W 128 фигура переднего отряда была меньше 5 %, при W 94 (отряд 94 человека на 16 фигур) — 6.25 %.
          const grain = (list: typeof ours): number => p.k / Math.max(1, list.reduce((n, u) => n + u.men, 0));
          if (Math.abs(lostShare(theirs) - lostShare(ours)) < Math.max(0.05, grain(ours) + grain(theirs))) continue;
          expect(Math.sign(v), `слот ${slot}, t ${t.toFixed(1)}`).toBe(Math.sign(lostShare(theirs) - lostShare(ours)));
          checked += 1;
        }
      }
    }
    // Граница области: давление было, и разница потерь — заметная.
    expect(checked).toBeGreaterThan(3);
  });
});

