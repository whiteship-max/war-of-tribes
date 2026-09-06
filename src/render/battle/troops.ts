// Фигуры на поле: кто где стоит и во что одет. Одевание — существующее
// (`render/units.ts`), примитивы и инстансы — существующие (`render/figures.ts`).
// Своих моделей эта пачка не заводит.
//
// Кем показывается боец, здесь не решается: метку даёт раскадровка, а что метка
// значит — знает мост (`game/battle/faces.ts`). Таблицы «род показывается таким-то
// видом» в рендере нет и быть не должно: она врала бы ровно тогда, когда игрок
// собрал что-то другое. Чем боец вооружён, по-прежнему выводится из `TroopDef.gear`.
import type { Sector, Side } from '@/battle/types';
import type { CastSector, SectorFrame } from '@/battle/replay';
import { wearOf } from '@/game/battle/faces';
import { Figure, FigurePool } from '../figures';
import { poseFigure, type Action } from '../poses';
import { FOLK_KINDS, dressSoldier, dressVillager } from '../units';
import { PALETTE } from '../palette';

/** Наши в синем, чужие в красном: на стратегическом плане стороны различаются цветом. */
const CLOTH = { ours: PALETTE.paintBlue, theirs: PALETTE.paintRed } as const;

/**
 * Строй, а не толпа. Интервал в шеренге — плечом к плечу, дистанция между
 * рядами чуть больше: так фронт читается фронтом, а не россыпью.
 */
const FILE_STEP = 0.62;
const RANK_STEP = 0.74;

/**
 * Глубина строя растёт с числом бойцов — не фигур. Фигур на сторону всегда не
 * больше `FIGURE_CAP`, и по ним массы не видно; а ряды видно сразу: сотня стоит
 * в два ряда, восемь сотен — в четыре. Это и есть то, чем глубина показывает массу.
 *
 * Больше четырёх рядов нельзя: блок сектора вылезет за `FIELD.rowGap` и сядет
 * на тыловой сектор своей же полосы.
 */
export const RANK_MEN = 30;
export const MAX_RANKS = 4;

export function ranksFor(men: number, figures: number): number {
  if (figures <= 1) return 1;
  const byMen = Math.min(MAX_RANKS, Math.max(1, Math.floor(Math.log2(Math.max(1, men) / RANK_MEN)) + 1));
  // Глубже, чем позволяет число фигур, строй не ставим: три фигуры в четыре
  // ряда — это колонна по одному, а не строй.
  return Math.max(1, Math.min(byMen, Math.round(Math.sqrt(figures))));
}

/** Одна фигура на поле: её место в строю и очередь падения. */
interface Man {
  figure: Figure;
  dx: number;
  dz: number;
  /** Каким по счёту падает: павшие обязаны быть разбросаны по блоку, а не сзади. */
  order: number;
}

/** Блок фигур одного сектора: шеренги и ряды. */
export class SectorTroops {
  readonly side: Side;
  readonly sector: Sector;
  private men: Man[] = [];

  constructor(cast: CastSector, us: Side, pool: FigurePool) {
    this.side = cast.side;
    this.sector = cast.sector;
    const cloth = cast.side === us ? CLOTH.ours : CLOTH.theirs;
    // Наша сторона стоит на −Z, чужая на +Z; ряды уходят назад от своего фронта.
    const back = cast.side === us ? -1 : 1;
    const n = cast.figures;
    const ranks = ranksFor(cast.men, n);
    const files = Math.max(1, Math.ceil(n / ranks));

    // Виды идут подряд: копья слева, лучники справа — строй читается по родам.
    const wears = cast.byFace.flatMap((f) => Array.from({ length: f.figures }, () => wearOf(f.id, f.kind)));
    wears.forEach((wear, i) => {
      const f = new Figure();
      // Фаза шага — от места в строю, а не от Math.random: тот же журнал обязан
      // давать тот же ролик, включая то, какой ногой шагает третий слева.
      f.phase = ((i * 37) % 100) / 7;
      if (wear.wear === 'folk') dressVillager(f, i % FOLK_KINDS);
      else dressSoldier(f, wear.troop, cloth);
      f.visible = false;
      pool.add(f);
      // Заполняем шеренгами: первый ряд слева направо, потом второй. Тогда
      // недобранный блок на отъезде — это ровный фронт без задних рядов, а не
      // колонна по одному.
      const file = i % files;
      const rank = Math.floor(i / files);
      this.men.push({
        figure: f,
        dx: (file - (files - 1) / 2) * FILE_STEP,
        // Ряды центрируются на месте сектора: иначе блок вылез бы вперёд и
        // фронты сошлись бы раньше, чем по журналу.
        dz: (rank - (ranks - 1) / 2) * RANK_STEP * back,
        order: (i * 5 + 3) % Math.max(1, n),
      });
    });
  }

  /**
   * Кадр: сколько фигур поставлено, сколько из них на ногах, куда они смотрят.
   * Лишние прячутся, а не удаляются: пул пишет только видимые, и пустых мест в
   * буфере инстансов не остаётся.
   */
  apply(frame: SectorFrame, us: Side, action: Action, t: number): void {
    const facing = frame.side === us ? 0 : Math.PI;
    // Побежавший сектор развёрнут спиной к противнику — это видно с любого плана.
    const away = frame.broken ? Math.PI : 0;
    const fallen = frame.figures - frame.standing;
    this.men.forEach((m, i) => {
      const f = m.figure;
      f.visible = i < frame.figures;
      if (!f.visible) return;
      f.position.set(frame.x + m.dx, 0, frame.z + m.dz);
      f.rotationY = facing + away;
      const down = m.order < fallen;
      f.down = down ? 1 : 0;
      poseFigure(f, down ? 'fall' : frame.broken ? 'walk' : action, t);
    });
  }

  dispose(pool: FigurePool): void {
    for (const m of this.men) pool.remove(m.figure);
    this.men = [];
  }
}
