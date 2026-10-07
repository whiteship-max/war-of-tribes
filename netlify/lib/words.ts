/**
 * Слова сообщений бота — по виду и числам пункта, одним модулем (docs/NOTIFY.md, раздел 12). Свободного текста от
 * клиента сервер не принимает: клиент присылает вид, имя двора, участь и минуты, а слова собираются здесь, в минуту
 * отправки и в поясе игрока.
 *
 * Словарь — docs/ui_audit.md, раздел 4: город, набег (только входящее), отряд, лагерь, штурм, вылазка, удар,
 * донесение; на «ты», коротко, без восклицаний и без пересказа устройства игры. Чисел здесь два вида — минута
 * («в 14:40», поясом игрока) и ничего больше: потери и добыча устаревают и лежат в донесении (правило 18 — числа
 * нет, и считать его нечем).
 */
import { cityOr, type NoticeFate, type NoticeItem, type RatingRow } from './contract.js';
import { localTime } from './notify.js';
import { SICILY } from '../../src/world/spawn.js';
import { count } from '../../src/ui/parts/plural.js';

/** Подписи кнопки под сообщением: выключить, когда включено, и наоборот (решение владельца). */
export const BUTTON_OFF = 'Отключить уведомления';
export const BUTTON_ON = 'Включить уведомления';

/** Кнопка рядом — открыть игру (решение владельца 06.10.2026). */
export const BUTTON_OPEN = 'Открыть игру';

/** Что кнопка шлёт боту. Других данных у кнопок нет. */
export const CALLBACK_OFF = 'notify:off';
export const CALLBACK_ON = 'notify:on';

/** Ответ на нажатие — всплывающая строка в Telegram. */
export const SWITCHED_OFF = 'Уведомления выключены';
export const SWITCHED_ON = 'Уведомления включены';

/** «14:40» в поясе игрока. */
export function clock(ms: number, tz: string): string {
  const m = localTime(ms, tz).minute;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Что стало с городом — участью, уже случившейся. */
const FATE_DONE: Record<NoticeFate, string> = {
  plunder: 'Склад ограблен.',
  captives: 'Из города увели людей.',
  burn: 'Город сожжён.',
};

/** Слова пункта. `tz` — пояс получателя. */
export function noticeText(item: NoticeItem, tz: string): string {
  const p = item.p;
  const at = clock(p.about, tz);
  switch (item.kind) {
    // Ответить можно до самого прихода — срок один, «у стен в» (решение владельца 06.10.2026, docs/NOTIFY.md, 12.11).
    case 'raid':
      return `Набег из «${p.from}» идёт на твой город. У стен в ${at}.`;
    case 'raid-fight':
      return `Набег из «${p.from}» дошёл до твоего города в ${at}. Чем кончилось, смотри в донесении.`;
    case 'siege-fall':
      return `Хлеб в городе кончился в ${at}, и лагерь «${p.from}» взял город. ${FATE_DONE[p.fate]}`;
    case 'war':
      return `Отряд из города «${p.from}» идёт на твой город. У стен в ${at}. ${p.mode === 'storm' ? 'Идут на штурм.' : 'Идут осадить город.'}`;
    case 'war-fall':
      return p.role === 'atk'
        ? `Хлеб в городе «${p.from}» кончился. Город взят.`
        : `Хлеб в городе кончился. Отряд из «${p.from}» взял город. ${FATE_DONE[p.fate]}`;
    case 'war-fight':
      return fightText(item);
  }
}

/** Бой между игроками глазами получателя: `won` — победила ли его сторона. */
function fightText(item: NoticeItem): string {
  const { from, role, site, won, taken, fate } = item.p;
  if (site === 'wall') {
    if (role === 'atk') return won ? `Твой отряд взял город «${from}» штурмом.` : `Штурм города «${from}» отбит. Отряд идёт домой.`;
    if (won) return `Отряд из «${from}» штурмовал твой город. Штурм отбит.`;
    return taken ? `Отряд из «${from}» взял твой город штурмом. ${FATE_DONE[fate]}` : `Отряд из «${from}» штурмовал твой город и победил.`;
  }
  if (site === 'sortie') {
    if (role === 'def') return won ? `Вылазка удалась. Лагерь «${from}» разбит.` : `Вылазку отбили. Лагерь «${from}» стоит.`;
    return won ? `Вылазку из «${from}» отбили. Лагерь стоит.` : `Вылазка из «${from}» разбила твой лагерь.`;
  }
  // Удар полководца города по лагерю — один или с гарнизоном.
  if (role === 'def') return won ? `Удар по лагерю удался. Лагерь «${from}» разбит.` : `Удар по лагерю «${from}» отбит.`;
  return won ? `Удар по твоему лагерю под «${from}» отбит.` : `Твой лагерь под «${from}» разбит ударом.`;
}

// ------------------------------------------------ приветствие и итоги (docs/rating.md) ---

/** Мест на острове — столько, сколько их в данных мира (`world/spawn.SICILY`). */
const SICILY_PLACES = SICILY.length;

/** Ответ на `/start`: что за игра, коротко. Под ним — одна кнопка «Открыть игру» (`telegram.greet`). */
export function greeting(sicily: boolean): string {
  return [
    'TRIBE — стратегия о городе в Европе 1200 года.',
    'Строишь город, куёшь оружие, нанимаешь дружину и ходишь походами на логова и на соседей. Заход — несколько минут.',
    ...(sicily ? ['', `Сейчас идёт тест на Сицилии: до ${SICILY_PLACES} городов на одном острове, все против всех.`] : []),
  ].join('\n');
}

/** Сколько строк итоговой таблицы помещается в сообщение с запасом: игроков теста — до двенадцати. */
export const FINAL_ROWS = 30;

/** Строка таблицы: место, город, очки; под ней — из чего они. */
function finalRow(r: RatingRow): string {
  return [
    `${r.place}. «${cityOr(r.city)}» — ${count(r.points, 'очко', 'очка', 'очков')}`,
    `    мощь ${r.power}, ${count(r.won, 'победа', 'победы', 'побед')}, ${count(r.taken, 'город взят', 'города взято', 'городов взято')}`,
  ].join('\n');
}

/**
 * Итоговая таблица для игрока (`/final`). Первые `FINAL_ROWS` строк; своя строка, если ниже, — отдельно. `me` — строка
 * получателя; нет её (заморожен или не в реестре) — таблица без своего места.
 */
export function finalText(rows: RatingRow[], me: RatingRow | null): string {
  const top = rows.slice(0, FINAL_ROWS);
  return [
    'Тест окончен. Итоговый рейтинг:',
    '',
    ...top.map(finalRow),
    ...(rows.length > top.length ? [`…и ещё ${rows.length - top.length}`] : []),
    ...(me ? ['', `Твоё место — ${me.place} из ${rows.length}.`] : []),
    '',
    'Спасибо за игру.',
  ].join('\n');
}
