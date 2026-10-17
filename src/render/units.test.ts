// Силуэт — главный критерий формы: на боевом масштабе восемь видов бойцов
// обязаны различаться чёрными пятнами без подписей. Глазами это проверяется
// стендом (?showcase=units&silhouette=1), числами — здесь и в отчёте
// (npm run figure:report), а сам обмер живёт в silhouette.ts.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { TROOP_BY_ID, TROOP_IDS } from '@/game/data/troops';
import type { EquipmentId } from '@/game/types';
import { hasArmor, hasShield, weaponOf } from '@/game/battle/kinds';
import { troopCard } from '@/game/battle/describe';
import type { TroopId } from '@/game/types';
import { Figure, FigurePool, PARTS, figureBox, forEachPart } from './figures';
import { ACTIONS, poseFigure } from './poses';
import { TURNS, above, area, overlap, projY, silhouette, widthAt } from './silhouette';
import { FOLK_KINDS, MAN_HEIGHT, dressMount, dressSoldier, dressVillager, gearTier } from './units';
import { HEAD_DEPTH, headRadiusAt } from './gear';

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

/**
 * Одно снаряжение — одно описание.
 *
 * Карточка вида и фигура в сцене рассказывают об одном и том же бойце, и до
 * слияния делали это порознь: карточка читала `TroopDef.gear`, а фигура держала
 * свою таблицу «у щитоносца щит, у лучника лук». Две правды об одном бойце
 * расходятся молча — и расходятся именно тогда, когда снаряжение вида меняют.
 *
 * Поэтому здесь проверяется не текущий набор оружия, а связь: правка `gear`
 * в конфиге обязана дойти и до текста карточки, и до набора деталей фигуры.
 */
describe('снаряжение вида — один источник на карточку и на фигуру', () => {
  /** Правит снаряжение вида на время одной проверки и возвращает как было. */
  function withGear<T>(troop: TroopId, gear: Partial<Record<EquipmentId, number>>, run: () => T): T {
    const def = TROOP_BY_ID[troop];
    const before = def.gear;
    (def as { gear: Partial<Record<EquipmentId, number>> }).gear = gear;
    try {
      return run();
    } finally {
      (def as { gear: Partial<Record<EquipmentId, number>> }).gear = before;
    }
  }

  /**
   * Набор деталей фигуры: род детали, сустав и её размеры. Одних родов мало —
   * копьё и дубина обе висят на правой руке древком, а различает их длина,
   * то есть ровно то, что и видно на поле.
   */
  const parts = (troop: TroopId): string[] => {
    const pos = new THREE.Vector3();
    const rot = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    return soldier(troop)
      .slots.map((sl) => {
        sl.local.decompose(pos, rot, scale);
        const size = [scale.x, scale.y, scale.z].map((v) => v.toFixed(2)).join('×');
        return `${sl.part}@${sl.joint} ${size}`;
      })
      .sort();
  };

  /** Список предметов, который карточка называет ковке. */
  const cardGear = (troop: TroopId): string =>
    troopCard(troop).cost.gear.map((g) => `${g.id}×${g.n}`).sort().join(', ');

  it('добавили щит в конфиг — он появился и на карточке, и на фигуре', () => {
    // Дубинщик нарочно: у него в конфиге пусто, значит любое изменение видно.
    const cardBefore = cardGear('clubman');
    const partsBefore = parts('clubman');
    expect(cardBefore).toBe('');
    expect(hasShield('clubman')).toBe(false);

    const { card, slots } = withGear('clubman', { shield: 1 }, () => ({
      card: cardGear('clubman'),
      slots: parts('clubman'),
    }));

    // Карточка называет щит ковке...
    expect(card).toBe('shield×1');
    expect(card).not.toBe(cardBefore);
    // ...и на фигуре появились детали, которых не было.
    expect(slots).not.toEqual(partsBefore);
    expect(slots.length).toBeGreaterThan(partsBefore.length);

    // И всё вернулось: конфиг правится только на время проверки.
    expect(cardGear('clubman')).toBe(cardBefore);
    expect(parts('clubman')).toEqual(partsBefore);
  });

  it('сменили оружие в конфиге — сменился и текст, и то, что в руках', () => {
    const plain = parts('clubman');
    const withBow = withGear('clubman', { bow: 1 }, () => parts('clubman'));
    const withSpear = withGear('clubman', { spear: 1 }, () => parts('clubman'));

    // Три разных оружия — три разных набора деталей.
    expect(withBow).not.toEqual(plain);
    expect(withSpear).not.toEqual(plain);
    expect(withBow).not.toEqual(withSpear);
    // Лук — самое «многодетальное» оружие: два плеча, колчан и оперение стрел
    // против древка с наконечником у копья. Различие видно и числом деталей.
    expect(withBow.length).toBeGreaterThan(withSpear.length);

    // И то же самое видит карточка.
    expect(withGear('clubman', { bow: 1 }, () => cardGear('clubman'))).toBe('bow×1');
  });

  it('железо на фигуре и вес на карточке растут от одного снаряжения', () => {
    // Ступени снаряжения на карточке больше нет (путь П2, 14.35): вещи идут в бой через цену вида — весом. Прибавили предмет —
    // выросли и железо на фигуре, и вес на карточке: оба читают одно `TroopDef.gear`.
    // Мечник, а не дубинщик: дубинщик — мерка веса, его вес — единица при любом снаряжении.
    const before = { tier: gearTier('swordsman'), slots: parts('swordsman').length, weight: troopCard('swordsman').weight.value };
    const after = withGear('swordsman', { sword: 1, shield: 1, armor: 1 }, () => ({
      tier: gearTier('swordsman'),
      weight: troopCard('swordsman').weight.value,
      slots: parts('swordsman').length,
    }));
    expect(after.tier).toBeGreaterThan(before.tier);
    expect(after.weight).toBeGreaterThan(before.weight);
    expect(after.slots).toBeGreaterThan(before.slots);
  });

  it('своей таблицы оружия у фигуры нет: всё выводится из конфига', () => {
    // Если бы у сцены осталась вторая таблица, этот перебор её бы и поймал:
    // здесь ни одного вида не названо поимённо.
    for (const troop of TROOP_IDS) {
      const gear = TROOP_BY_ID[troop].gear;
      expect(hasShield(troop), `${troop}: щит`).toBe((gear.shield ?? 0) > 0);
      expect(hasArmor(troop), `${troop}: доспех`).toBe((gear.armor ?? 0) > 0);
      const weapon = weaponOf(troop);
      const named = ['bow', 'axe', 'sword', 'spear'] as EquipmentId[];
      const carried = named.filter((g) => gear[g]);
      if (carried.length === 0) expect(weapon, troop).toBe('club');
      else expect(carried, `${troop}: ${weapon} не из его снаряжения`).toContain(weapon as EquipmentId);
    }
  });

  it('щит на фигуре есть ровно у тех, у кого он есть в конфиге', () => {
    for (const troop of TROOP_IDS) {
      const withShield = parts(troop).length;
      const without = withGear(troop, { ...TROOP_BY_ID[troop].gear, shield: 0 }, () => parts(troop).length);
      if (hasShield(troop)) expect(withShield, `${troop} несёт щит`).toBeGreaterThan(without);
      else expect(withShield, `${troop} без щита`).toBe(without);
    }
  });
});

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
  it('посадка переносит голову, плечи и оружие вместе с тазом', () => {
    const foot = soldier('spearman');
    const mounted = soldier('rider');
    const lift = mounted.rig.hipY - foot.rig.hipY;
    expect(mounted.rig.shoulderY - foot.rig.shoulderY).toBeCloseTo(lift);
    expect(mounted.rig.neckY - foot.rig.neckY).toBeCloseTo(lift);
    const headY = (f: Figure): number => {
      let y = 0;
      forEachPart(f, (slot, matrix) => {
        if (slot.part === 'head' && slot.joint === 'head') y = matrix.elements[13];
      });
      return y;
    };
    expect(headY(mounted) - headY(foot)).toBeCloseTo(lift);
  });

  // Кто верхом — не список, а поле вида (`TroopDef.mounted`): конных видов больше одного.
  const MOUNTED = TROOP_IDS.filter((id) => TROOP_BY_ID[id].mounted === true);
  const FOOT = TROOP_IDS.filter((id) => TROOP_BY_ID[id].mounted !== true);

  it('всадник несёт коня, пеший — нет', () => {
    // Граница: конные и пешие виды есть оба — иначе цикл проверял бы пустое множество.
    expect(MOUNTED.length).toBeGreaterThan(0);
    expect(FOOT.length).toBeGreaterThan(0);
    for (const id of MOUNTED) expect(soldier(id).rig.mount, `${id}`).not.toBeNull();
    for (const id of FOOT) expect(soldier(id).rig.mount, `${id}`).toBeNull();
  });

  it('всадник сидит почти вдвое выше пешего и даёт на поле пятно больше любого пешего', () => {
    for (const rider of MOUNTED) {
      expect(soldier(rider).rig.hipY, rider).toBeGreaterThan(soldier('spearman').rig.hipY * 1.6);
      const mine = area(silhouette(soldier(rider)));
      for (const id of FOOT) expect(mine, `${rider} против ${id}`).toBeGreaterThan(area(silhouette(soldier(id))));
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

describe('посадка одежды', () => {
  it('подол третьего покроя начинается у таза и доходит до щиколоток', () => {
    const f = villager(2);
    const skirt = f.slots.find((s) => s.part === 'body' && s.joint === 'hips')!;
    const top = new THREE.Vector3(0, 0, 0).applyMatrix4(skirt.local).y + f.rig.hipY;
    const bottom = new THREE.Vector3(0, 1, 0).applyMatrix4(skirt.local).y + f.rig.hipY;
    expect(top).toBeGreaterThanOrEqual(f.rig.hipY);
    expect(top).toBeLessThan(f.rig.hipY + f.rig.height * 0.04);
    expect(bottom).toBeGreaterThanOrEqual(0);
    expect(bottom).toBeLessThan(f.rig.height * 0.04);
  });

  it('макушка и верхние грани головы закрыты головным убором', () => {
    const pool = new FigurePool();
    const geometry = (part: string): THREE.BufferGeometry =>
      (pool.group.children.find((m) => m.name === part) as THREE.InstancedMesh).geometry;
    // Берём реальные вершины черепа: одна проверка верхней границы убора
    // не поймала бы голову, торчащую сквозь его наклонные стороны. Убор — его
    // профиль (`gear.headRadiusAt`: шлем с наносником, шапель, топхелм; без формы —
    // конус примитива), с разбросом в строю — каждый вариант головы.
    const figures = [
      ...TROOP_IDS.map(soldier),
      ...TROOP_IDS.map((id) => {
        const f = new Figure();
        dressSoldier(f, id, undefined, { variants: true });
        return f;
      }),
      ...[0, 1, 2].map(villager),
    ];
    let shaped = 0;
    for (const f of figures) {
      const head = f.slots.find((s) => s.part === 'head' && s.joint === 'head')!;
      for (const cap of f.slots.filter((s) => s.part === 'cap' && s.joint === 'head')) {
        if (cap.shape) shaped++;
        const toCap = cap.local.clone().invert().multiply(head.local);
        const pos = geometry('head').getAttribute('position');
        const depth = (cap.shape && HEAD_DEPTH[cap.shape]) || 1;
        for (let i = 0; i < pos.count; i++) {
          const point = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(toCap);
          if (point.y < 0) continue;
          expect(point.y, cap.shape).toBeLessThanOrEqual(1);
          // Вписанный круг шестигранника (средний уровень формы) — консервативная граница покрытия.
          expect(Math.hypot(point.x, point.z / depth), cap.shape).toBeLessThanOrEqual(headRadiusAt(cap.shape, point.y) * Math.cos(Math.PI / 6) + 0.001);
        }
      }
    }
    // Область правила: уборов с формой проверено больше, чем видов, — каждый вариант головы.
    expect(shaped).toBeGreaterThan(TROOP_IDS.length);
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
