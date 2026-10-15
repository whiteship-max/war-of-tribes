// Дверь «к источнику» в действии: открыть постройку, раздел шторки, раздел державы или промыслы (`kit/sources`).
// Одна на набор: строки разбора, ссылки подсказок и кнопки «Склад ›» ведут через неё, и каждая ведёт одинаково.
import { useGame } from '@/game/store';
import { buildingOfType } from '@/game/derived';
import { useRealm } from '@/ui/realm/open';
import { useTrades } from '@/ui/trades';
import { useTreasury } from '@/ui/treasury';
import type { Source } from './sources';
import type { TipGo } from '@/ui/next/hudTips';

/**
 * Открыть источник. С карты сначала в город: шторки и держава живут над городом (как низ, `next/Nav`). Раздел шторки,
 * который уже открыт, не закрывается: `openTab` — переключатель, и дверь «к источнику», нажатая из него же, иначе
 * закрыла бы окно вместо того, чтобы его показать. Постройки в городе нет — дверь молчит (`reachable`).
 */
export function goTo(src: Source): void {
  const g = useGame.getState();
  if (g.mapOpen) g.closeMap();
  switch (src.kind) {
    case 'building': {
      // Ратуша — тоже постройкой, а не `openTownHall`: тот переключатель и закрыл бы уже открытую.
      const b = buildingOfType(g.s, src.type);
      if (b) g.openBuilding(b.id);
      return;
    }
    case 'tab': {
      const cur = g.sheet;
      if (cur?.kind === 'tab' && cur.tab === src.tab) return;
      g.openTab(src.tab);
      return;
    }
    case 'realm':
      useRealm.getState().show(src.view);
      return;
    case 'trades':
      useTrades.getState().show();
      return;
    case 'treasury':
      useTreasury.getState().show('buy');
      return;
    case 'build': {
      // Вкладкой, а не `openTownHall`: тот переключатель закрыл бы ратушу, уже открытую на «Стройке».
      const hall = buildingOfType(g.s, 'town_hall');
      if (!hall) return;
      g.setTownTab('build');
      g.openBuilding(hall.id);
      return;
    }
  }
}

/** Есть ли куда вести: постройка стоит в городе, «Стройка» — пока стоит ратуша (разделы и окна есть всегда). */
export function reachable(src: Source): boolean {
  const s = useGame.getState().s;
  if (src.kind === 'building') return buildingOfType(s, src.type) !== null;
  if (src.kind === 'build') return buildingOfType(s, 'town_hall') !== null;
  return true;
}

/**
 * Двери подсказок (`hudTips.TipGo`) — через одну дверь набора: раздел шторки, постройка, раздел державы, любая дверь. Окна,
 * что строят подсказки верха у себя (держава «Указы»), берут двери здесь, а не собирают их своим объектом.
 */
export function tipGo(): TipGo {
  return {
    tab: (t) => goTo({ kind: 'tab', tab: t }),
    building: (id) => useGame.getState().openBuilding(id),
    realm: (v) => goTo({ kind: 'realm', view: v }),
    to: goTo,
  };
}
