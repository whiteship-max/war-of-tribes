// Числа ролика боя в стиле Total War по уровням качества — одна дверь (docs/battle_tw.md, разделы 2 и 7).
//
// ЗДЕСЬ НЕТ НИ THREE, НИ БРАУЗЕРА, как у `render/quality.ts` и `city/spec.ts`: что уровень значит для ролика,
// решает таблица, а держит её тест подсчётом построенного (`budget.test.ts`), а не снимок. Второго места с
// числами уровня у ролика нет: две правды о том, сколько фигур стоит «средний», разошлись бы молча — и заметил бы
// это телефон, переставший держать кадр.
import type { Quality } from '../quality';

export interface TwSpec {
  /**
   * Фигур на сторону, не больше. Одна фигура — `k` бойцов ядра, и `k` один на весь бой
   * (`plan.ratioOf`): соотношение сил видно глазами, а не подписью.
   */
  perSide: number;
  /**
   * Тень бойцов: нет вовсе (пятно строя — земля под ним темнее) или заместителем — столбиком на фигуру,
   * которого видит только камера тени (docs/battle_tw.md, раздел 8). Полной тени нет ни на каком уровне:
   * она удвоила бы треугольники бойцов, а позы в тени на этом расстоянии не видно.
   */
  shadow: 'none' | 'proxy';
  /** Сторона карты теней лампы. */
  shadowMap: number;
  /** Мягкий край тени (девять выборок) или жёсткий (одна). */
  shadowSoft: boolean;
  /** Кадров запечённого клипа в секунду: между ними шейдер смешивает два соседних. */
  bakeFps: number;
  /** Деревьев на поле, не больше. */
  trees: number;
  /** Клеток плиты земли по стороне. */
  grid: number;
  /** Стрел в небе одновременно, не больше. */
  arrows: number;
  /** Место боя (docs/battle_tw.md, раздел 13): домов города за стеной и шатров лагеря, не больше. */
  houses: number;
  tents: number;
}

export const TW_SPEC: Record<Quality, TwSpec> = {
  low: { perSide: 150, shadow: 'none', shadowMap: 1024, shadowSoft: false, bakeFps: 12, trees: 90, grid: 72, arrows: 240, houses: 18, tents: 16 },
  medium: { perSide: 360, shadow: 'proxy', shadowMap: 2048, shadowSoft: true, bakeFps: 16, trees: 200, grid: 96, arrows: 480, houses: 34, tents: 28 },
  high: { perSide: 720, shadow: 'proxy', shadowMap: 2048, shadowSoft: true, bakeFps: 20, trees: 360, grid: 128, arrows: 900, houses: 56, tents: 44 },
};

/** Бюджет кадра по уровням — слово владельца (docs/battle_tw.md, раздел 7): вызовы, треугольники, текстуры. */
export const TW_BUDGET: Record<Quality, { calls: number; triangles: number; textureMB: number }> = {
  low: { calls: 140, triangles: 200_000, textureMB: 32 },
  medium: { calls: 180, triangles: 400_000, textureMB: 64 },
  high: { calls: 250, triangles: 800_000, textureMB: 128 },
};
