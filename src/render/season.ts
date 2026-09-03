// Сезонная палитра сцены. Смена сезона не переключает цвета, а переливает их
// за пару секунд: земля, кроны, крыши, туман и небо едут к новой палитре вместе.
import * as THREE from 'three';
import type { Season } from '@/game/types';
import { MAT } from './terrain';
import { M as BUILD } from './buildings';

interface Palette {
  grass: number;
  grassDark: number;
  dirt: number;
  trunk: number;
  leaves: number;
  leaves2: number;
  bush: number;
  rock: number;
  soil: number;
  sprout: number;
  /** Крыши: солома, тёмная солома, шкуры, дранка и черепица поздних эпох. */
  thatch: number;
  thatchDark: number;
  hide: number;
  shingle: number;
  tile: number;
  /** Дневное небо и туман. */
  sky: number;
  /** Плотность снега: частицы, дым, белизна. */
  snow: number;
}

export const SEASON_PALETTE: Record<Season, Palette> = {
  spring: {
    grass: 0x6f9548,
    grassDark: 0x5b7f3c,
    dirt: 0x8a6a45,
    trunk: 0x6b4426,
    leaves: 0x3f7a3a,
    leaves2: 0x4f8f40,
    bush: 0x4c8a45,
    rock: 0x8f8a80,
    soil: 0x6b4a2e,
    sprout: 0x7fc24f,
    thatch: 0xc9a35a,
    thatchDark: 0xa8843f,
    hide: 0xa87b52,
    shingle: 0x4a4640,
    tile: 0xb4553a,
    sky: 0x9fc9e8,
    snow: 0,
  },
  summer: {
    grass: 0x7ca34a,
    grassDark: 0x65893a,
    dirt: 0x94724a,
    trunk: 0x6b4426,
    leaves: 0x36702f,
    leaves2: 0x498a38,
    bush: 0x458035,
    rock: 0x94908a,
    soil: 0x74522f,
    sprout: 0x8ecf52,
    thatch: 0xd9b264,
    thatchDark: 0xb89047,
    hide: 0xb08558,
    shingle: 0x514c45,
    tile: 0xc25f42,
    sky: 0x8fc4ea,
    snow: 0,
  },
  autumn: {
    grass: 0x94904a,
    grassDark: 0x7c7239,
    dirt: 0x7d6040,
    trunk: 0x5e3b21,
    leaves: 0xc07a28,
    leaves2: 0xd99a35,
    bush: 0xa8722c,
    rock: 0x8a857c,
    soil: 0x5f452a,
    sprout: 0xc9b04a,
    thatch: 0xbe9750,
    thatchDark: 0x9c7a39,
    hide: 0x9d7049,
    shingle: 0x453f39,
    tile: 0xa64e35,
    sky: 0xb6bfc4,
    snow: 0,
  },
  winter: {
    grass: 0xe6edf4,
    grassDark: 0xd0dae6,
    dirt: 0xb9c2cc,
    trunk: 0x53381f,
    leaves: 0xcfdae4,
    leaves2: 0xdfe8f0,
    bush: 0xc6d2dc,
    rock: 0xb8bcc2,
    soil: 0xa9b3bd,
    sprout: 0xcdd8e2,
    thatch: 0xe4e9ef,
    thatchDark: 0xcbd4dd,
    hide: 0xdbe0e6,
    shingle: 0xd6dbe1,
    tile: 0xe4ded9,
    sky: 0xa9b8c9,
    snow: 1,
  },
};

/** Переиспользуемый цвет: lerp вызывается по разу на материал каждый кадр. */
const TMP = new THREE.Color();

/** Постоянная времени перелива: ~3τ ≈ 2.5 с до новой палитры. */
const TAU = 0.85;

type MatKey = Exclude<keyof Palette, 'sky' | 'snow'>;

const TARGETS: Record<MatKey, THREE.MeshLambertMaterial> = {
  grass: MAT.grass,
  grassDark: MAT.grassDark,
  dirt: MAT.dirt,
  trunk: MAT.trunk,
  leaves: MAT.leaves,
  leaves2: MAT.leaves2,
  bush: MAT.bush,
  rock: MAT.rock,
  soil: BUILD.soil,
  sprout: BUILD.sprout,
  thatch: BUILD.thatch,
  thatchDark: BUILD.thatchDark,
  hide: BUILD.hide,
  shingle: BUILD.shingle,
  tile: BUILD.tile,
};

/**
 * Держит текущее состояние палитры и подтягивает его к сезону каждый кадр.
 * Материалы общие на всю сцену, поэтому красим их на месте.
 */
export class SeasonVisuals {
  /** Цвет дневного неба текущего сезона. */
  readonly sky = new THREE.Color(SEASON_PALETTE.spring.sky);
  /** 0 — снега нет, 1 — полная зима. Гонит частицы, дым и длину ночи. */
  snow = 0;
  private started = false;

  update(season: Season, dt: number): void {
    const p = SEASON_PALETTE[season];
    // Первый кадр ставим палитру мгновенно: иначе партия начинается с перелива.
    const k = this.started ? 1 - Math.exp(-dt / TAU) : 1;
    this.started = true;
    for (const key of Object.keys(TARGETS) as MatKey[]) {
      TARGETS[key].color.lerp(TMP.setHex(p[key]), k);
    }
    this.sky.lerp(TMP.setHex(p.sky), k);
    this.snow += (p.snow - this.snow) * k;
  }
}
