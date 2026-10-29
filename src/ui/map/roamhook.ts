// Крючок карты бродяги (ПН-3, docs/gdd/path_of_sword.md, 5.2, 5.4): карта лорда и карта бродяги — один экран (`WorldMap`), а
// всё бродяжье — знаки отряда, лагеря и руин, касание клетки отрядом в руке, окно хода — едет своим куском (`ui/map/roam/`) и
// вешается сюда, пока кусок открыт. Карта спрашивает крючок только за `ROAM_ON`: у лорда его нет, и кадр с касанием — прежние.
import type { Coord } from '@/world/types';
import type { Camera, Viewport } from './grid';

export interface RoamHook {
  /** Дорисовать бродяжье поверх кадра. `true` — отряд в пути: кадр нужен по часам. */
  paint(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, dpr: number, now: number): boolean;
  /** Касание клетки: `true` — карта бродяги его взяла. */
  tap(c: Coord): boolean;
}

let hook: RoamHook | null = null;

export const setRoamHook = (h: RoamHook | null): void => {
  hook = h;
};

export const roamHook = (): RoamHook | null => hook;

/**
 * Крючок видимости (ПН-4у): чужие отряды бродяг и их следы — у лорда и у бродяги, своим куском (`ui/map/roam/BandsLayer`). Карта
 * спрашивает его только за `ROAM_ON`.
 */
export interface SightHook {
  paint(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, dpr: number, now: number): void;
  /** Касание клетки: `true` — там чужой отряд или его след, и карта бродяги сказала о нём. */
  tap(c: Coord): boolean;
}

let sightHookNow: SightHook | null = null;

export const setSightHook = (h: SightHook | null): void => {
  sightHookNow = h;
};

export const sightHook = (): SightHook | null => sightHookNow;

/** Разбудить стоящую карту (ПН-4у): чужие отряды и следы меняются ответом сервера, а не кадром. Будильник ставит карта. */
let wakeNow: (() => void) | null = null;

export const setMapWake = (fn: (() => void) | null): void => {
  wakeNow = fn;
};

export const wakeMap = (): void => wakeNow?.();
