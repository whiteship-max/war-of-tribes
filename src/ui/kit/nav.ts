// Дверь «к источнику» в действии: открыть постройку, раздел шторки, раздел державы или промыслы (`kit/sources`).
// Одна на набор: строки разбора, ссылки подсказок и кнопки «Склад ›» ведут через неё, и каждая ведёт одинаково.
import { useGame } from '@/game/store';
import { buildingOfType } from '@/game/derived';
import { useRealm } from '@/ui/realm/open';
import { useTrades } from '@/ui/trades';
import type { Source } from './sources';

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
  }
}

/** Есть ли куда вести: постройка стоит в городе (разделы и окна есть всегда). */
export function reachable(src: Source): boolean {
  return src.kind !== 'building' || buildingOfType(useGame.getState().s, src.type) !== null;
}
