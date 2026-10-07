// Погода игрока сейчас (docs/city.md, 15): регион — по клетке его города, часы — общие (`serverNow`), сезон и фаза солнца
// — партии. Одна дверь на подсказку верхней полосы, звук города и сцену: регион и «откуда море» считаются здесь, а не
// каждым своим кодом.
import type { GameState } from '@/game/types';
import { dayFraction, seasonOf, solarPhase } from '@/game/derived';
import { serverNow } from '@/net/clock';
import { useWorld } from '@/world/store';
import { homeTheatre } from '@/world/theatre/theatre';
import { isWaterAt } from '@/world/land';
import type { Coord } from '@/world/types';
import { flashes, forcedFlashes, forcedWeather, weatherAt, weatherWords, type Flash, type Weather } from '@/render/climate';

/** Регион игрока по клетке его города; мира ещё нет — `null` (погода умеренной суши). */
export function homeRegion(): string | null {
  const home = useWorld.getState().info?.home;
  return home ? (homeTheatre(home)?.id ?? null) : null;
}

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

/** Погода адресом (`?weather=rain`) — та же, что у сцены: стенду и проверке на телефоне. */
const forced = (): Weather | null => (typeof location === 'undefined' ? null : forcedWeather(location.search));

/** Погода над городом игрока в этот миг. */
export function weatherNow(s: GameState): Weather {
  const season = seasonOf(s.time);
  return forced() ?? weatherAt(homeRegion(), serverNow(), season, solarPhase(dayFraction(s.time), season));
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
