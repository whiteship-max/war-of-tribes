// Память покоев на устройстве (docs/city_v3.md, Г-7): остался ли кот и где лёг, о чём говорили со слугой, служанкой и
// супругой, и рычаг «Сцены для взрослых». Это вид, а не партия: в сохранение и на сервер не едет, договора не трогает;
// пропала память (приватное окно, чужое устройство) — кота нет и разговоры с начала, игра от этого не меняется.
import type { LifeMemory } from '@/render/chambers/life';
import { freshMemory, type TalkMemory } from './talk';

const KEY = 'tribe.chambers.life';

export interface ChambersMemory {
  life: LifeMemory;
  talk: TalkMemory;
}

/** Прочитать память покоев для дома `house` (сменился правитель — разговоры с начала, кот остаётся). */
export function loadMemory(house: string): ChambersMemory {
  let raw: unknown = null;
  try {
    raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
  } catch {
    raw = null;
  }
  const r = (raw ?? {}) as Partial<ChambersMemory>;
  const life: LifeMemory = {
    cat: r.life?.cat === true,
    catSpot: r.life?.catSpot === 'hearth' || r.life?.catSpot === 'bed' || r.life?.catSpot === 'sill' ? r.life.catSpot : null,
  };
  const t = r.talk;
  const f = freshMemory(house);
  // Группы — по отдельности: запись старше нового поля не оставит его пустым.
  const talk: TalkMemory =
    t && t.v === 1 && t.house === house
      ? { ...f, ...t, servant: { ...f.servant, ...t.servant }, maid: { ...f.maid, ...t.maid }, wife: { ...f.wife, ...t.wife }, refused: { ...f.refused, ...t.refused } }
      : f;
  return { life, talk };
}

export function saveMemory(m: ChambersMemory): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(m));
  } catch {
    /* память устройства недоступна — покои забудут, игра нет */
  }
}

export { adultScenes, setAdultScenes } from './adult';
