// Лес древков: у каждого древка есть хозяин.
//
// Правило простое и проверяется прямо: **на любом кадре число древков без
// носителя равно нулю**. Древко стоит в клетке занятого места строя — не в
// промежутке между шеренгами, не за флангом, не там, где строя нет вовсе, — и
// никогда рядом с конницей: у всадника оружие в руке, подменять его нечем.
//
// Раньше лес жил на своей, более плотной решётке и попадал во все эти места
// разом. Тест держит, чтобы решётка больше не разошлась со строем.
//
// Проверка идёт дважды: по настоящим кадрам ролика и по кадрам с **насильно
// включённым лесом**. Второе обязательно, потому что порог `SHAFT_PX` — число,
// а правило — правило: при нынешних планах камеры боец нигде не мельче тридцати
// пикселей, лес выключен, и по одним настоящим кадрам проверка была бы пустой.
import { describe, expect, it } from 'vitest';
import { simulateBattle } from '@/battle/sim';
import { quickSetup } from '@/battle/setup';
import {
  FILE_STEP,
  RANK_STEP,
  SHAFT_PX,
  buildCast,
  frameAt,
  manPixels,
  shaftShare,
  type Cast,
  type Frame,
  type SectorFrame,
} from '@/battle/replay';
import type { Stack } from '@/battle/types';
import { MAN_HEIGHT, SPEAR_LEN } from '../units';
import { MassView, figureSpot, kindAt } from './mass';

const armyMix = (men: number): Partial<Stack> => ({
  spear: Math.round(men * 0.25),
  infantry: Math.round(men * 0.35),
  archer: Math.round(men * 0.25),
  cavalry: Math.round(men * 0.15),
});

const fight = (a: Partial<Stack>, d: Partial<Stack>, seed = 7): Cast =>
  buildCast(simulateBattle({ seed, attacker: quickSetup(a), defender: quickSetup(d) }), 'attacker');

/** Кадры ролика с шагом в четверть секунды. */
function frames(cast: Cast, step = 0.25): Frame[] {
  const out: Frame[] = [];
  for (let t = 0; t <= cast.seconds + 1e-9; t += step) out.push(frameAt(cast, Math.min(t, cast.seconds)));
  return out;
}

/**
 * Тот же кадр, но лес включён на полную. Считает его та же раскадровка — берётся
 * `CastSector.shafts`, посчитанный по составу, — так что проверяется настоящее
 * число древков, а не выдуманное.
 */
function forced(cast: Cast, frame: Frame): SectorFrame[] {
  return frame.sectors.map((s) => {
    const c = cast.sectors.find((x) => x.side === s.side && x.sector === s.sector)!;
    const part = c.figures > 0 ? s.figures / c.figures : 0;
    return { ...s, shafts: Math.round(c.shafts * part) };
  });
}

const capacity = (cast: Cast) => ({
  shafts: cast.sectors.reduce((n, c) => n + c.shafts + c.banners, 0) + 1,
  flags: cast.sectors.reduce((n, c) => n + c.banners, 0) + 1,
  dust: cast.sectors.length,
});

/** Ставит массу кадра и отдаёт то, что она разложила. */
function place(view: MassView, sectors: readonly SectorFrame[], couch = 0): MassView['forest'] {
  view.update(sectors, () => 0x336f9b, { couch, time: 0, impact: 0 });
  return view.forest;
}

describe('у каждого древка есть хозяин', () => {
  it('на любом кадре число древков без носителя равно нулю', () => {
    const cast = fight(armyMix(600), armyMix(600));
    const view = new MassView(capacity(cast));
    let checked = 0;
    for (const frame of frames(cast)) {
      // И как есть, и с включённым на полную лесом: правило от порога не зависит.
      for (const sectors of [frame.sectors, forced(cast, frame)]) {
        for (const shaft of place(view, sectors, frame.couch)) {
          const f = sectors[shaft.sector];
          // Носитель — настоящее занятое место блока, а не выдуманный номер.
          expect(shaft.bearer, 'место вне блока').toBeGreaterThanOrEqual(0);
          expect(shaft.bearer, 'место за последней поставленной фигурой').toBeLessThan(f.figures);
          // И древко стоит в клетке этого места: половина шага строя по обеим осям.
          const spot = figureSpot(f, shaft.bearer, Math.sign(f.z) || 1);
          expect(Math.abs(shaft.x - spot.x), 'вышло из клетки по фронту').toBeLessThanOrEqual(FILE_STEP / 2);
          expect(Math.abs(shaft.z - spot.z), 'вышло из клетки по глубине').toBeLessThanOrEqual(RANK_STEP / 2);
          checked++;
        }
      }
    }
    // Проверка самой проверки: лес где-то всё-таки стоял, иначе тест пустой.
    expect(checked, 'леса не было ни на одном кадре — проверять нечего').toBeGreaterThan(1000);
    view.dispose();
  });

  it('леса нет там, где строя нет: за флангом и позади последней шеренги', () => {
    const cast = fight(armyMix(600), armyMix(600));
    const view = new MassView(capacity(cast));
    for (const frame of frames(cast, 0.5)) {
      for (const shaft of place(view, forced(cast, frame), frame.couch)) {
        const f = frame.sectors[shaft.sector];
        const back = Math.sign(f.z) || 1;
        const files = Math.max(1, f.files);
        // За флангом: блок шире своих шеренг быть не может.
        expect(Math.abs(shaft.x - (f.x + f.dx)), 'древко за флангом').toBeLessThanOrEqual((files * FILE_STEP) / 2);
        // Позади: глубже последнего ПОСТАВЛЕННОГО ряда земля пустая.
        const ranks = Math.ceil(f.figures / files);
        const deep = (shaft.z - (f.z + f.dz)) * back;
        expect(deep, 'древко впереди строя').toBeGreaterThanOrEqual(-RANK_STEP / 2 - 1e-9);
        expect(deep, 'древко позади строя').toBeLessThanOrEqual((ranks - 1) * RANK_STEP + RANK_STEP / 2 + 1e-9);
      }
    }
    view.dispose();
  });

  it('рядом с конницей древков нет ни на одном такте', () => {
    // Два войска: со смешанной конницей и с одной конницей. Ни в начале, ни на
    // ударе, ни в бегстве древка у всадника быть не может.
    for (const cast of [fight(armyMix(600), armyMix(600)), fight({ cavalry: 300 }, { spear: 300 })]) {
      const view = new MassView(capacity(cast));
      for (const frame of frames(cast, 0.25)) {
        for (const shaft of place(view, forced(cast, frame), frame.couch)) {
          expect(kindAt(frame.sectors[shaft.sector], shaft.bearer), 'древко у всадника').not.toBe('cavalry');
        }
      }
      view.dispose();
    }
  });

  it('чисто конный сектор не несёт леса вовсе', () => {
    const cast = fight({ cavalry: 400 }, { spear: 400 });
    let horseSectors = 0;
    for (const c of cast.sectors) {
      if (c.figures === 0 || !c.byFace.every((face) => face.kind === 'cavalry')) continue;
      horseSectors++;
      expect(c.shafts, `${c.side}/${c.sector}`).toBe(0);
    }
    expect(horseSectors, 'конных секторов не нашлось — проверять нечего').toBeGreaterThan(0);
  });
});

describe('древко соразмерно бойцу', () => {
  it('ни одно древко не длиннее копья, которое держал бы его хозяин', () => {
    // Доля роста одна на оружие в руке и на лес: `SPEAR_LEN` из `units.ts`.
    // Двух длин одного копья нет, поэтому и разойтись им негде.
    const spear = MAN_HEIGHT * SPEAR_LEN;
    expect(spear).toBeGreaterThan(MAN_HEIGHT);
    expect(spear).toBeLessThan(MAN_HEIGHT * 1.5);

    const cast = fight(armyMix(400), armyMix(400));
    const view = new MassView(capacity(cast));
    let seen = 0;
    for (const frame of frames(cast, 0.5)) {
      for (const shaft of place(view, forced(cast, frame), frame.couch)) {
        expect(shaft.h, 'древко длиннее копья в руке').toBeLessThanOrEqual(spear + 1e-9);
        // И не обрубок: короче человека это уже не копьё.
        expect(shaft.h, 'древко короче бойца').toBeGreaterThan(MAN_HEIGHT);
        seen++;
      }
    }
    expect(seen).toBeGreaterThan(100);
    view.dispose();
  });
});

describe('лес включается по видимому размеру, а не по такту камеры', () => {
  it('пока боец крупнее порога — древков нет ни одного', () => {
    const cast = fight(armyMix(600), armyMix(600));
    for (const frame of frames(cast, 0.25)) {
      for (const f of frame.sectors) {
        if (f.manPx >= SHAFT_PX.off) expect(f.shafts, `${f.sector} ${f.manPx.toFixed(0)}px`).toBe(0);
      }
    }
    expect(shaftShare(SHAFT_PX.off)).toBe(0);
    expect(shaftShare(SHAFT_PX.on)).toBe(1);
  });

  it('видимый размер — чистая геометрия камеры, а не номер такта', () => {
    const cast = fight(armyMix(600), armyMix(600));
    // Тот же сектор на близком плане крупнее, чем на стратегическом.
    const near = frameAt(cast, cast.acts[0].from + 1).sectors.find((s) => s.side === cast.us && s.sector === 'B')!;
    const far = frameAt(cast, cast.acts[1].to).sectors.find((s) => s.side === cast.us && s.sector === 'B')!;
    expect(near.manPx).toBeGreaterThan(far.manPx * 1.5);
    // Вдвое дальше — вдвое мельче.
    const shot = far === near ? frameAt(cast, 0).shot : frameAt(cast, cast.acts[1].to).shot;
    expect(manPixels(shot, 20)).toBeCloseTo(manPixels(shot, 40) * 2, 6);
    // Дальнее войско всегда мельче ближнего: лес встанет в нём раньше.
    const field = frameAt(cast, cast.acts[2].from);
    const ours = field.sectors.filter((s) => s.side === cast.us).reduce((n, s) => n + s.manPx, 0);
    const theirs = field.sectors.filter((s) => s.side !== cast.us).reduce((n, s) => n + s.manPx, 0);
    expect(ours).toBeGreaterThan(theirs);
  });
});
