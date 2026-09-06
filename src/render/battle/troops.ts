// Фигуры на поле: кто где стоит и во что одет. Одевание — существующее
// (`render/units.ts`), примитивы и инстансы — существующие (`render/figures.ts`).
// Своих моделей эта пачка не заводит.
//
// Кем показывается боец, здесь не решается: метку даёт раскадровка, а что метка
// значит — знает мост (`game/battle/faces.ts`). Таблицы «род показывается таким-то
// видом» в рендере нет и быть не должно: она врала бы ровно тогда, когда игрок
// собрал что-то другое. Чем боец вооружён, по-прежнему выводится из `TroopDef.gear`.
import type { Sector, Side } from '@/battle/types';
import { FILE_STEP, RANK_STEP, type CastSector, type SectorFrame } from '@/battle/replay';
import { wearOf } from '@/game/battle/faces';
import { Figure, FigurePool } from '../figures';
import { poseFigure, type Action } from '../poses';
import { FOLK_KINDS, dressSoldier, dressVillager } from '../units';
import { PALETTE } from '../palette';

/**
 * Наши в синем, чужие в красном. Цвет стороны один на всех деталях бойца,
 * включая щит (см. `dressSoldier`), и тот же цвет несут знамёна: по кадру
 * должно быть видно, где чьё войско, без единой подписи.
 */
const CLOTH = { ours: PALETTE.paintBlue, theirs: PALETTE.paintRed } as const;

export const CLOTH_OF = (ours: boolean): number => (ours ? CLOTH.ours : CLOTH.theirs);

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
    const files = cast.files;

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
        // Передняя шеренга стоит РОВНО на месте сектора, ряды уходят назад. Если
        // центрировать блок, глубокий строй перешагивает линию соприкосновения,
        // и синие с красными перемешиваются — по кадру тогда не понять, где чей
        // фронт. Глубина за это платит `FIELD.rowGap`, и тест это держит.
        dz: rank * RANK_STEP * back,
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
    // Бегут не по команде: паника расходится по строю, и каждый срывается со
    // своего мгновения. Порядок тот же, что у падения, — от края блока внутрь.
    const runners = frame.flee > 0 ? Math.ceil(frame.figures * Math.min(1, frame.flee * 2.2)) : 0;
    this.men.forEach((m, i) => {
      const f = m.figure;
      f.visible = i < frame.figures;
      if (!f.visible) return;
      const down = m.order < fallen;
      const runs = !down && m.order >= fallen && m.order < fallen + runners;
      // Бегущий уходит с поля своим ходом, а не телепортируется вместе с блоком:
      // сектор смещается целиком, а он ещё и отстаёт от него по-своему.
      const lag = runs ? (1 - (m.order - fallen) / Math.max(1, runners)) * 0.9 : 0;
      const back = frame.side === us ? -1 : 1;
      f.position.set(frame.x + frame.dx + m.dx, 0, frame.z + frame.dz + m.dz - back * lag);
      f.rotationY = facing + (runs ? Math.PI : away);
      f.down = down ? 1 : 0;
      poseFigure(f, down ? 'fall' : runs ? 'walk' : action, t);
    });
  }

  dispose(pool: FigurePool): void {
    for (const m of this.men) pool.remove(m.figure);
    this.men = [];
  }
}
