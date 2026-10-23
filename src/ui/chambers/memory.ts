// Память покоев на устройстве (docs/city_v3.md, Г-7, Г-10): остался ли кот и где лёг, о чём говорили со слугой, служанкой
// и супругой, о чём уже сказали гонец и советник (ПК-1), и рычаг «Сцены для взрослых». Это вид, а не партия: в сохранение и на сервер не едет, договора не трогает;
// пропала память (приватное окно, чужое устройство) — кота нет и разговоры с начала, игра от этого не меняется.
import type { LifeMemory } from '@/render/chambers/life';
import { freshMemory, type TalkMemory } from './talk';
import { freshCourt, type CourtMemory } from './court';
import type { Moment, Tiding } from './tidings';

const KEY = 'tribe.chambers.life';

export interface ChambersMemory {
  life: LifeMemory;
  talk: TalkMemory;
  /** Двор (ПК-1): когда правитель был в покоях, что сказано и что отложено — служит державе, а не дому: новый правитель его не сбрасывает. */
  court: CourtMemory;
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
  return { life, talk, court: readCourt((r as { court?: unknown }).court) };
}

const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isMoment = (x: unknown): x is Moment => !!x && num((x as Moment).game) && num((x as Moment).world) && num((x as Moment).real);
const isTiding = (x: unknown): x is Tiding => {
  const t = x as Tiding;
  return !!t && typeof t.id === 'string' && typeof t.kind === 'string' && typeof t.clock === 'string' && num(t.at) && typeof t.ref === 'string';
};

/** Память двора — по полям: битое поле — пустое, а не вся память (прежняя память советника Г-10 не читается: её мера — игровые часы). */
function readCourt(raw: unknown): CourtMemory {
  const c = (raw ?? {}) as Partial<CourtMemory>;
  const f = freshCourt();
  const stamps: Record<string, number> = {};
  if (c.stamps && typeof c.stamps === 'object') for (const [k, v] of Object.entries(c.stamps)) if (num(v)) stamps[k] = v;
  return {
    seenAt: num(c.seenAt) ? c.seenAt : f.seenAt,
    out: isMoment(c.out) ? c.out : f.out,
    told: Array.isArray(c.told) ? c.told.filter((k): k is string => typeof k === 'string') : f.told,
    later: Array.isArray(c.later) ? c.later.filter(isTiding) : f.later,
    stamps,
  };
}

export function saveMemory(m: ChambersMemory): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(m));
  } catch {
    /* память устройства недоступна — покои забудут, игра нет */
  }
}

export { adultScenes, setAdultScenes } from './adult';
