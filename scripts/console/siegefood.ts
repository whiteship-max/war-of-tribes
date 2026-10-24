// `npm run siege -- --derive` — вывод штрафа к добыче осады (ОС-1, docs/siege_v2.md, 23.3) по посёлкам мерки 1–10: тот же
// посёлок, что у консоли и отчётов (`console/town.townOf` → `autopilot.townAt`), те же двери добычи и прокорма, что у шага
// игры (`derived.grossFoodPerDay`, `foodConsumptionPerDay`), по сезонам второго года — зимой без смягчения первой. Своих
// формул хлеба здесь нет: таблица — что посёлок добывает и съедает в осаде, и какие штрафы из этого выходят.
import { foodConsumptionPerDay, grossFoodPerDay, seasonModsFor, seasonOf, yearOf } from '@/game/derived';
import { SEASONS, SEASON_SECONDS } from '@/game/data/seasons';
import type { GameState } from '@/game/types';
import { CUT_MAX, CUT_MID, CUT_MIN, CUT_RATIO_EVEN, CUT_RATIO_STRONG, CUT_RATIO_WEAK, EVEN_HUNGER_LATER, EVEN_LEVEL } from '@/world/data/siegefood';
import { siegeCut, yieldShare } from '@/world/siegefood';
import { townOf } from './town';

/** Средние за год (второй: зима без смягчения) добыча хлеба без штрафа и расход — в осаде и без неё, за игровой день. */
function yearOf2(g: GameState): { food: number; prod: number; eatSiege: number; eatBefore: number } {
  const start = SEASONS.length * SEASON_SECONDS;
  let prod = 0;
  let eatSiege = 0;
  let eatBefore = 0;
  for (let q = 0; q < SEASONS.length; q++) {
    const time = start + q * SEASON_SECONDS;
    const mods = seasonModsFor(seasonOf(time), yearOf(time));
    const at: GameState = { ...g, time };
    prod += grossFoodPerDay(at, mods);
    eatSiege += foodConsumptionPerDay({ ...at, siege: { byName: 'вывод', until: Number.MAX_SAFE_INTEGER, cut: CUT_MAX } }, mods);
    eatBefore += foodConsumptionPerDay({ ...at, siege: null }, mods);
  }
  const n = SEASONS.length;
  return { food: g.resources.food, prod: prod / n, eatSiege: eatSiege / n, eatBefore: eatBefore / n };
}

const f2 = (x: number): string => x.toFixed(2);
const f3 = (x: number): string => x.toFixed(3);

/** Таблица вывода: безубыточный штраф по уровням (→ `CUT_MIN`), штраф «втрое позже» у средней опоры (→ `CUT_MID`), кривая. */
export function deriveCut(): void {
  console.log('=== Вывод штрафа к добыче осады (ОС-1): посёлки мерки 1–10, средние за второй год ===');
  console.log('уровень · хлеб · добыча хлеба в день без штрафа · расход в осаде · расход до ОС-1 · безубыточный штраф');
  const rows = Array.from({ length: 10 }, (_, i) => {
    const level = i + 1;
    const y = yearOf2(townOf(level));
    const even = 1 - y.eatSiege / y.prod;
    console.log(`  L${level} · ${Math.round(y.food)} · ${y.prod.toFixed(0)} · ${y.eatSiege.toFixed(0)} · ${y.eatBefore.toFixed(0)} · ${f3(even)}`);
    return { level, ...y, even };
  });
  const weakest = rows.reduce((a, b) => (b.even < a.even ? b : a));
  const cutMin = Math.floor(weakest.even * 1000) / 1000;
  console.log(`слабый (×${f2(CUT_RATIO_WEAK)}): наибольший штраф, при котором каждый посёлок мерки за год кормится сам — L${weakest.level} ${weakest.even.toFixed(5)}, вниз до тысячных ${f3(cutMin)}; в коде ${f3(CUT_MIN)}`);
  const mid = rows.find((r) => r.level === EVEN_LEVEL)!;
  // До ОС-1: хлеб — ноль, расход — полный паёк бойца: голод через хлеб / расход. Цель — во столько-то раз позже.
  const before = mid.food / mid.eatBefore;
  const want = before * EVEN_HUNGER_LATER;
  const cutMid = 1 - (mid.eatSiege - mid.food / want) / mid.prod;
  console.log(
    `равные (×${f2(CUT_RATIO_EVEN)}): L${EVEN_LEVEL} до ОС-1 голод через ${before.toFixed(1)} игр. дн.; цель ×${EVEN_HUNGER_LATER} — ${want.toFixed(1)} игр. дн.: штраф ${cutMid.toFixed(5)}, до тысячных ${f3(Math.round(cutMid * 1000) / 1000)}; в коде ${f3(CUT_MID)}`,
  );
  console.log(`сильный (×${f2(CUT_RATIO_STRONG)}): штраф ${f2(CUT_MAX)} — поля за стеной, хлеб ноль, как до ОС-1`);
  console.log('во сколько раз голод позже, чем до ОС-1, при записанных штрафах (∞ — кормится сам):');
  for (const r of rows) {
    const at = (cut: number): string => {
      const net = r.eatSiege - r.prod * yieldShare(cut, true);
      return net > 0 ? `×${f2(r.eatBefore / net)}` : '∞';
    };
    console.log(`  L${r.level}: слабый ${at(CUT_MIN)} · равные ${at(CUT_MID)} · сильный ${at(CUT_MAX)}`);
  }
  console.log('кривая (сплайн Эрмита по логарифму соотношения, плоская за крайними точками):');
  for (const ratio of [0.5, CUT_RATIO_WEAK, 0.75, 0.85, 0.95, 1, 1.05, 1.15, 1.25, 1.4, CUT_RATIO_STRONG, 2]) {
    const cut = siegeCut(ratio);
    console.log(`  ×${f2(ratio)} → хлеб −${(cut * 100).toFixed(1)} %, прочее −${((1 - yieldShare(cut, false)) * 100).toFixed(1)} %`);
  }
}
