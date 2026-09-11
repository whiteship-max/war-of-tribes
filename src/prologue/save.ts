/**
 * Что предыстория помнит между заходами.
 *
 * СВОЙ КЛЮЧ, А НЕ СОХРАНЕНИЕ ПАРТИИ, И ЭТО РЕШЕНИЕ, А НЕ УДОБСТВО.
 *
 * Сохранение племени (`game/save.ts`) уезжает на сервер одной строкой, и всё,
 * что в него положено, становится общим на все устройства и получает версию,
 * миграции и цену ошибки в потерянных партиях. Предыстории там делать нечего
 * по трём причинам сразу:
 *
 *   - её состояние не имеет отношения к деревне и в неё не переходит — связи с
 *     основной игрой в этом куске нет вовсе и заводить её нельзя;
 *   - на сервер она не едет: так поставлена задача;
 *   - поднимать версию партии под неё было бы неправдой — формат партии не
 *     менялся, и старые сохранения приводить не к чему.
 *
 * Поэтому здесь отдельный ключ и отдельная маленькая версия — тем же способом,
 * каким рядом живут переключатель музыки и сохранение мира. Не прочиталось,
 * не то, из будущей версии — начинаем сначала: терять тут нечего, а падать в
 * чёрный экран из-за строки в localStorage нельзя.
 *
 * ВЕРСИЮ НОВЫЕ ПОЛЯ НЕ ПОДНИМАЮТ, и это то же правило, что у партии: голод,
 * холод, охота и мясо приезжают к старой записи со значениями по умолчанию, и
 * человек в ней оказывается сытым и в тепле. Иначе игрок, зашедший через
 * неделю, получил бы шкалы, отсчитанные от чужой минуты, — то есть умер бы за
 * то, что мы дописали код.
 *
 * ВРЕМЯ ЗДЕСЬ ОДНО И ТОЛЬКО НАШЕ. Все отметки — `serverNow()` из
 * `net/clock.ts`, единственной двери к «сейчас». Записывается не «сколько
 * осталось», а «сколько было и когда»: остальное считается на чтении
 * (`fire.ts`, `body.ts`, `hunt.ts`, `glade.ts`), и потому запись может
 * случиться в любую минуту или не случиться вовсе.
 */
import { serverNow } from '@/net/clock';
import { newHearth, type Hearth } from './fire';
import { WOUNDS_FATAL, camp, newBody, type Body } from './body';
import { HOUSE_LOGS, houseDone } from './craft';
import { TREES } from './glade';
import { newHunt, type Hunt, type Pt } from './hunt';

const KEY = 'tribe.prologue.v1';

/** Версия формата. Своя, маленькая, к версии партии отношения не имеет. */
export const PROLOGUE_VERSION = 1;

/** Что человек несёт и что у него в запасе. */
export interface Larder {
  /** Жареное: восемь часов сытости за кусок. */
  cooked: number;
  /** Сырое: втрое меньше (`RAW_SHARE`), зато есть его можно где угодно. */
  raw: number;
}

/** Сколько кусков вяленого мяса лежит у палатки первой поляны. */
export const KIT_MEAT = 3;

export interface PrologueSave {
  v: number;
  hearth: Hearth;
  body: Body;
  hunt: Hunt;
  /** Полен в руках. */
  logs: number;
  /** Взят ли топор с пня. */
  axe: boolean;
  /** Разобраны ли пожитки у палатки: лук, стрелы и вяленое мясо. */
  kit: boolean;
  /** Стрел в колчане. Вместе с воткнувшимися в землю их число не меняется никогда. */
  quiver: number;
  /** Стрелы, воткнувшиеся в землю: их подбирают. */
  arrows: Pt[];
  meat: Larder;
  /**
   * Когда свалено дерево — по одному числу на дерево, 0 у нетронутого.
   * Стоит оно сейчас или уже отросло, считает `glade.standing`.
   */
  felled: number[];
  /**
   * Когда отбили последнюю стаю волков. 0 — ни разу.
   *
   * Одно число на всех волков, и второго не нужно: из него выводится и тишина
   * после драки, и то, что стая ушла (`wolves.packAt`). Где они стоят и что
   * делают — время кадров и в запись не идёт вовсе.
   */
  wolvesBeatenAt: number;
  /**
   * Сколько брёвен уже стоит в доме.
   *
   * Одно целое число на весь дом, и второго не нужно: из него выводится и
   * ступень стройки, и то, достроен ли дом, и укрытие. Растёт ровно на
   * положенное из рук (`craft.buildTake`) и не убывает ничем.
   */
  house: number;
  /** Шкур в руках: снятых с туши и ещё не сшитых. */
  hides: number;
}

/** Новая предыстория: костёр початый, топор на пне, пожитки у палатки, лес цел. */
export function freshPrologue(now = serverNow()): PrologueSave {
  return {
    v: PROLOGUE_VERSION,
    hearth: newHearth(now),
    body: newBody(now),
    hunt: newHunt(),
    logs: 0,
    axe: false,
    kit: false,
    quiver: 0,
    arrows: [],
    meat: { cooked: 0, raw: 0 },
    felled: TREES.map(() => 0),
    wolvesBeatenAt: 0,
    house: 0,
    hides: 0,
  };
}

/**
 * Новое утро после смерти.
 *
 * ЧТО ПРОПАДАЕТ: запас мяса и дрова в руках. Больше ничего — и это не поблажка,
 * а расчёт. Терять в предыстории по-настоящему нечего: пни отрастают, очаг
 * наполняется, зверь приходит снова. Единственное, что игрок вправду копит, —
 * **еда**, потому что ею он покупает право уйти из игры на сутки. Её и забирает
 * смерть: вернувшийся застаёт пустую кладовую и следующие два захода не сидит у
 * огня, а охотится.
 *
 * ЧТО ОСТАЁТСЯ: топор, лук и стрелы — все, включая воткнувшиеся в землю
 * («собрал по поляне»). Отобрать их значило бы отобрать возможность добыть еду,
 * то есть замкнуть петлю смертей; человек, потерявший всё на пятой минуте,
 * второй раз не придёт. Пни и туша остаются как были: земле всё равно, кто по
 * ней ходит.
 *
 * КОСТЁР РАЗЖИГАЕТСЯ ЗАНОВО на два полена — столько же, сколько у новой поляны.
 * Проснуться у холодного очага значило бы начать новое утро с той же смерти:
 * холод пошёл бы расти с первой секунды, а дров в руках нет.
 *
 * И ПО ТОЙ ЖЕ ПРИЧИНЕ НОВОЕ УТРО НАЧИНАЕТСЯ ТИХИМ: волки уходят на `WOLF_GAP_MS`,
 * как после отбитой стаи. Иначе загрызенный открывал бы глаза в двух шагах от
 * той же пары зубов — а это и есть замкнутая петля смертей, которой в режиме
 * быть не должно. Тишина даётся при любой смерти, не только от волков: разбирать
 * тут нечего, а объяснять игроку, почему после голода волки есть, а после зубов
 * нет, — тем более.
 *
 * ДОМ И ОДЕЖДА ОСТАЮТСЯ, ШКУРЫ В РУКАХ — НЕТ. Дом стоит на земле, а земле всё
 * равно, кто по ней ходит; одежда на человеке — вещь, как топор и лук. Шкура в
 * руках — запас, как мясо и дрова, и пропадает вместе с ними.
 */
export function revive(s: PrologueSave, now = serverNow()): PrologueSave {
  return {
    ...s,
    hearth: newHearth(now),
    body: { ...newBody(now), coat: s.body.coat },
    logs: 0,
    hides: 0,
    meat: { cooked: 0, raw: 0 },
    // Стрелы собраны с поляны все до одной: их число — величина, которая не
    // меняется ни от чего, кроме нашей ошибки (`hunt.test.ts` это и стережёт).
    quiver: s.quiver + s.arrows.length,
    arrows: [],
    wolvesBeatenAt: now,
  };
}

const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

const count = (v: unknown): number => Math.max(0, Math.floor(num(v, 0)));

/** Точки на земле: битая запись не должна ронять поляну. */
const points = (v: unknown): Pt[] => {
  if (!Array.isArray(v)) return [];
  const out: Pt[] = [];
  for (const p of v as Partial<Pt>[]) {
    if (typeof p?.x === 'number' && typeof p?.z === 'number' && Number.isFinite(p.x) && Number.isFinite(p.z)) {
      out.push({ x: p.x, z: p.z });
    }
  }
  return out;
};

/**
 * Прочитать сохранение.
 *
 * Всё, что не сошлось, молча заменяется свежим: чужая версия, битая строка,
 * localStorage под запретом (приватное окно и вебвью такое умеют). Спрашивать
 * игрока тут не о чем — режим временный и прогресса в нём на три минуты.
 */
export function loadPrologue(now = serverNow()): PrologueSave {
  const fresh = freshPrologue(now);
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh;
    const p = JSON.parse(raw) as Partial<PrologueSave>;
    if (p?.v !== PROLOGUE_VERSION) return fresh;
    return {
      v: PROLOGUE_VERSION,
      hearth: {
        fuel: num(p.hearth?.fuel, fresh.hearth.fuel),
        at: num(p.hearth?.at, now),
      },
      body: {
        hunger: Math.min(1, Math.max(0, num(p.body?.hunger, 0))),
        cold: Math.min(1, Math.max(0, num(p.body?.cold, 0))),
        hurt: Math.min(WOUNDS_FATAL, Math.max(0, num(p.body?.hurt, 0))),
        coat: p.body?.coat === true,
        at: num(p.body?.at, now),
        // Отметка «грелся» с диска не читается вовсе — её там и нет: между
        // заходами человек на стоянке, и почему так, написано в `body.ts`.
        warm: true,
        // И крыша — та же стоянка: достроен дом — ночевал в нём.
        roof: houseDone(Math.min(HOUSE_LOGS, count(p.house))),
      },
      hunt: {
        killedAt: num(p.hunt?.killedAt, 0),
        carcass:
          p.hunt?.carcass && Number.isFinite(p.hunt.carcass.x) && Number.isFinite(p.hunt.carcass.z)
            ? {
                x: p.hunt.carcass.x,
                z: p.hunt.carcass.z,
                taken: count(p.hunt.carcass.taken),
                // Туша из записи, сделанной до шкур, лежит со шкурой: её можно снять.
                skinned: p.hunt.carcass.skinned === true,
              }
            : null,
      },
      logs: count(p.logs),
      axe: p.axe === true,
      kit: p.kit === true,
      quiver: count(p.quiver),
      arrows: points(p.arrows),
      meat: { cooked: count(p.meat?.cooked), raw: count(p.meat?.raw) },
      // Длина списка идёт от нынешней поляны, а не от записи: деревьев могло
      // стать больше, и лишние обязаны оказаться стоящими, а не undefined.
      felled: TREES.map((_, i) => num(p.felled?.[i], 0)),
      wolvesBeatenAt: num(p.wolvesBeatenAt, 0),
      house: Math.min(HOUSE_LOGS, count(p.house)),
      hides: count(p.hides),
    };
  } catch {
    return fresh;
  }
}

/**
 * Записать.
 *
 * Отметка человека закрывается здесь же и ложится на диск «у костра» — правило
 * целиком в `body.ts`, и держится оно этой строкой. Отсюда важное следствие:
 * `savePrologue` **не трогает** переданное состояние. В памяти отметка остаётся
 * настоящей (человек и правда стоит у дерева), на диске — стояночной, и разницы
 * между ними ровно столько, сколько игрок ещё не ушёл.
 *
 * Неудача записи — не повод падать: в приватном окне её и не бывает.
 */
export function savePrologue(s: PrologueSave, now = serverNow()): void {
  try {
    const out: PrologueSave = { ...s, body: camp(s.body, s.hearth, now, houseDone(s.house)) };
    localStorage.setItem(KEY, JSON.stringify(out));
  } catch {
    /* некуда писать — значит, играем эту сессию и всё */
  }
}

/** Начать предысторию заново — служебное, для проверки с телефона. */
export function resetPrologue(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* нечего убирать */
  }
}

/** Сколько стрел у человека всего: в колчане и на земле. Величина неизменная. */
export const arrowsTotal = (s: PrologueSave): number => s.quiver + s.arrows.length;

/** Сколько кусков мяса всего. */
export const meatTotal = (s: PrologueSave): number => s.meat.cooked + s.meat.raw;
