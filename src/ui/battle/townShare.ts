// Город игры для ролика осады и боя у города (docs/polish.md, П-6): план, текстуры и карты окна города, чтобы за стеной
// ролика встал тот же город. Есть он только у сцены города (`render/city/scene.ts`, `cityShare`); у общей оболочки сцены
// метода нет — её кусок едет в первой загрузке, и расти он не должен.
import type { TribeScene } from '@/render/Scene';
import type { CityShare } from '@/render/city/index';

export function townShare(scene: TribeScene | null): CityShare | null {
  const s = scene as (TribeScene & { cityShare?: () => CityShare | null }) | null;
  return s?.cityShare?.() ?? null;
}
