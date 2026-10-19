// Двери предметов стола (docs/city_v3.md, Г-4): тронул предмет — открылось настоящее окно игры, той же дверью, что у её
// кнопок (`kit/nav.goTo`, держава, карта, сокровищница). Своей копии окон у покоев нет: закрыл окно — снова за столом.
import { useGame } from '@/game/store';
import { useRealm } from '@/ui/realm/open';
import { useTreasury } from '@/ui/treasury';
import { goTo } from '@/ui/kit/nav';
import type { Door } from '@/render/chambers/plan';

/** Какое окно открывает дверь — словами, для подписи и проверки. */
export const DOOR_WINDOW: Record<Door, string> = {
  news: 'Вести',
  map: 'Карта',
  decrees: 'Держава',
  people: 'Жители',
  army: 'Дружина',
  build: 'Ратуша',
  treasury: 'Сокровищница',
  arms: 'Герб державы',
};

export function openDoor(d: Door): void {
  switch (d) {
    case 'news':
      useRealm.getState().show('decisions');
      return;
    case 'map':
      useGame.getState().openMap();
      return;
    case 'decrees':
      useRealm.getState().show('government');
      return;
    case 'people':
      goTo({ kind: 'tab', tab: 'people' });
      return;
    case 'army':
      goTo({ kind: 'tab', tab: 'army' });
      return;
    case 'build':
      goTo({ kind: 'build' });
      return;
    case 'treasury':
      useTreasury.getState().show('shop');
      return;
    case 'arms':
      // Печать с гербом — в окно профиля: герб собирают там (П-2, `parts/ArmsMaker`; профиль — своё окно, ЗН-4).
      useRealm.getState().show('settings');
      return;
  }
}
