// Покои правителя (docs/city_v3.md, Г-4): предметы стола открывают настоящие окна игры, выход возвращает в город, входы —
// из Тайника (донжон) и из державы. Сцена — подделкой с теми же рычагами (`enterInside`, `leaveInside`): WebGL в узле нет.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useGame } from '@/game/store';
import { buildingOfType } from '@/game/derived';
import { useRealm } from '@/ui/realm/open';
import { useTreasury } from '@/ui/treasury';
import { cityAudio } from '@/sound/city';
import { DESK_THINGS, type DeskId } from '@/render/chambers/plan';
import { useChambers } from './open';
import { DOOR_WINDOW, openDoor } from './doors';
import { __chambers } from './Chambers';

// Окна игры зовут отклик Телеграма (`haptic`): ему нужен `window`, в узле — пустой (как у `transition.test.ts`).
(globalThis as { window?: unknown }).window ??= {};

/** Задание владельца: письма → Вести, карта → Карта, свиток указов → Держава, список людей → Жители, перечень войска →
 *  Дружина, планы построек → Ратуша; кошель и печать — свои двери (Сокровищница, герб державы). */
const WANT: Record<DeskId, string> = {
  letters: 'Вести',
  map: 'Карта',
  decrees: 'Держава',
  people: 'Жители',
  army: 'Дружина',
  plans: 'Ратуша',
  purse: 'Сокровищница',
  seal: 'Герб державы',
};

function calm(): void {
  useGame.setState({ sheet: null, mapOpen: false });
  useRealm.setState({ open: false });
  useTreasury.setState({ open: false });
}

/** Какое окно игры сейчас открыто — словами `DOOR_WINDOW`. */
function openWindow(): string | null {
  const g = useGame.getState();
  const r = useRealm.getState();
  if (g.mapOpen) return 'Карта';
  if (useTreasury.getState().open) return 'Сокровищница';
  if (r.open) return r.view === 'decisions' ? 'Вести' : r.view === 'government' ? 'Держава' : r.view === 'settings' ? 'Герб державы' : `держава: ${r.view}`;
  const sh = g.sheet;
  if (sh?.kind === 'tab') return sh.tab === 'people' ? 'Жители' : sh.tab === 'army' ? 'Дружина' : `шторка: ${sh.tab}`;
  if (sh?.kind === 'building') {
    const hall = buildingOfType(g.s, 'town_hall');
    return hall && sh.id === hall.id && g.townTab === 'build' ? 'Ратуша' : `постройка ${sh.id}`;
  }
  return null;
}

afterEach(() => {
  __chambers.fall();
  useChambers.setState({ open: false });
  calm();
});

describe('покои: двери стола', () => {
  it('каждый предмет стола открывает своё настоящее окно игры — то, что назвал владелец', () => {
    for (const t of DESK_THINGS) {
      calm();
      expect(DOOR_WINDOW[t.door], `${t.id}: подпись двери`).toBe(WANT[t.id]);
      openDoor(t.door);
      expect(openWindow(), `${t.name}`).toBe(WANT[t.id]);
    }
  });

  it('касание предмета в комнате ведёт той же дверью: из кресла письма открывают «Вести»', () => {
    const scene = fakeScene();
    const live = __chambers.rise(scene as never);
    expect(live, 'покои встали').not.toBeNull();
    const room = __chambers.live()!;
    room.snap('desk');
    calm();
    const letters = DESK_THINGS.find((t) => t.id === 'letters')!;
    room.act({ kind: 'thing', thing: letters });
    expect(openWindow()).toBe('Вести');
  });
});

describe('покои: вход и выход', () => {
  it('вход закрывает окна города; выход «В город» возвращает сцену в город и отдаёт звук', () => {
    useGame.setState({ sheet: { kind: 'tab', tab: 'people' }, mapOpen: true });
    useRealm.setState({ open: true });
    useChambers.getState().show();
    expect(useChambers.getState().open).toBe(true);
    expect(openWindow(), 'окна города закрыты').toBe(null);
    const hush = vi.spyOn(cityAudio, 'hush');
    const scene = fakeScene();
    __chambers.rise(scene as never);
    const room = __chambers.live();
    expect(scene.enterInside).toHaveBeenCalledWith(room);
    expect(hush).toHaveBeenLastCalledWith('chambers', true);
    // «‹ Город» — рычаг `hide`: комната уходит из сцены, город звучит снова.
    useChambers.getState().hide();
    expect(scene.leaveInside).toHaveBeenCalledWith(room);
    expect(__chambers.live()).toBe(null);
    expect(hush).toHaveBeenLastCalledWith('chambers', false);
    hush.mockRestore();
  });

  it('пока город не встал, покоев нет: подъём ждёт донжона', () => {
    const scene = { ...fakeScene(), keep: () => null };
    expect(__chambers.rise(scene as never)).toBe(null);
    expect(scene.enterInside).not.toHaveBeenCalled();
  });

  it('входы: строка «Покои правителя» в окне Тайника (донжон) и «В покои» у правителя в державе', () => {
    const panel = readFileSync(join(__dirname, '../panels/BuildingPanel.tsx'), 'utf8');
    const cache = panel.slice(panel.indexOf("case 'cache':"), panel.indexOf('default:', panel.indexOf("case 'cache':")));
    expect(cache).toMatch(/label="Покои правителя"/);
    expect(cache).toMatch(/useChambers\.getState\(\)\.show\(\)/);
    const realm = readFileSync(join(__dirname, '../realm/RealmTabs.tsx'), 'utf8');
    const ruler = realm.slice(realm.indexOf('export function RulerNew()'));
    expect(ruler).toMatch(/useChambers\.getState\(\)\.show\(\)[\s\S]{0,120}В покои/);
    // Донжон города — постройка Тайника: касание башни открывает его окно (`city/budget.towerOwner`).
    const owners = readFileSync(join(__dirname, '../../render/city/budget.ts'), 'utf8');
    expect(owners).toMatch(/k === 'keep' \? 'cache'/);
  });
});

/** Сцена города глазами покоев — подделка: донжон, вход и выход. */
function fakeScene() {
  return {
    quality: 'low' as const,
    keep: () => ({ kind: 'keep', x: -4, z: -147, out: -Math.PI / 2, size: 13, height: 30, base: 16, seed: 1 }),
    cityShare: () => null,
    enterInside: vi.fn(() => true),
    leaveInside: vi.fn(),
  };
}
