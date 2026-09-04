// Состояние экрана карты. Здесь и только здесь мир соединяется с интерфейсом:
// компоненты читают этот стор, а он ходит в worldApi(). Ни один экран не знает,
// что за интерфейсом сейчас стоит LocalWorld.
import { create } from 'zustand';
import { useGame } from '@/game/store';
import { haptic } from '@/telegram/webapp';
import { hasWorldApi, setWorldApi, worldApi } from './api';
import { LocalWorld } from './local/LocalWorld';
import { applyEffects, playerProfile, syncAway } from './bridge';
import { DEFENSE_FREEZE } from './data/tuning';
import {
  cachedChunk,
  chunkKeysIn,
  chunkRect,
  clearCache,
  clearPending,
  isPending,
  isStale,
  markPending,
  putChunk,
  settlementAt,
  terrainAt,
} from './cache';
import type {
  Coord,
  MarchOrder,
  MarchView,
  Rect,
  Report,
  SettlementCard,
  Terrain,
  TribeInfo,
  WorldInfo,
} from './types';

/** Как часто мир опрашивается. Достаточно редко, чтобы не мешать симуляции племени. */
const PULSE_MS = 2000;

export interface WorldStore {
  ready: boolean;
  info: WorldInfo | null;
  marches: MarchView[];
  reports: Report[];
  unread: number;
  tribes: TribeInfo[];
  /** Время мира на последнем пульсе. */
  now: number;
  selected: Coord | null;
  card: SettlementCard | null;
  /** Ландшафт выбранной клетки — карточка пустой клетки живёт на нём одном. */
  cardTerrain: Terrain | null;
  cardLoading: boolean;
  /** Счётчик приехавших кусков карты: по нему перерисовывается полотно. */
  chunks: number;
  boot: () => Promise<void>;
  pulse: () => Promise<void>;
  ensureRegion: (rect: Rect) => void;
  select: (c: Coord) => Promise<void>;
  refreshCard: () => Promise<void>;
  send: (order: MarchOrder) => Promise<string | null>;
  recall: (id: string) => Promise<void>;
  loadReports: () => Promise<void>;
  markRead: () => Promise<void>;
  /** Новый мир с нуля — рядом с «начать заново» у племени. */
  resetWorld: () => Promise<void>;
}

let timer: ReturnType<typeof setInterval> | null = null;
/** Поправка часов мира к местным. У локального мира она нулевая, у сервера — нет. */
let clockOffset = 0;

/** Время мира прямо сейчас: таймеры походов идут между пульсами. */
export const worldNow = (): number => Date.now() + clockOffset;

export const useWorld = create<WorldStore>((set, get) => ({
  ready: false,
  info: null,
  marches: [],
  reports: [],
  unread: 0,
  tribes: [],
  now: Date.now(),
  selected: null,
  card: null,
  cardTerrain: null,
  cardLoading: false,
  chunks: 0,

  boot: async () => {
    if (get().ready) return;
    if (!hasWorldApi()) setWorldApi(new LocalWorld());
    const info = await worldApi().info();
    set({ info, ready: true });
    await get().pulse();
    set({ tribes: await worldApi().tribes() });
    if (!timer) timer = setInterval(() => void get().pulse(), PULSE_MS);
  },

  pulse: async () => {
    if (!hasWorldApi()) return;
    const game = useGame.getState();
    const pulse = await worldApi().sync(playerProfile(game.s));

    // Число ушедших выводится из походов: правим состояние на месте, перерисовку
    // сделает ближайший тик симуляции — лишний рендер каждые две секунды не нужен.
    syncAway(game.s, pulse.marches);
    if (pulse.effects.length > 0) {
      useGame.getState().world((s) => applyEffects(s, pulse.effects));
      haptic('medium');
    }
    if (pulse.reports.length > 0) {
      useGame.getState().showToast(pulse.reports[0].title);
    }

    clockOffset = pulse.now - Date.now();
    set({ marches: pulse.marches, unread: pulse.unread, now: pulse.now });
    if (get().selected && get().card) void get().refreshCard();
  },

  ensureRegion: (rect) => {
    if (!hasWorldApi()) return;
    const now = Date.now();
    for (const { key, cx, cy } of chunkKeysIn(rect)) {
      const have = cachedChunk(key);
      if ((have && !isStale(have, now)) || isPending(key)) continue;
      markPending(key);
      void worldApi()
        .region(chunkRect(cx, cy))
        .then((chunk) => {
          putChunk(key, chunk, Date.now());
          set({ chunks: get().chunks + 1 });
        })
        .finally(() => clearPending(key));
    }
  },

  select: async (c) => {
    const view = settlementAt(c.x, c.y);
    set({ selected: c, card: null, cardTerrain: terrainAt(c.x, c.y), cardLoading: view !== null });
    useGame.getState().openWorldTile(c.x, c.y);
    if (!view) return;
    const card = await worldApi().settlement(view.id);
    // Пока ходили за карточкой, игрок мог выбрать другую клетку.
    const sel = get().selected;
    if (!sel || sel.x !== c.x || sel.y !== c.y) return;
    set({ card, cardLoading: false });
  },

  refreshCard: async () => {
    const card = get().card;
    if (!card) return;
    const fresh = await worldApi().settlement(card.id);
    if (fresh && get().card?.id === card.id) set({ card: fresh });
  },

  send: async (order) => {
    const res = await worldApi().send(order);
    if (res.error) {
      haptic('error');
      return res.error;
    }
    haptic('medium');
    // Племя ведёт счёт своим походам: по нему закрываются задания про карту.
    useGame.getState().world((s) => {
      if (order.mission === 'scout') s.stats.scouted = (s.stats.scouted ?? 0) + 1;
      if (order.mission === 'raid') s.stats.raids = (s.stats.raids ?? 0) + 1;
    });
    await get().pulse();
    await get().refreshCard();
    return null;
  },

  recall: async (id) => {
    const err = await worldApi().recall(id);
    if (err) {
      useGame.getState().showToast(err);
      return;
    }
    haptic('light');
    await get().pulse();
  },

  loadReports: async () => {
    set({ reports: await worldApi().reports() });
  },

  markRead: async () => {
    await worldApi().readReports();
    set({ unread: 0, reports: (await worldApi().reports()) });
  },

  resetWorld: async () => {
    clearCache();
    setWorldApi(new LocalWorld({ seed: Math.floor(Math.random() * 0x7fffffff) }));
    set({
      ready: false,
      info: null,
      marches: [],
      reports: [],
      unread: 0,
      tribes: [],
      selected: null,
      card: null,
      cardTerrain: null,
      chunks: get().chunks + 1,
    });
    await get().boot();
  },
}));

/** Свои походы — отдельно от чужих: их показывает список, их можно отозвать. */
export const ownMarches = (marches: MarchView[]): MarchView[] => marches.filter((m) => m.own);

/** Чужие отряды, идущие на деревню игрока. Ближайший по времени — первым. */
export const incomingMarches = (marches: MarchView[]): MarchView[] =>
  marches.filter((m) => m.hostile && m.phase === 'out').sort((a, b) => a.arriveAt - b.arriveAt);

/**
 * Заморозка обороны. Менять расстановку можно до отметки «минус пять минут» до
 * прихода чужой армии; после неё настройки заперты, и игроку это показывают, а
 * не игнорируют нажатия молча (раздел 8 документа).
 *
 * Считается здесь, чтобы у панели и у мира была одна формула: мир защёлкивает
 * ту же отметку у себя (`LocalWorld.lockDefense`).
 */
export interface DefenseLock {
  /** Ближайший чужой отряд или null. */
  march: MarchView | null;
  /** Секунд до прихода. */
  seconds: number;
  frozen: boolean;
}

export function defenseLock(marches: MarchView[], now: number): DefenseLock {
  const m = incomingMarches(marches)[0] ?? null;
  if (!m) return { march: null, seconds: 0, frozen: false };
  const left = m.arriveAt - now;
  return { march: m, seconds: Math.max(0, left / 1000), frozen: left <= DEFENSE_FREEZE };
}
