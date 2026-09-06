// Фигуры на поле: кто где стоит и во что одет. Одевание — существующее
// (`render/units.ts`), примитивы и инстансы — существующие (`render/figures.ts`).
// Своих моделей эта пачка не заводит: она про режиссуру, а не про красоту.
//
// Кто чем вооружён, здесь не решается: вид бойца выводится из рода боя, а всё
// остальное — из `TroopDef.gear`, как и на карточке вида. Второй таблицы «у
// щитоносца щит» в бою быть не должно.
import type { Sector, Side, UnitKind } from '@/battle/types';
import type { CastSector, SectorFrame } from '@/battle/replay';
import type { TroopId } from '@/game/types';
import { Figure, FigurePool } from '../figures';
import { poseFigure, type Action } from '../poses';
import { dressSoldier } from '../units';
import { PALETTE } from '../palette';

/**
 * Кем показывается род боя. Ядро знает четыре рода, племя — восемь видов, и в
 * журнале боя состава по видам нет: там только роды. Пока показываем род его
 * самым узнаваемым представителем — во второй пачке сюда придёт настоящий
 * состав похода, когда он появится в записи боя.
 */
export const FACE_OF: Record<UnitKind, TroopId> = {
  spear: 'spearman',
  infantry: 'swordsman',
  archer: 'archer',
  cavalry: 'rider',
};

/** Наши в синем, чужие в красном: на стратегическом плане стороны различаются цветом. */
const CLOTH: Record<'ours' | 'theirs', number> = {
  ours: PALETTE.paintBlue,
  theirs: PALETTE.paintRed,
};

/** Шаг между бойцами в блоке сектора. */
const STEP = 0.85;

/** Одна фигура на поле: её место в блоке и очередь падения. */
interface Man {
  figure: Figure;
  /** Смещение от центра сектора. */
  dx: number;
  dz: number;
  /** Каким по счёту падает: павшие обязаны быть разбросаны по блоку, а не сзади. */
  order: number;
}

/** Блок фигур одного сектора. */
export class SectorTroops {
  readonly side: Side;
  readonly sector: Sector;
  private men: Man[] = [];

  constructor(cast: CastSector, us: Side, pool: FigurePool) {
    this.side = cast.side;
    this.sector = cast.sector;
    const cloth = cast.side === us ? CLOTH.ours : CLOTH.theirs;
    // Роды раскладываются подряд: копья слева, лучники справа — блок читается.
    const kinds: UnitKind[] = [];
    for (const k of ['spear', 'infantry', 'archer', 'cavalry'] as UnitKind[]) {
      for (let i = 0; i < cast.byKind[k]; i++) kinds.push(k);
    }
    const n = kinds.length;
    const cols = Math.max(1, Math.round(Math.sqrt(n * 1.7)));
    kinds.forEach((kind, i) => {
      const f = new Figure();
      // Фаза шага — от места в строю, а не от Math.random: тот же журнал обязан
      // давать тот же ролик, включая то, какой ногой шагает третий слева.
      f.phase = ((i * 37) % 100) / 7;
      dressSoldier(f, FACE_OF[kind], cloth);
      f.visible = false;
      pool.add(f);
      const col = i % cols;
      const row = Math.floor(i / cols);
      const rows = Math.ceil(n / cols);
      this.men.push({
        figure: f,
        dx: (col - (cols - 1) / 2) * STEP,
        dz: (row - (rows - 1) / 2) * STEP,
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
