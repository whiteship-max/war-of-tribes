// Место боя ролика TW: стена, ворота, город, лагерь, логово (docs/battle_tw.md, раздел 13). Место меняет, где стоят и
// как идут, но не кто и когда падает; ворота выбиты только по журналу; сквозь стену не ходят; тот же бой — тот же ролик.
import { describe, expect, it } from 'vitest';
import { standBattle } from '../battle-stand';
import { MAN_HEIGHT } from '../units';
import { twPlanOfRecord } from './record';
import { SALLY_OUT, SALLY_START, bearerOf, figureFrame, figurePose, figureState, poseFigures, type TwPlan } from './plan';
import { cuesOf } from './cues';
import { CITY_M, SITE_KINDS, inWallBody, outOf, siteKindOf, type TwSiteKind } from './site';

const planOf = (query: string, site?: TwSiteKind | null): TwPlan => {
  const b = standBattle(new URLSearchParams(query));
  return twPlanOfRecord(b.result, b.us, b.troops, 'medium', b.militia, b.place, b.beastSide, site === undefined ? b.site : (site ?? undefined));
};

describe('место боя: строки и мера', () => {
  it('метки места — те же строки, что у мира; метр города — рост бойца на эталон', () => {
    expect([...SITE_KINDS]).toEqual(['wall', 'gate', 'sortie', 'camp', 'joint', 'lair']);
    expect(siteKindOf('wall')).toBe('wall');
    expect(siteKindOf('castle')).toBeNull();
    expect(siteKindOf(undefined)).toBeNull();
    expect(CITY_M).toBeCloseTo(MAN_HEIGHT / 1.79, 6);
  });

  it('каждое место строится и кадр без пустых чисел', () => {
    for (const kind of SITE_KINDS) {
      const q = kind === 'gate' ? 'replay=tw&men=300&foe=260&seed=4&site=gate' : `replay=tw&men=500&foe=460&seed=4&site=${kind}`;
      const p = planOf(q);
      expect(p.site?.kind, kind).toBe(kind);
      const fr = figureFrame(p.figures);
      for (const t of [0, p.clashAt, p.clashAt + 6, p.seconds * 0.8, p.seconds]) {
        poseFigures(p, t, fr);
        for (let i = 0; i < p.figures; i++) {
          expect(Number.isFinite(fr.x[i]) && Number.isFinite(fr.y[i]) && Number.isFinite(fr.z[i]), `${kind} ${t} ${i}`).toBe(true);
        }
      }
    }
  });
});

describe('место боя: штурм стены', () => {
  it('сквозь стену не ходят: в толще стены фигура только поверху', () => {
    // Набор: штурм берёт (420 против 560) и отбит (500 против 400) — в обоих есть выбитые ворота и лезущие.
    for (const [men, foe, seed] of [[420, 560, 1], [420, 560, 2], [420, 560, 3], [420, 560, 6], [500, 400, 3], [500, 400, 4], [500, 400, 6], [200, 600, 5]]) {
      const p = planOf(`replay=tw&men=${men}&foe=${foe}&seed=${seed}&site=wall`);
      const w = p.site!.wall!;
      const fr = figureFrame(p.figures);
      let inBody = 0;
      for (let t = 0; t <= p.seconds; t += 0.5) {
        poseFigures(p, t, fr);
        for (let i = 0; i < p.figures; i++) {
          if (!fr.shown[i] || !inWallBody(w, fr.x[i], fr.z[i])) continue;
          inBody++;
          expect(fr.y[i], `${men}/${foe} seed ${seed} t ${t} фигура ${i}`).toBeGreaterThan(w.base + w.top - 0.05);
        }
      }
      // Область правила не пуста: на стене стоят и через неё лезут.
      expect(inBody).toBeGreaterThan(0);
      void outOf;
    }
  });
});

/** Сколько фигур отряда пало к секунде `t`. */
const deadBy = (p: TwPlan, id: number, t: number): number => {
  const u = p.units[id];
  let n = 0;
  for (let i = u.first; i < u.first + u.figures; i++) if (p.deathAt[i] <= t) n++;
  return n;
};

describe('место боя: стена — граница', () => {
  it('за стену не заходят: чужие — только проездом или по лестнице; свои вне хода — не в толще; на штурме свои — за стеной', () => {
    // Набор: все места со стеной, по четыре боя (разный перевес); граница области — линия стены. Точки — каждая видимая
    // фигура каждые полсекунды, павшие — там, где лежат. Счётчик ниже проверяет, что у стены есть кто-то с обеих сторон.
    let near = 0;
    for (const kind of ['wall', 'gate', 'sortie', 'camp', 'joint'] as const) {
      for (const [men, foe, seed] of [
        [420, 560, 3],
        [500, 460, 6],
        [150, 400, 1],
        [600, 300, 7],
      ]) {
        const p = planOf(`replay=tw&men=${men}&foe=${foe}&seed=${seed}&site=${kind}`);
        const w = p.site!.wall!;
        const fr = figureFrame(p.figures);
        for (let t = 0; t <= p.seconds; t += 0.5) {
          poseFigures(p, t, fr);
          for (let i = 0; i < p.figures; i++) {
            if (!fr.shown[i]) continue;
            const u = p.units[p.unitOf[i]];
            // Свои: у своих ворот и на вылазке — город за строем; в совместном ударе вышедшие из ворот (путь 5) — тоже свои
            // стене: в городе им можно, в толще — нет, только проездом.
            const owner = (u.side === w.side && w.inward === (u.ours ? -1 : 1)) || p.goKind[i] === 5;
            const when = Math.min(t, p.deathAt[i]);
            const over = p.goAt[i] <= when && (p.goKind[i] === 3 || p.goKind[i] === 4);
            const d = outOf(w, fr.z[i]);
            if (Math.abs(d) < 4) near++;
            const at = `${kind} ${men}/${foe} seed ${seed} t ${t} фигура ${i} (${u.side} ${u.row} ${u.form}) x ${(fr.x[i] - w.gateX).toFixed(2)} клип ${fr.clip[i]} путь ${p.goKind[i]}`;
            if (!owner && !over && p.climb[i] < 0) expect(d, `чужой за стеной: ${at}`).toBeGreaterThan(0.02);
            if (!owner && over && inWallBody(w, fr.x[i], fr.z[i])) {
              // Через толщу (туда и, отбитым, назад) — только по своей лестнице и поверху; проезд ворот в толщу не входит.
              const lad = Math.min(...p.site!.ladders.filter((l) => l.unit === u.id).map((l) => Math.abs(l.x - fr.x[i])));
              expect(lad, `чужой в толще не у своей лестницы: ${at}`).toBeLessThan(1.6);
              expect(fr.y[i], `чужой в толще не поверху: ${at}`).toBeGreaterThan(w.base + w.top - 0.05);
            }
            if (owner && !u.perch) expect(inWallBody(w, fr.x[i], fr.z[i]), `свой в толще стены: ${at}`).toBe(false);
            if (kind === 'wall' && owner) expect(d, `защитник перед стеной: ${at}`).toBeLessThan(0.05);
          }
        }
      }
    }
    expect(near).toBeGreaterThan(1000);
  });
});

describe('место боя: показ, а не второй бой', () => {
  it('место не меняет темпа потерь: у каждого отряда к той же секунде пало столько же, что в поле', () => {
    // Набор: каждое место на двух сидах. Окна огня кругов — граница области: в них гибель под стрелами сдвигается к
    // падению тучи (`arrowDeaths`), и цель залпа зависит от места строя; вне окон темп — журнальный, до фигуры.
    let checked = 0;
    for (const kind of SITE_KINDS) {
      for (const seed of [3, 6]) {
        const q = kind === 'gate' ? `replay=tw&men=220&foe=260&seed=${seed}&site=gate` : `replay=tw&men=420&foe=480&seed=${seed}&site=${kind}`;
        const withSite = planOf(q);
        const field = planOf(q, null);
        expect(field.site).toBeNull();
        expect(withSite.units.length).toBe(field.units.length);
        const inFire = (t: number): boolean => [...withSite.fire, ...field.fire].some(([a, b]) => t >= a - 0.1 && t <= b + 2.2);
        for (let t = 0; t <= withSite.seconds; t += 0.5) {
          if (inFire(t)) continue;
          for (const u of withSite.units) {
            expect(deadBy(withSite, u.id, t), `${kind} seed ${seed} t ${t} отряд ${u.id}`).toBe(deadBy(field, u.id, t));
            checked++;
          }
        }
        // Точка внутри области: к концу ролика пало сколько-то, и сравнение шло вне окон огня.
        expect(withSite.units.some((u) => deadBy(withSite, u.id, withSite.seconds) > 0)).toBe(true);
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it('тот же бой — тот же ролик: место, лестницы, таран, ворота и пути фигур повторяются до числа', () => {
    for (const kind of SITE_KINDS) {
      const q = `replay=tw&men=420&foe=560&seed=3&site=${kind}`;
      const a = planOf(q);
      const b = planOf(q);
      expect(JSON.stringify(a.site), kind).toBe(JSON.stringify(b.site));
      expect([...a.deathAt]).toEqual([...b.deathAt]);
      expect([...a.goAt]).toEqual([...b.goAt]);
      expect([...a.path]).toEqual([...b.path]);
      expect([...a.climb]).toEqual([...b.climb]);
      const fa = figureFrame(a.figures);
      const fb = figureFrame(b.figures);
      for (const t of [a.clashAt + 1, a.seconds * 0.6]) {
        poseFigures(a, t, fa);
        poseFigures(b, t, fb);
        expect([...fa.x]).toEqual([...fb.x]);
        expect([...fa.y]).toEqual([...fb.y]);
      }
    }
  });
});

describe('место боя: ворота — по журналу', () => {
  // Набор: сорок штурмов — две пропорции сил на двадцати сидах. В нём есть и выбитые ворота, и устоявшие (граница
  // области: правило спрашивается в обоих исходах — проверено счётчиками ниже).
  const plans: TwPlan[] = [];
  for (const [men, foe] of [
    [420, 560],
    [500, 400],
  ])
    for (let seed = 1; seed <= 20; seed++) plans.push(planOf(`replay=tw&men=${men}&foe=${foe}&seed=${seed}&site=wall`));

  it('ворота выбиты в миг, когда дрогнула оборона у ворот или сломана вся, и пока таран там; иначе — целы', () => {
    let broke = 0;
    let held = 0;
    for (const p of plans) {
      const w = p.site!.wall!;
      const guards = p.units.filter((u) => u.side === w.side && u.row === 'front' && Math.abs(u.x - w.gateX) < u.width / 2 + w.gateHalf);
      const times = [...guards.map((u) => u.fleeAt), p.brokenAt[w.side]].filter((x): x is number => x !== null && x > p.clashAt);
      const due = times.length ? Math.min(...times) : null;
      const ram = p.site!.ram ? p.units[p.site!.ram.unit] : null;
      const left = ram ? (ram.fleeAt ?? p.brokenAt.attacker) : p.brokenAt.attacker;
      if (w.gateAt === null) {
        held++;
        // Устояли — журнал не дал повода: оборона у ворот не дрогнула, или таран ушёл раньше.
        expect(due === null || due >= p.seconds || (left !== null && left <= due)).toBe(true);
      } else {
        broke++;
        expect(w.gateAt).toBe(due);
        expect(left === null || w.gateAt < left).toBe(true);
        // Последний удар тарана — тот, что выбил ворота.
        if (p.site!.ram) expect(p.site!.ram.hits[p.site!.ram.hits.length - 1]).toBe(w.gateAt);
      }
    }
    expect(broke, 'в наборе есть выбитые ворота').toBeGreaterThan(3);
    expect(held, 'в наборе есть устоявшие ворота').toBeGreaterThan(3);
  });

  it('сквозь камень не идут: через толщу стены — только проездом ворот или по своей лестнице', () => {
    // Граница области — толща стены по Z; точки — путь каждой фигуры через ворота (ход 3) и через стену (ход 4) с шагом в
    // двадцатую секунды. Счётчики ниже проверяют, что такие пути в наборе есть.
    let gate = 0;
    let over = 0;
    for (const p of plans) {
      const w = p.site!.wall!;
      const fig = figureState();
      for (let i = 0; i < p.figures; i++) {
        const kind = p.goKind[i];
        if (kind !== 3 && kind !== 4) continue;
        const u = p.units[p.unitOf[i]];
        const end = Math.min(p.goAt[i] + p.path[i * 8 + 7], u.fleeAt ?? Infinity, p.deathAt[i]);
        for (let t = p.goAt[i]; t <= end; t += 0.05) {
          figurePose(p, i, t, null, fig);
          const d = -outOf(w, fig.z);
          if (d <= 0.02 || d >= w.thick - 0.02) continue;
          if (kind === 3) {
            gate++;
            expect(Math.abs(fig.x - w.gateX), `через ворота: фигура ${i}, t ${t.toFixed(2)}`).toBeLessThan(w.gateHalf);
          } else {
            over++;
            const near = Math.min(...p.site!.ladders.filter((l) => l.unit === u.id).map((l) => Math.abs(l.x - fig.x)));
            expect(near, `через стену у своей лестницы: фигура ${i}, t ${t.toFixed(2)}`).toBeLessThan(1.6);
            expect(fig.y, `через стену — поверху: фигура ${i}`).toBeGreaterThan(w.base + w.top - 0.05);
          }
        }
      }
    }
    expect(gate, 'пути через ворота в наборе есть').toBeGreaterThan(0);
    expect(over, 'пути через стену в наборе есть').toBeGreaterThan(0);
  });

  it('через ворота идут только после пролома, и только штурмующие', () => {
    for (const p of plans) {
      const w = p.site!.wall!;
      for (let i = 0; i < p.figures; i++) {
        if (p.goKind[i] !== 3) continue;
        expect(w.gateAt).not.toBeNull();
        expect(p.goAt[i]).toBeGreaterThan(w.gateAt!);
        expect(p.units[p.unitOf[i]].side).not.toBe(w.side);
      }
    }
  });

  it('звук штурма — из режиссуры: стук лестниц, удары тарана, треск ворот только у выбитых', () => {
    for (const p of plans.slice(0, 12)) {
      const site = p.site!;
      const cues = cuesOf(p);
      expect(cues.filter((c) => c.kind === 'ladder').length).toBe(site.ladders.length);
      const gate = cues.filter((c) => c.kind === 'gate');
      expect(gate.length).toBe(site.wall!.gateAt !== null && site.ram ? 1 : 0);
      if (gate.length) expect(gate[0].at).toBe(site.wall!.gateAt);
      const hits = cues.filter((c) => c.kind === 'ram' || c.kind === 'gate').map((c) => c.at);
      expect(hits).toEqual(site.ram ? site.ram.hits : []);
    }
  });
});

describe('место боя: совместный удар — гарнизон из ворот', () => {
  // Решение владельца 03.10.2026, вариант А (docs/battle_tw.md, раздел 13): ядро отдаёт, какая часть каждого отряда — гарнизон
  // (`SideResult.sectors[].garrison`), и ролик выводит гарнизон из ворот, а дружину — с поля; обе сходятся на лагере. Бой один:
  // кто и когда падает — журнальное. Набор — девять совместных ударов: лагерь разбит и устоял, доля гарнизона от 20 до 70 %,
  // малый лагерь (120 пеших встают одной серединой — у крайних полос лагеря нет). Граница области — бой, где у нападающего
  // есть и гарнизон, и дружина, и лагерь стоит перед стеной (счётчики ниже).
  const SET: [number, number, number, number][] = [
    [500, 120, 3, 200],
    [600, 420, 6, 240],
    [500, 460, 3, 100],
    [420, 560, 2, 300],
    [300, 500, 5, 150],
    [700, 400, 7, 490],
    [450, 450, 1, 200],
    [380, 600, 4, 120],
    [520, 380, 8, 360],
  ];
  const plans = SET.map(([men, foe, seed, garrison]) => {
    // Малый лагерь — пешие одного рода (`foeKinds=1`): 120 встают одной серединой, у крайних полос лагеря нет.
    const q = `replay=tw&men=${men}&foe=${foe}&seed=${seed}&site=joint&garrison=${garrison}${foe < 156 ? '&foeKinds=1' : ''}`;
    return { label: `${men} на ${foe}, сид ${seed}, из ворот ${garrison}`, q, p: planOf(q) };
  });

  it('из ворот — доля гарнизона ядра; до выхода в городе, на сшибке — у спины лагеря; дружина — с поля', () => {
    let both = 0;
    let empty = 0;
    for (const { label, p } of plans) {
      const w = p.site!.wall!;
      const ours = p.units.filter((u) => u.side === p.us && u.row !== 'general');
      // Доля из ворот — та же, что у ядра в людях (`UnitPart.gate` — из итога боя), до фигуры на род отряда.
      const figs = ours.reduce((n, u) => n + u.figures, 0);
      let gate = 0;
      for (const u of ours) for (let i = u.first; i < u.first + u.figures; i++) gate += p.fromGate[i];
      const men = ours.reduce((n, u) => n + u.men, 0);
      const gateMen = ours.reduce((n, u) => n + u.parts.reduce((m, pt) => m + pt.gate, 0), 0);
      const parts = ours.reduce((n, u) => n + u.parts.length, 0);
      expect(gateMen, `${label}: гарнизон у ядра`).toBeGreaterThan(0);
      expect(Math.abs(gate - (figs * gateMen) / men), `${label}: фигур из ворот`).toBeLessThanOrEqual(parts);
      if (gate > 0 && gate < figs) both++;
      const fr = figureFrame(p.figures);
      // Середина потока: не вышедшие ещё на дугу — в городе (не видно) или в проезде; дружина — по свою сторону лагеря.
      poseFigures(p, SALLY_START + 1, fr);
      let passage = 0;
      for (const u of ours) {
        for (let i = u.first; i < u.first + u.figures; i++) {
          if (!fr.shown[i]) continue;
          if (p.fromGate[i] && p.goAt[i] > SALLY_START + 1) {
            passage++;
            expect(outOf(w, fr.z[i]), `${label}: фигура ${i} до выхода`).toBeLessThanOrEqual(SALLY_OUT + 0.01);
            expect(Math.abs(fr.x[i] - w.gateX), `${label}: фигура ${i} в проезде`).toBeLessThan(w.gateHalf);
          } else if (!p.fromGate[i]) expect(fr.z[i], `${label}: дружина ${i} с поля`).toBeLessThan(0);
        }
      }
      expect(passage, `${label}: в проезде есть кто-то`).toBeGreaterThan(0);
      // Сшиблись: дошедшие из ворот стоят у спины лагеря — позади всего строя противника в своей полосе (у полосы, где
      // лагерь не стоит, — позади всего лагеря), перед стеной; дружина — по полевую сторону.
      const foes = p.units.filter((e) => e.side !== p.us);
      const backAll = Math.max(...foes.map((e) => e.z + e.depth));
      const backAt = (x: number): number => {
        const s = [0, 1, 2].reduce((a, b) => (Math.abs(p.slotX[b] - x) < Math.abs(p.slotX[a] - x) ? b : a), 0);
        const over = foes.filter((e) => Math.abs(e.x - p.slotX[s]) < (e.width + p.slotW[s]) / 2);
        return over.length ? Math.max(...over.map((e) => e.z + e.depth)) : backAll;
      };
      if (foes.every((e) => e.lane === null || e.lane === 1)) empty++;
      const t = p.clashAt + 3;
      poseFigures(p, t, fr);
      let arrived = 0;
      for (const u of ours) {
        if (u.fleeAt !== null && u.fleeAt <= t) continue;
        for (let i = u.first; i < u.first + u.figures; i++) {
          if (!fr.shown[i] || p.deathAt[i] <= t) continue;
          if (p.fromGate[i] && p.goAt[i] + p.path[i * 8 + 7] <= t) {
            arrived++;
            expect(fr.z[i], `${label}: из ворот ${i} у спины лагеря`).toBeGreaterThan(backAt(fr.x[i]) - 0.5);
            expect(outOf(w, fr.z[i]), `${label}: из ворот ${i} перед стеной`).toBeGreaterThan(0);
          }
          // Дружина — по полевую сторону; ушедшие в обход по ходам ядра (путь 2) бьются у фланга лагеря, а не за ним.
          if (!p.fromGate[i] && p.goKind[i] !== 2) expect(fr.z[i], `${label}: дружина ${i} по полевую сторону`).toBeLessThan(p.sallyZ! - 2);
        }
      }
      expect(arrived, `${label}: дошедших из ворот`).toBeGreaterThan(0);
    }
    expect(both).toBe(plans.length);
    expect(empty, 'в наборе есть лагерь без крайних полос').toBeGreaterThan(0);
  });

  it('павшие — в доле гарнизона и дружины, как делит мир; темп потерь отряда — журнальный; бежавшие из ворот — воротами', () => {
    let lost = 0;
    let won = 0;
    let shown = 0;
    let routed = 0;
    let sideways = 0;
    for (const { label, q, p } of plans) {
      const field = planOf(q, null);
      for (const u of p.units) {
        if (u.side !== p.us) continue;
        // Темп отряда — тот же, что в поле без места (ворота меняют, кто падает, но не сколько к секунде).
        for (const tt of [p.clashAt + 2, p.seconds * 0.5, p.seconds]) expect(deadBy(p, u.id, tt), `${label}: отряд ${u.id}, ${tt}`).toBe(deadBy(field, u.id, tt));
        for (const pt of u.parts) {
          const of = (gate: boolean): { n: number; dead: number } => {
            let n = 0;
            let dead = 0;
            for (let i = u.first; i < u.first + u.figures; i++) {
              if (p.faceIds[p.faceOf[i]].kind !== pt.kind || Boolean(p.fromGate[i]) !== gate) continue;
              n++;
              if (Number.isFinite(p.deathAt[i])) dead++;
            }
            return { n, dead };
          };
          const g = of(true);
          const d = of(false);
          if (g.n === 0 || g.dead + d.dead === 0) continue;
          // Доля павших из ворот — доля вышедших из ворот, до фигуры округления.
          expect(Math.abs(g.dead - ((g.dead + d.dead) * g.n) / (g.n + d.n)), `${label}: отряд ${u.id} ${pt.kind}`).toBeLessThanOrEqual(1);
        }
      }
      const broke = p.brokenAt[p.us];
      const fr = figureFrame(p.figures);
      poseFigures(p, p.seconds, fr);
      // Павшие из ворот на виду лежат в поле, а не в проезде и не в городе.
      const w = p.site!.wall!;
      for (let i = 0; i < p.figures; i++) {
        if (!p.fromGate[i] || p.deathAt[i] > p.seconds || !fr.shown[i]) continue;
        shown++;
        expect(outOf(w, fr.z[i]), `${label}: павший из ворот ${i} у ворот или в городе`).toBeGreaterThanOrEqual(SALLY_OUT - 0.01);
      }
      for (let i = 0; i < p.figures; i++) {
        if (!p.fromGate[i] || p.deathAt[i] <= p.seconds) continue;
        const u = p.units[p.unitOf[i]];
        // Бежавший из ворот ушёл назад в город: за стеной его не видно; устоявший — стоит у лагеря.
        if (u.fleeAt !== null && u.fleeAt + 14 <= p.seconds) expect(fr.shown[i], `${label}: из ворот ${i} бежал не воротами`).toBe(0);
      }
      if (broke !== null) lost++;
      else won++;
      // Лагерь сломан — бежит вдоль, к краям, а не сквозь вышедших из ворот: ни одна его фигура не заходит за их шеренгу.
      const camp = p.brokenAt[p.us === 'attacker' ? 'defender' : 'attacker'];
      if (camp !== null) {
        routed++;
        // Зажатый между дружиной и вышедшими из ворот, лагерь бежит вдоль, к краям: за четыре секунды бегства отряды,
        // побежавшие с ним, уходят от середины поля, а не жмутся к шеренге из ворот.
        const spread = (tt: number): { mean: number; n: number } => {
          poseFigures(p, tt, fr);
          let sum = 0;
          let n = 0;
          for (const e of p.units) {
            if (e.side === p.us || e.fleeAt === null || e.fleeAt > camp || e.fleeAt < camp - 1) continue;
            for (let i = e.first; i < e.first + e.figures; i++) {
              if (p.deathAt[i] <= camp + 4 || p.goKind[i] !== 0) continue;
              sum += Math.abs(fr.x[i]);
              n++;
            }
          }
          return { mean: n > 0 ? sum / n : 0, n };
        };
        const before = spread(camp);
        if (before.n > 0) {
          sideways++;
          expect(spread(camp + 4).mean - before.mean, `${label}: лагерь бежит к краям`).toBeGreaterThan(3);
        }
        for (let tt = camp; tt <= Math.min(p.seconds, camp + 10); tt += 0.5) {
          poseFigures(p, tt, fr);
          // Над блоком вышедших из ворот (их место по X — `sallyBlocks`, у спины лагеря его держит тест выше) бегущий не
          // заходит глубже их передней шеренги: в строй он не врезается, вдоль бежит перед ним.
          for (const e of p.units) {
            if (e.side === p.us || e.fleeAt === null || tt <= e.fleeAt) continue;
            for (let i = e.first; i < e.first + e.figures; i++) {
              if (!fr.shown[i] || p.deathAt[i] <= tt) continue;
              for (const b of p.sallyBlocks!) {
                if (fr.x[i] < b.x0 - 0.3 || fr.x[i] > b.x1 + 0.3) continue;
                expect(fr.z[i], `${label}: бегущий лагерь ${i} сквозь вышедших из ворот, t ${tt.toFixed(1)}`).toBeLessThan(b.z);
              }
            }
          }
        }
      }
    }
    expect(lost, 'в наборе есть отбитые удары').toBeGreaterThan(0);
    expect(won, 'в наборе есть удары, разбившие лагерь').toBeGreaterThan(0);
    expect(shown, 'павших из ворот на виду').toBeGreaterThan(0);
    expect(routed, 'в наборе есть сломанный лагерь').toBeGreaterThan(0);
    expect(sideways, 'в наборе есть лагерь, бежавший разом').toBeGreaterThan(0);
  });

  it('весь удар из ворот (дружина у рогаток не прошла): из ворот все, и знаменосцы с ними', () => {
    // `garrison` сверх войска — из ворот все (стенд кладёт долю каждого рода, не больше целого).
    const p = planOf('replay=tw&men=400&foe=300&seed=9&site=joint&garrison=100000');
    const ours = p.units.filter((u) => u.side === p.us && u.row !== 'general');
    expect(ours.length).toBeGreaterThan(0);
    for (const u of ours) {
      expect(p.fromGate[bearerOf(p, u)], `знаменосец отряда ${u.id}`).toBe(1);
      for (let i = u.first; i < u.first + u.figures; i++) expect(p.fromGate[i], `отряд ${u.id}, фигура ${i}`).toBe(1);
    }
  });
});
