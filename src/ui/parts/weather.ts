// Погода игрока сейчас (docs/city.md, 15): регион — по клетке его города, часы — общие (`serverNow`), сезон и фаза солнца
// — партии. Одна дверь на подсказку верхней полосы, звук города и сцену: регион и «откуда море» считаются здесь, а не
// каждым своим кодом.
import type { GameState } from '@/game/types';
import { dayFraction, seasonOf, solarPhase } from '@/game/derived';
import { serverNow } from '@/net/clock';
import { useWorld } from '@/world/store';
import { homeRegion } from './region';
import { isWaterAt, landShare } from '@/world/land';
import type { Coord } from '@/world/types';
import { flashes, forcedFlashes, forcedWeather, lyingSnow, weatherAt, weatherWords, zoneOf, type Flash, type Weather, type Zone } from '@/render/climate';

/** Регион игрока — своим модулем (`region.ts`): его читает холст игры в первой загрузке, а погода с климатом едут кусками. */
export { homeRegion };

/** Сколько клеток в сторону ветра смотрим на море и сколько из них должно быть водой. */
const SEA_REACH = 6;
const SEA_NEED = 3;

/** Море с той стороны, откуда дует (`from`, градусы от севера по часовой): клетки мира — x на восток, y на юг. */
export function seaSide(home: Coord, from: number): boolean {
  const r = (from * Math.PI) / 180;
  const dx = Math.sin(r);
  const dy = -Math.cos(r);
  let water = 0;
  for (let k = 1; k <= SEA_REACH; k++) if (isWaterAt(Math.round(home.x + dx * k), Math.round(home.y + dy * k))) water++;
  return water >= SEA_NEED;
}

/**
 * До моря — не дальше дня пути: столько клеток (по 6 км с небольшим, `atlas/project.KM_PER_CELL`) от дома. Ближе есть
 * вода атласа — рыбалка у моря; нет — у реки (она течёт у каждого города, docs/city.md). День пути — довод из
 * структуры: все двадцать пять мест Сицилии (`world/spawn.SICILY`) — в 2–8 клетках от моря, и слово владельца «у Сицилии
 * — море» выполняется числом, а не исключением (docs/minigames.md, 17).
 */
export const SHORE_REACH = 8;

/** Где рыбачить: у моря или у реки — по клетке дома. */
export const shoreAt = (home: Coord): 'river' | 'sea' => (landShare(home.x, home.y, SHORE_REACH) < 1 ? 'sea' : 'river');

/** Берег адресом (`?shore=sea|river`) — стенду и проверке на телефоне, как погода адресом. */
const forcedShore = (): 'river' | 'sea' | null => {
  if (typeof location === 'undefined') return null;
  const v = new URLSearchParams(location.search).get('shore');
  return v === 'sea' || v === 'river' ? v : null;
};

/** Берег и климатический пояс игрока; мира ещё нет — река умеренной суши. */
export function homeWater(): { shore: 'river' | 'sea'; zone: Zone } {
  const home = useWorld.getState().info?.home;
  return { shore: forcedShore() ?? (home ? shoreAt(home) : 'river'), zone: zoneOf(homeRegion()) };
}

/** Погода адресом (`?weather=rain`) — та же, что у сцены: стенду и проверке на телефоне. */
const forced = (): Weather | null => (typeof location === 'undefined' ? null : forcedWeather(location.search));

/** Погода над городом игрока в этот миг. */
export function weatherNow(s: GameState): Weather {
  const season = seasonOf(s.time);
  return forced() ?? weatherAt(homeRegion(), serverNow(), season, solarPhase(dayFraction(s.time), season));
}

/** Снег на земле у города игрока зимой, 0..1; не зима — 0. */
export function coverNow(s: GameState): number {
  return seasonOf(s.time) === 'winter' ? lyingSnow(homeRegion(), serverNow(), forced()) : 0;
}

/** Молнии над городом игрока, чьи миги лежат в `[from, to)` мс общих часов, — грому. */
export function flashesNow(s: GameState, from: number, to: number): Flash[] {
  const f = forced();
  return f ? forcedFlashes(f.storm, from, to) : flashes(homeRegion(), seasonOf(s.time), from, to);
}

/** Подсказка: «Дождь, ветер с моря». */
export function weatherLine(s: GameState): string {
  const home = useWorld.getState().info?.home;
  const season = seasonOf(s.time);
  const solar = solarPhase(dayFraction(s.time), season);
  const night = solar > 0.52 && solar < 0.97;
  return weatherWords(weatherNow(s), home ? (from) => seaSide(home, from) : undefined, night);
}
