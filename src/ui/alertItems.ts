import { useGame } from '@/game/store';
import { alerts, buildingOfType, buildingTitle } from '@/game/derived';
import { eventLeft } from '@/game/sim/mail';
import { MUTINY_EVENT, ORDER_TEXT } from '@/game/data/order';
import { useWorld, worldNow } from '@/world/store';
import { realDue } from '@/ui/parts/wait';
import { FIGURE_BY_ID, FIGURE_IDS } from '@/world/data/figures';
import { hireWhere } from '@/game/sim/hire';
import { NEW_GENERAL, bareGeneral } from '@/game/sim/agents';
import { placeOpen } from '@/game/sim/tech';
import { stabOf } from '@/game/sim/stability';
import { GROUP_META } from '@/game/data/stability';
import { useRaidWords } from '@/ui/parts/raidWords';
import { openRaid, useRealm } from '@/ui/realm/open';
import { eventKey } from '@/ui/realm/unread';
import type { IconName } from '@/ui/icons/alias';

/**
 * Одна тревога — для обоих видов интерфейса. Список собирается здесь один раз, а рисуют его двое: строки
 * прежнего вида (`AlertBar`) и значки нового (`next/Alerts`). Две копии сборки разошлись бы в том, о чём
 * тревожить и куда вести, — заметил бы игрок, у которого тревога есть в одном виде и нет в другом.
 */
export interface AlertItem {
  key: string;
  /** Значок набора (docs/icons.md). */
  icon: IconName;
  /** Строка прежнего вида целиком. */
  text: string;
  /** Вторая строка прежнего вида: цена того, о чём тревога. */
  sub?: string;
  /** Новый вид: имя в подсказке и пилюле. */
  title: string;
  /** Новый вид: строка под именем в подсказке. */
  body?: string;
  /** Тикающий срок у значка: набег, мятеж. */
  timer?: string;
  /** Беда, которая идёт по сроку или уже идёт, — красное кольцо; иначе заметка — охра. */
  urgent: boolean;
  /** Строка прежнего вида красная, как у набега. */
  raid?: boolean;
  /**
   * Тревога войны: её значок стоит в столбце справа снизу (`ui/warSigns`, П-7), и ряд под верхом её не рисует. В списке
   * она остаётся — по ней краснеет счётчик «Вестей» и трубит рог.
   */
  war?: boolean;
  /** Куда ведёт: в донесение, в здание, в справку. `null` — вести некуда. */
  go: (() => void) | null;
  /** Новый вид: слово ссылки «К вести», «Казармы». */
  goWord?: string;
}

/** Беды, которые идут сами: голод, холод, уход войска, ропот. Остальное — заметки. */
const URGENT = new Set(['starving', 'freezing', 'desert', 'desert-soon', 'unrest']);

export function useAlertItems(): AlertItem[] {
  const s = useGame((g) => g.s);
  const openBuilding = useGame((g) => g.openBuilding);
  const openTab = useGame((g) => g.openTab);
  const openHall = useGame((g) => g.openTownHall);
  const openMap = useGame((g) => g.openMap);
  const general = useWorld((g) => g.figures.find((f) => f.id === 'general'));
  // Письмо о набеге ждёт в почте державы, а не на экране: тревога остаётся предупреждением на виду — и в
  // городе, и на карте. Отсчёт каждой идёт сам, пока кто-то идёт на нас (`useRaidWords`).
  const raids = useRaidWords();
  // Мятеж ждёт ответа в почте сутки, как любое донесение, — но невольники всё это время стоят, и молчание
  // его — самая жёсткая потеря в игре: тревога на виду ведёт прямо к нему.
  const openMail = useRealm((r) => r.openMail);
  const mutiny = s.inbox.find((e) => e.defId === MUTINY_EVENT) ?? null;
  const mutinyLeft = mutiny ? eventLeft(mutiny, worldNow()) : null;
  const out: AlertItem[] = [];

  if (mutiny) {
    const due = mutinyLeft !== null ? realDue(mutinyLeft) : undefined;
    out.push({
      key: 'mutiny',
      icon: ORDER_TEXT.mutiny.icon,
      text: `${ORDER_TEXT.mutiny.alert}${due ? ` · ${due}` : ''}`,
      title: 'Мятеж невольников',
      body: 'Невольники бросили работу и ждут твоего слова.',
      timer: due,
      urgent: true,
      raid: true,
      go: () => openMail(eventKey(mutiny)),
      goWord: 'К вести',
    });
  }
  for (const { win, left } of raids) {
    // Тап ведёт туда, где это решают: в донесение о набеге — перехват на карте и раскладка дружины. Окно ответа — до
    // прихода (`parts/raidWords`): срок в строке один.
    const m = win.march;
    out.push({
      key: m.id,
      icon: 'alert-raid',
      text: `Набег · ${m.fromName} · ${left}`,
      title: `Набег · ${m.fromName}`,
      body: `У ворот через ${left}.`,
      timer: left,
      urgent: true,
      raid: true,
      war: true,
      go: () => openRaid(m.id),
      goWord: 'К вести',
    });
  }
  // Пустые места агентов, на которые не идёт найм: одна тревога, ведёт в Ратушу, раздел «Агенты» (АГ-1) — там нанимают всех
  // четверых. Своего поля тревоги у них нет — `derived` про людей на местах не знает нарочно (`agents.owners.test.ts`).
  const who: string[] = [];
  for (const id of FIGURE_IDS) {
    const p = s.agents[id];
    if (!p.vacant || p.hiring) continue;
    // Место, которого держава ещё не открыла, — не пустое, а отсутствующее.
    if (!placeOpen(s, id)) continue;
    who.push(FIGURE_BY_ID[id].name.toLowerCase());
  }
  if (who.length > 0) {
    const isGeneral = who.includes(FIGURE_BY_ID.general.name.toLowerCase());
    const where = hireWhere(s, 'general');
    // «Нужен разведчик», «Нужны разведчик и лазутчик».
    const need = who.length > 1 ? `Нужны ${who.slice(0, -1).join(', ')} и ${who[who.length - 1]}` : `Нужен ${who[0]}`;
    out.push({
      key: 'vacant-agents',
      icon: isGeneral ? 'fig-general' : 'fig-scout',
      text: need,
      sub: isGeneral ? 'Без него дружина не выходит.' : undefined,
      title: need,
      body: isGeneral ? `Без полководца дружина не выходит. Нанимают ${where}.` : `Нанимают ${where}.`,
      urgent: false,
      go: () => openHall('agents'),
      goWord: 'Нанять',
    });
  }
  // Новый полководец без дела: держится, пока он не сходит в первый бой. Решает одно правило (`sim/agents.bareGeneral`);
  // отряд ему дают в окне дела (ДР-6), и тревога ведёт на карту, а не в Статую (ДР-7: Статуя с полководцем не связана).
  if (bareGeneral(s, general)) {
    out.push({
      key: 'bare-general',
      icon: 'fig-general',
      text: 'Новый полководец ждёт дела',
      title: 'Новый полководец ждёт дела',
      body: NEW_GENERAL,
      urgent: false,
      go: openMap,
      goWord: 'На карту',
    });
  }
  // Стабильность (СБ-1, docs/stability.md, 2.8): «мятеж близок» — полоса группы выше порога и растёт; ведёт в раздел, где
  // сказано, что злит и как унять. Невольники и войско тревожат своими строками (ропот, уход) — здесь только новые полосы.
  for (const g of stabOf(s).near ?? []) {
    if (g !== 'folk' && g !== 'hungry') continue;
    const name = GROUP_META[g].name;
    out.push({
      key: `stab-near-${g}`,
      icon: GROUP_META[g].icon,
      text: `Мятеж близок: ${name.toLowerCase()} на пределе`,
      title: `Мятеж близок: ${name.toLowerCase()}`,
      body: 'Что злит и как унять — в разделе «Стабильность».',
      urgent: true,
      go: () => useRealm.getState().show('stability'),
      goWord: 'Стабильность',
    });
  }
  for (const a of alerts(s)) {
    const target = a.goto ? buildingOfType(s, a.goto) : null;
    // Порядок чинят не в здании: тревога ведёт в справку, где сказано, кто держит невольников.
    const tab = a.open;
    out.push({
      key: a.id,
      icon: a.icon,
      text: a.text,
      sub: a.sub,
      title: a.text,
      body: a.sub,
      urgent: URGENT.has(a.id),
      go: tab ? () => openTab(tab) : target ? () => openBuilding(target.id) : null,
      goWord: tab ? 'Порядок' : a.goto ? buildingTitle(s, a.goto) : undefined,
    });
  }
  return out;
}
