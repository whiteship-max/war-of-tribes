// Силуэт — главный критерий формы: на боевом масштабе восемь видов бойцов
// обязаны различаться чёрными пятнами без подписей. Глазами это проверяется
// стендом (?showcase=units&silhouette=1), числами — здесь и в отчёте
// (npm run figure:report), а сам обмер живёт в silhouette.ts.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { TROOP_IDS } from '@/game/data/troops';
import type { TroopId } from '@/game/types';
import { Figure, FigurePool, PARTS, figureBox } from './figures';
import { ACTIONS, poseFigure } from './poses';
import { TURNS, above, area, overlap, projY, silhouette, widthAt } from './silhouette';
import { FOLK_KINDS, MAN_HEIGHT, dressMount, dressSoldier, dressVillager, gearTier } from './units';

function soldier(troop: TroopId): Figure {
  const f = new Figure();
  dressSoldier(f, troop);
  f.phase = 0;
  poseFigure(f, 'stand', 0);
  return f;
}

function villager(kind: number): Figure {
  const f = new Figure();
  dressVillager(f, kind);
  f.phase = 0;
  poseFigure(f, 'stand', 0);
  return f;
}

/**
 * Порог совпадения пятен. Мера площадная, и тонкое древко она недооценивает:
 * копьё в полтора роста добавляет к пятну считанные проценты, хотя глазом
 * видно первым. Поэтому она ловит грубое — два вида с одинаковым корпусом и
 * неразличимым снаряжением, — а ближайшие пары проверяются не ею, а тем
 * признаком, ради которого они разведены.
 */
const SAME = 0.85;

describe('силуэты видов', () => {
  it('ни одна пара видов не сливается в одно пятно — с любой стороны', () => {
    for (const turn of TURNS) {
      const masks = new Map(TROOP_IDS.map((id) => [id, silhouette(soldier(id), turn)]));
      for (let i = 0; i < TROOP_IDS.length; i++) {
        for (let j = i + 1; j < TROOP_IDS.length; j++) {
          const a = TROOP_IDS[i];
          const b = TROOP_IDS[j];
          const k = overlap(masks.get(a)!, masks.get(b)!);
          expect(k, `${a} и ${b} при повороте ${turn.toFixed(2)}`).toBeLessThan(SAME);
        }
      }
    }
  });

  it('копейщик против мечника: древко над головой есть у одного и нет у другого', () => {
    // Признак нарочный и не зависит от оборота: поворот вокруг своей оси высоту
    // не меняет, а выше плеч фигуру ничего не закрывает — значит копьё видно с
    // любой стороны, а меч, прижатый к боку, с половины оборота исчезает.
    // Площадь пятна тут ничего не решает: древко тонкое.
    const top = (id: TroopId): number => figureBox(soldier(id)).max.y;
    expect(top('spearman')).toBeGreaterThan(MAN_HEIGHT * 1.35);
    expect(top('swordsman')).toBeLessThan(MAN_HEIGHT * 1.12);
    // И то же самое на растре, с той стороны, где меч не спрятан за корпусом.
    const y = projY(MAN_HEIGHT * 1.15);
    expect(above(silhouette(soldier('spearman')), y)).toBeGreaterThan(20);
    expect(above(silhouette(soldier('swordsman')), y)).toBe(0);
  });

  it('щитоносец против латника: латник крупнее пятном с любой стороны', () => {
    for (const turn of TURNS) {
      const round = silhouette(soldier('shieldman'), turn);
      const tall = silhouette(soldier('legionary'), turn);
      expect(area(tall) / area(round), `при повороте ${turn.toFixed(2)}`).toBeGreaterThan(1.15);
    }
  });

  it('щитоносец против латника: ростовой щит достаёт до голени, круглый — нет', () => {
    const y = projY(MAN_HEIGHT * 0.22);
    const round = widthAt(silhouette(soldier('shieldman')), y);
    const tall = widthAt(silhouette(soldier('legionary')), y);
    expect(tall).toBeGreaterThan(round * 1.35);
  });

  it('горожане тоже не штампованные: три покроя дают три разных пятна', () => {
    for (let i = 0; i < FOLK_KINDS; i++) {
      for (let j = i + 1; j < FOLK_KINDS; j++) {
        expect(overlap(silhouette(villager(i)), silhouette(villager(j))), `покрои ${i} и ${j}`).toBeLessThan(SAME);
      }
    }
  });
});

describe('кузница видна на бойце', () => {
  it('чем выше ступень снаряжения, тем больше железа на фигуре', () => {
    // Шлем, кираса, наплечники, гребень, поножи — всё это шапки и пластины.
    const iron = (id: TroopId): number =>
      soldier(id).slots.filter((s) => s.part === 'plate' || s.part === 'cap').length;
    const byTier = TROOP_IDS.map((id) => ({ id, tier: gearTier(id), iron: iron(id) }));
    const naked = byTier.filter((r) => r.tier === 0);
    const full = byTier.filter((r) => r.tier === 3);
    expect(naked.length).toBeGreaterThan(0);
    expect(full.length).toBeGreaterThan(0);
    for (const a of naked) {
      for (const b of full) {
        expect(b.iron, `${b.id} должен нести больше железа, чем ${a.id}`).toBeGreaterThan(a.iron);
      }
    }
  });

  it('дубинщик без снаряжения — единственный с непокрытой головой', () => {
    expect(gearTier('clubman')).toBe(0);
    for (const id of TROOP_IDS) {
      if (id === 'clubman') continue;
      expect(gearTier(id), `${id}`).toBeGreaterThan(0);
    }
  });
});

describe('конь', () => {
  it('всадник несёт коня, пеший — нет', () => {
    expect(soldier('rider').rig.mount).not.toBeNull();
    for (const id of TROOP_IDS) {
      if (id === 'rider') continue;
      expect(soldier(id).rig.mount, `${id}`).toBeNull();
    }
  });

  it('всадник сидит почти вдвое выше пешего и даёт самое большое пятно на поле', () => {
    expect(soldier('rider').rig.hipY).toBeGreaterThan(soldier('spearman').rig.hipY * 1.6);
    const mine = area(silhouette(soldier('rider')));
    for (const id of TROOP_IDS) {
      if (id === 'rider') continue;
      expect(mine, `всадник против ${id}`).toBeGreaterThan(area(silhouette(soldier(id))));
    }
  });

  it('конь стоит на земле: ноги достают до нуля, ничего не проваливается', () => {
    const f = new Figure();
    dressMount(f);
    poseFigure(f, 'stand', 0);
    const box = figureBox(f);
    expect(box.min.y).toBeGreaterThan(-0.05);
    expect(box.min.y).toBeLessThan(0.06);
  });
});

describe('позы', () => {
  it('любая поза в любой момент даёт конечные углы в разумных пределах', () => {
    for (const action of ACTIONS) {
      const f = soldier('swordsman');
      f.down = 0.6;
      for (let t = 0; t < 4; t += 0.13) {
        poseFigure(f, action, t);
        const angles = [f.pitch, f.roll, f.bob, f.torsoTilt, f.torsoTwist, f.headNod, f.legSwing, f.gait, f.armMain, f.armOff, f.armSpread];
        for (const v of angles) {
          expect(Number.isFinite(v), `${action}`).toBe(true);
          expect(Math.abs(v), `${action}`).toBeLessThanOrEqual(Math.PI);
        }
      }
    }
  });

  it('замах и удар — разные позы: рука уходит назад, потом проходит вперёд', () => {
    const f = soldier('axeman');
    f.phase = 0;
    let back = 0;
    let through = 0;
    for (let t = 0; t < 2; t += 0.02) {
      poseFigure(f, 'strike', t);
      back = Math.min(back, f.armMain);
      through = Math.max(through, f.armMain);
    }
    expect(back).toBeLessThan(-1.5);
    expect(through).toBeGreaterThan(0.5);
  });

  it('упавший лежит: доля падения роняет фигуру и сама не откатывается', () => {
    const f = soldier('clubman');
    poseFigure(f, 'fall', 0);
    const standing = figureBox(f).max.y;
    f.down = 1;
    poseFigure(f, 'fall', 0);
    expect(figureBox(f).max.y).toBeLessThan(standing * 0.7);
  });

  it('у каждой фигуры своё смещение по времени: толпа не машет ногами в такт', () => {
    const a = soldier('spearman');
    const b = soldier('spearman');
    a.phase = 0;
    b.phase = 0.4;
    poseFigure(a, 'walk', 1);
    poseFigure(b, 'walk', 1);
    expect(Math.abs(a.legSwing - b.legSwing)).toBeGreaterThan(0.05);
  });
});

describe('пул инстансов', () => {
  it('деталей рисуется ровно столько, сколько их есть: пустых мест в буфере нет', () => {
    const pool = new FigurePool();
    const figures = TROOP_IDS.map((id) => soldier(id));
    for (const f of figures) pool.add(f);
    pool.update();
    const demand = pool.demand();
    for (const part of PARTS) {
      const want = figures.reduce((n, f) => n + f.counts[part], 0);
      expect(demand[part], part).toBe(want);
      const mesh = pool.group.getObjectByName(part) as THREE.InstancedMesh;
      expect(mesh.count, part).toBe(want);
    }
  });

  it('невидимая фигура не занимает ни одного инстанса', () => {
    const pool = new FigurePool();
    pool.add(soldier('legionary'));
    const hidden = soldier('legionary');
    pool.add(hidden);
    pool.update();
    const both = (pool.group.getObjectByName('plate') as THREE.InstancedMesh).count;
    hidden.visible = false;
    pool.update();
    expect((pool.group.getObjectByName('plate') as THREE.InstancedMesh).count).toBe(both / 2);
  });

  it('семь примитивов на всё: новых вызовов отрисовки фигуры не добавляют', () => {
    const pool = new FigurePool();
    expect(pool.group.children).toHaveLength(PARTS.length);
    for (const id of TROOP_IDS) pool.add(soldier(id));
    pool.update();
    expect(pool.group.children).toHaveLength(PARTS.length);
  });
});
