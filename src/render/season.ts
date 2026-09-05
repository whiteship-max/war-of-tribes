// Сезонная перекраска сцены. Смена сезона не переключает цвета, а переливает их
// за пару секунд: земля, кроны, крыши, туман и небо едут к новой палитре вместе.
// Сами цвета живут в palette.ts (SEASON_OVERRIDES); здесь только движение к ним.
import * as THREE from 'three';
import type { Season } from '@/game/types';
import { DECAL, KIT, LEGACY, type DecalKey, type MatKey } from './materials';
import { PALETTE, SEASONAL_KEYS, SEASON_SNOW, SEASON_SUN_ARC, seasonColor } from './palette';

/** Переиспользуемый цвет: lerp вызывается по разу на материал каждый кадр. */
const TMP = new THREE.Color();

/** Постоянная времени перелива: ~3τ ≈ 2.5 с до новой палитры. */
const TAU = 0.85;

/** Что переливать: сезонные ключи палитры, у которых есть материал. */
const TARGETS = SEASONAL_KEYS.filter((k): k is MatKey => k in LEGACY);
const DECAL_TARGETS = SEASONAL_KEYS.filter((k): k is DecalKey => k in DECAL);

/**
 * Держит текущее состояние палитры и подтягивает его к сезону каждый кадр.
 * Материалы общие на всю сцену, поэтому красим их на месте — все наборы сразу.
 */
export class SeasonVisuals {
  /** Цвет дневного неба текущего сезона. */
  readonly sky = new THREE.Color(PALETTE.sky);
  /** Цвет дымки: в неё уходит дальний край мира. */
  readonly fog = new THREE.Color(PALETTE.fog);
  /** Цвет солнца: летом белее, зимой бледнее. */
  readonly sun = new THREE.Color(PALETTE.sunDay);
  /** Высота солнечной дуги: зимой солнце ниже, тени длиннее. */
  sunArc = 1;
  /** 0 — снега нет, 1 — полная зима. Гонит частицы, дым и длину ночи. */
  snow = 0;
  private started = false;

  /**
   * Поставить сезон мгновенно, без перелива. Сцена зовёт это при первой
   * синхронизации с состоянием: первый кадр она рисует ещё до него, с весной по
   * умолчанию, и без прыжка партия открывалась бы с перелива к своему сезону.
   */
  jump(season: Season): void {
    this.started = false;
    this.update(season, 0);
  }

  update(season: Season, dt: number): void {
    // Первый кадр ставим палитру мгновенно: иначе партия начинается с перелива.
    const k = this.started ? 1 - Math.exp(-dt / TAU) : 1;
    this.started = true;
    for (const key of TARGETS) {
      TMP.setHex(seasonColor(season, key));
      KIT[key].color.lerp(TMP, k);
      LEGACY[key].color.lerp(TMP, k);
    }
    for (const key of DECAL_TARGETS) DECAL[key].color.lerp(TMP.setHex(seasonColor(season, key)), k);
    this.sky.lerp(TMP.setHex(seasonColor(season, 'sky')), k);
    this.fog.lerp(TMP.setHex(seasonColor(season, 'fog')), k);
    this.sun.lerp(TMP.setHex(seasonColor(season, 'sunDay')), k);
    this.sunArc += (SEASON_SUN_ARC[season] - this.sunArc) * k;
    this.snow += (SEASON_SNOW[season] - this.snow) * k;
  }
}
