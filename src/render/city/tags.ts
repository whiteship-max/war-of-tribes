// Ярлыки у лесов (docs/gems.md, «Ускорение»): место над стройкой, куда интерфейс кладёт кнопку «Ускорить». Сцена только
// ставит место на кадр — над главной точкой постройки (`sites.mainSite`), как надписи добычи (`pops.ts`); что в нём
// лежит, решает интерфейс (`ui/next/SiteTags.tsx`, порталом). Так кнопка одна на окно постройки и на леса, а сцена не
// знает ни алмазов, ни цены. Доска мест — `render/sitetags.ts`: интерфейс читает её, не трогая куска города.
//
// Слой касаний не берёт — берёт только сам ярлык. За спиной камеры ярлыка нет; за краем кадра — тоже: тянуть кнопку к
// краю, как надпись добычи, незачем — до стройки рукой подать в окне постройки.
import type * as THREE from 'three';
import type { BuildingTypeId } from '@/game/types';
import { setSiteTagHosts } from '../sitetags';

interface Tag {
  type: BuildingTypeId;
  el: HTMLDivElement;
  x: number;
  y: number;
  z: number;
}

export class SiteTags {
  private root: HTMLDivElement | null = null;
  private tags: Tag[] = [];

  /** `v` — вектор для проекции (без three в рантайме, как у `CityPops`). */
  constructor(
    host: HTMLElement | null,
    private v: THREE.Vector3,
  ) {
    if (!host || typeof document === 'undefined') return;
    const root = document.createElement('div');
    root.className = 'city-tags';
    host.appendChild(root);
    this.root = root;
  }

  /** Стройки сейчас: над какими точками мира стоять ярлыкам. Тот же набор — ничего не трогается. */
  set(list: readonly { type: BuildingTypeId; x: number; y: number; z: number }[]): void {
    const root = this.root;
    if (!root) return;
    const want = new Set(list.map((t) => t.type));
    const had = new Set(this.tags.map((t) => t.type));
    if (want.size === had.size && [...want].every((t) => had.has(t))) {
      for (const t of this.tags) Object.assign(t, list.find((x) => x.type === t.type));
      return;
    }
    for (const t of this.tags) if (!want.has(t.type)) t.el.remove();
    this.tags = list.map((p) => {
      const old = this.tags.find((t) => t.type === p.type);
      if (old) return { ...old, x: p.x, y: p.y, z: p.z };
      const el = document.createElement('div');
      el.className = 'city-tag';
      el.style.visibility = 'hidden';
      root.appendChild(el);
      return { type: p.type, el, x: p.x, y: p.y, z: p.z };
    });
    setSiteTagHosts(new Map(this.tags.map((t) => [t.type, t.el])));
  }

  /** Ярлыки — над своими точками на этот кадр. `w`, `h` — размер холста в точках CSS. */
  update(camera: THREE.Camera, w: number, h: number): void {
    for (const t of this.tags) {
      const v = this.v.set(t.x, t.y, t.z).project(camera);
      const x = ((v.x + 1) / 2) * w;
      const y = ((1 - v.y) / 2) * h;
      const off = v.z > 1 || x < 0 || x > w || y < 0 || y > h;
      t.el.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
      t.el.style.visibility = off ? 'hidden' : '';
    }
  }

  dispose(): void {
    this.root?.remove();
    this.root = null;
    this.tags = [];
    setSiteTagHosts(new Map());
  }
}
