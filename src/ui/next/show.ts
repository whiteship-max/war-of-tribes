// «Показать в городе» (ОР-1, docs/ui_v2.md, 5.9) — одна дверь: лист ратуши и главные кнопки подсказок ведут через неё. Лежит в
// куске нового интерфейса, а не рядом с `kit/nav.goTo` и не в подсказках верха (`hudTips`): те едут в первой загрузке (их тянут
// держава и панели), и дверь с доской камеры подняла бы её (решение 11).
import type { BuildingTypeId } from '@/game/types';
import { useGame } from '@/game/store';
import { buildingOfType } from '@/game/derived';
import { askCam } from '@/render/sitetags';
import { BUILDINGS } from '@/game/data/buildings';
import { useRealm } from '@/ui/realm/open';
import { useTrades } from '@/ui/trades';
import { useTreasury } from '@/ui/treasury';
import type { TipContent } from './tip';

/**
 * Окна над городом уходят — шторка, держава, промыслы, сокровищница, карта, — и камера летит к постройке и подсвечивает её
 * (просьба доской `render/sitetags`, берёт её сцена города). Окна закрываются, потому что иначе показывать было бы некуда:
 * шторка во весь рост закрыла бы ту самую постройку. Постройки в городе нет — дверь молчит (как `kit/nav.reachable`).
 */
export function showInCity(type: BuildingTypeId): void {
  const g = useGame.getState();
  if (!buildingOfType(g.s, type)) return;
  if (g.mapOpen) g.closeMap();
  if (g.sheet) g.closeSheet();
  useRealm.getState().hide();
  useTrades.getState().hide();
  useTreasury.getState().hide();
  askCam({ kind: 'show', type });
}

/**
 * Подсказке — «Показать в городе» у каждой главной кнопки стоящей постройки. Кнопку подписывает именем постройки
 * (`BuildingDef.name`) сама подсказка (`hudTips.makers`); по имени — и тип. «Построить» метки не получает: постройки нет.
 */
export function withShow(t: TipContent): TipContent {
  if (!t.makers) return t;
  return {
    ...t,
    makers: t.makers.map((m) => {
      const def = m.build ? undefined : BUILDINGS.find((d) => d.name === m.label);
      return def ? { ...m, show: () => showInCity(def.id) } : m;
    }),
  };
}
