// Регион игрока по клетке его города (docs/city.md, 15) — своим маленьким модулем: его читает холст игры (`GameCanvas`) в первой
// загрузке, а погода (`weather.ts`) и климат (`render/climate`) нужны только сцене города, карте и промыслам — их кускам. Дверь та же:
// погода отдаёт его реэкспортом.
import { useWorld } from '@/world/store';
import { homeTheatre } from '@/world/theatre/theatre';

/** Регион игрока по клетке его города; мира ещё нет — `null` (погода умеренной суши). */
export function homeRegion(): string | null {
  const home = useWorld.getState().info?.home;
  return home ? (homeTheatre(home)?.id ?? null) : null;
}
