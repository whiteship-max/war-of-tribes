// Занятость показывает здание, а не человек: у работающей кузницы и у церкви с людьми из трубы идёт дым
// (у города — над трубой здания, `CityScene.workSmoke`). Признак загорается, когда в здании есть рабочие, и
// гаснет, когда их нет, — это и есть весь язык. Грузы у стен и горн в модели были у посёлка и ушли вместе с
// ним (docs/city.md, «Город — единственный вид»).
import type { Building, BuildingTypeId, GameState } from '@/game/types';
import { handsCount, workerCount } from '@/game/derived';

export interface Sign {
  /** Дым из трубы. Все трубы — одно облако точек: один вызов на всех. */
  smoke?: boolean;
}

/** Признак занятости по типу здания: только у тех, где есть кому работать (`job` в data/buildings.ts). */
export const WORK_SIGN: Partial<Record<BuildingTypeId, Sign>> = {
  church: { smoke: true },
  smithy: { smoke: true },
};

/**
 * Работает ли здание — по этому зажигается его признак (у города — дым над трубой, `CityScene.workSmoke`).
 * Склад — исключение по запасам (`full` — закрома полны на виду), кузница — по заказам: кузнецы у горна без
 * заказа не работают. Двор, где работают одни невольники, работает: признак зажигают руки на местах.
 */
export const workBusy = (s: GameState, b: Building, full: boolean): boolean =>
  b.type === 'storage' ? full : b.type === 'smithy' ? workerCount(s, b.id) > 0 && (s.forge?.length ?? 0) > 0 : handsCount(s, b.id) > 0;
