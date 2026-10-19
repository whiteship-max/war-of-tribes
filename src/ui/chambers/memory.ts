// Память покоев на устройстве (docs/city_v3.md, Г-7, Г-10): остался ли кот и где лёг, о чём говорили со слугой, служанкой
// и супругой, о чём уже доложил советник, и рычаг «Сцены для взрослых». Это вид, а не партия: в сохранение и на сервер не едет, договора не трогает;
// пропала память (приватное окно, чужое устройство) — кота нет и разговоры с начала, игра от этого не меняется.
import type { LifeMemory } from '@/render/chambers/life';
import { freshMemory, type TalkMemory } from './talk';
import { freshAdvisor, type AdvisorMemory } from './tidings';

const KEY = 'tribe.chambers.life';

export interface ChambersMemory {
  life: LifeMemory;
  talk: TalkMemory;
  /** Советник (Г-10): когда докладывал и о чём — служит державе, а не дому: новый правитель его не сбрасывает. */
  advisor: AdvisorMemory;
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
  const a = r.advisor;
  const advisor: AdvisorMemory =
    a && (typeof a.at === 'number' || a.at === null)
      ? { at: a.at, gold: typeof a.gold === 'number' ? a.gold : null, told: Array.isArray(a.told) ? a.told.filter((k): k is string => typeof k === 'string') : [] }
      : freshAdvisor();
  return { life, talk, advisor };
}

export function saveMemory(m: ChambersMemory): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(m));
  } catch {
    /* память устройства недоступна — покои забудут, игра нет */
  }
}

export { adultScenes, setAdultScenes } from './adult';
