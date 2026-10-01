// Стая в ролике боя (docs/graphics_world.md, 11.4): волки одеты псовыми в цвет своей стороны, стоят в позах зверя по
// такту боя, знамён не несут и ничего не роняют; люди рядом — как были.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { simulateBattle } from '@/battle/sim';
import { deploySetup } from '@/battle/setup';
import { frameAt, type Cast, type Frame, type SectorFrame } from '@/battle/replay';
import { castOfRecord } from '@/game/battle/cast';
import type { TroopStack } from '@/game/battle/kinds';
import { kindsOf } from '@/game/battle/price';
import { Figure, FigurePool } from '../figures';
import { CANINE_NECK, WOLF_DARK, darker } from '../beasts';
import { CLOTH_OF, PACK_YAW, SectorTroops, beastSector } from './troops';
import { MassView } from './mass';
import { Aftermath } from './aftermath';

const HOME: TroopStack = { spearman: 30, clubman: 20, archer: 20 };

/** Стая у ворот — как в игре (`LocalWorld.gateParty`, `gateRecord`): волки нападают, наши защищаются. */
function packCast(seed = 7): Cast {
  const result = simulateBattle({ seed, attacker: deploySetup({ cavalry: 50 }), defender: deploySetup(kindsOf(HOME)) });
  return castOfRecord(result, 'defender', { attacker: {}, defender: HOME }, undefined, undefined, 'attacker');
}

interface Crew {
  figure: Figure;
  order: number;
  yaw: number;
}
const crewOf = (b: SectorTroops): Crew[] => (b as unknown as { men: Crew[] }).men;
const menOf = (b: SectorTroops): Figure[] => crewOf(b).map((m) => m.figure);

/** Блоки стаи и людей одной раскадровки. */
function blocksOf(cast: Cast): { pool: FigurePool; wolves: SectorTroops[]; people: SectorTroops[] } {
  const pool = new FigurePool();
  const blocks = cast.sectors.map((c) => new SectorTroops(c, cast.us, pool));
  return {
    pool,
    wolves: blocks.filter((b) => b.side === 'attacker'),
    people: blocks.filter((b) => b.side === 'defender'),
  };
}

/** Кадр ролика, где фигур, отобранных `pick`, видно больше всего: на сборе крупный план показывает наших, а не стаю. */
function peak(cast: Cast, pick: (s: SectorFrame) => boolean): Frame {
  let best = frameAt(cast, 0);
  const shown = (fr: Frame): number => fr.sectors.filter(pick).reduce((n, s) => n + s.figures, 0);
  for (let t = 0; t <= cast.seconds; t += 0.5) {
    const fr = frameAt(cast, t);
    if (shown(fr) > shown(best)) best = fr;
  }
  return best;
}

/** Кадр сектора, где его видно больше всего, — все на ногах: от него и строятся кадры с павшими и бегущими. */
function standingFrame(cast: Cast, block: SectorTroops): SectorFrame {
  const mine = (s: SectorFrame): boolean => s.side === block.side && s.sector === block.sector;
  const f = peak(cast, mine).sectors.find(mine)!;
  return { ...f, standing: f.figures, flee: 0, broken: false };
}

describe('стая в ролике боя', () => {
  it('волки — псовые в цвете чужой стороны, люди — бойцы в своём', () => {
    const cast = packCast();
    const { wolves, people } = blocksOf(cast);
    const theirs = CLOTH_OF(false);
    const ours = CLOTH_OF(true);
    // Граница области: стая и люди в раскадровке есть, и стая — звериные секторы.
    expect(wolves.length).toBeGreaterThan(0);
    expect(people.length).toBeGreaterThan(0);
    for (const c of cast.sectors) expect(beastSector(c), `${c.side} ${c.sector}`).toBe(c.side === 'attacker');
    for (const b of wolves) {
      for (const f of menOf(b)) {
        expect(f.rig.mount, 'скелет четвероногого').not.toBeNull();
        expect(f.slots.some((s) => s.part === 'shield'), 'щита у волка нет').toBe(false);
        for (const s of f.slots) expect([theirs, darker(theirs, WOLF_DARK)]).toContain(s.color.getHex());
      }
    }
    for (const b of people) {
      for (const f of menOf(b)) {
        expect(f.slots.some((s) => s.joint === 'tail'), 'у людей хвоста нет').toBe(false);
        expect(f.slots.some((s) => s.color.getHex() === ours), 'рубаха — наш цвет').toBe(true);
      }
    }
  });

  it('позы по такту: перед сшибкой припадает, в свалке бросается, павший лежит набок, бегущий уходит рысью', () => {
    const cast = packCast();
    const { wolves } = blocksOf(cast);
    // Самый видный сектор стаи: в нём и падают, и бегут.
    const [block, base] = wolves
      .map((b) => [b, standingFrame(cast, b)] as const)
      .reduce((a, b) => (b[1].figures > a[1].figures ? b : a));
    // Граница области: сектор стоит, и фигур в нём больше пяти павших в кадре ниже — кто-то остаётся на ногах.
    expect(base.figures).toBeGreaterThan(6);
    const men = menOf(block).slice(0, base.figures);

    block.apply(base, cast.us, 'guard', 2);
    for (const f of men) {
      expect(f.rig.mount!.neckPitch, 'голова вперёд и вниз').toBeGreaterThan(CANINE_NECK + 0.4);
      expect(f.position.y, 'корпус припал').toBeLessThan(0);
    }

    let lunged = 0;
    for (let t = 0; t < 2; t += 0.1) {
      block.apply(base, cast.us, 'strike', t);
      lunged += men.filter((f) => f.pitch < -0.1).length;
    }
    expect(lunged, 'в свалке бросаются').toBeGreaterThan(0);

    block.apply({ ...base, standing: base.figures - 5 }, cast.us, 'strike', 1);
    const fallen = men.filter((f) => f.down === 1);
    // Падают по своей очереди (`order`) — те, чья очередь меньше числа павших.
    const due = crewOf(block).slice(0, base.figures).filter((m) => m.order < 5).map((m) => m.figure);
    expect(due.length).toBeGreaterThan(0);
    expect(fallen).toEqual(due);
    for (const f of fallen) {
      expect(f.roll, 'лежит набок').toBeCloseTo(Math.PI / 2, 6);
      expect(f.position.y, 'на земле').toBeLessThan(0);
    }

    // Бегущий развёрнут спиной к строю — со своим разворотом волка в стае.
    const facing = Math.PI;
    block.apply({ ...base, flee: 0.3 }, cast.us, 'strike', 1);
    const runners = crewOf(block)
      .slice(0, base.figures)
      .filter((m) => Math.abs(m.figure.rotationY - m.yaw - (facing + Math.PI)) < 1e-9)
      .map((m) => m.figure);
    expect(runners.length, 'бегущие есть').toBeGreaterThan(0);
    // Рысь, а не шаг: голова поднята на рысь, а не в упор и не в бросок.
    for (const f of runners) expect(f.rig.mount!.neckPitch).toBeCloseTo(CANINE_NECK + 0.25, 9);
  });

  it('стая — не строй: волки развёрнуты вразброс и стоят вразброс, но вперёд передней шеренги не выходят; люди — строем', () => {
    const cast = packCast();
    const { wolves, people } = blocksOf(cast);
    let shown = 0;
    const yaws = new Set<number>();
    for (const block of wolves) {
      const base = standingFrame(cast, block);
      block.apply(base, cast.us, 'guard', 1);
      const front = base.z + base.dz;
      const crew = crewOf(block).slice(0, base.figures);
      shown += crew.length;
      for (const m of crew) {
        yaws.add(Math.round(m.yaw * 1000));
        expect(Math.abs(m.yaw), 'разворот в пределах').toBeLessThanOrEqual(PACK_YAW / 2);
        // Чужая сторона стоит на +Z, её ряды уходят назад — к большему Z: впереди строя никого.
        expect(m.figure.position.z - front, 'не впереди передней шеренги').toBeGreaterThanOrEqual(-1e-9);
      }
    }
    // Граница области: стаю видно, и она не стоит одним разворотом.
    expect(shown).toBeGreaterThan(10);
    expect(yaws.size, 'развороты разные').toBeGreaterThan(5);
    for (const block of people) for (const m of crewOf(block)) expect(m.yaw, 'строй смотрит на врага').toBe(0);
  });

  it('знамён у стаи нет и после неё ничего не брошено; у людей — как было', () => {
    const cast = packCast();
    const late: Frame = frameAt(cast, cast.seconds);
    const mid: Frame = peak(cast, beastSector);
    const pack = (fr: Frame): SectorFrame[] => fr.sectors.filter((s) => beastSector(s));
    const men = (fr: Frame): SectorFrame[] => fr.sectors.filter((s) => !beastSector(s));
    // Граница области: раскадровка даёт стае и знамёна, и брошенное — правило спрашивается.
    expect(pack(mid).reduce((n, s) => n + s.banners, 0)).toBeGreaterThan(0);
    expect(pack(late).reduce((n, s) => n + s.wreck, 0)).toBeGreaterThan(0);

    const view = new MassView({
      shafts: cast.sectors.reduce((n, c) => n + c.shafts + c.banners, 0),
      flags: cast.sectors.reduce((n, c) => n + c.banners, 0),
      dust: cast.sectors.length,
    });
    const flags = (): number => (view as unknown as { flags: THREE.InstancedMesh }).flags.count;
    const beat = { couch: 0, time: 0, impact: 0 };
    view.update(pack(mid), () => CLOTH_OF(false), beat);
    expect(flags(), 'у стаи знамён нет').toBe(0);
    view.update(men(mid), () => CLOTH_OF(true), beat);
    expect(flags(), 'у людей знамёна есть').toBeGreaterThan(0);

    const wreck = new Aftermath(cast.sectors.reduce((n, c) => n + c.figures, 0));
    const lying = (): number => {
      const g = wreck as unknown as { shields: THREE.InstancedMesh; shafts: THREE.InstancedMesh };
      return g.shields.count + g.shafts.count;
    };
    wreck.update(pack(late), () => CLOTH_OF(false));
    expect(lying(), 'после стаи ничего не брошено').toBe(0);
    wreck.update(men(late), () => CLOTH_OF(true));
    expect(lying(), 'после людей брошенное есть').toBeGreaterThan(0);
    view.dispose();
    wreck.dispose();
  });
});
