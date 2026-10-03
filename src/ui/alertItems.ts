import { useGame } from '@/game/store';
import { alerts, buildingOfType, buildingTitle } from '@/game/derived';
import { eventLeft } from '@/game/sim/mail';
import { MUTINY_EVENT, ORDER_TEXT } from '@/game/data/order';
import { useWorld, worldNow } from '@/world/store';
import { realDue, realLeft } from '@/ui/parts/wait';
import { FIGURE_BY_ID, FIGURE_IDS } from '@/world/data/figures';
import { HIRE_AT } from '@/game/data/hire';
import { hireWhere } from '@/game/sim/hire';
import { bareGeneral } from '@/game/sim/agents';
import { placeOpen } from '@/game/sim/tech';
import type { BuildingTypeId } from '@/game/types';
import { iconName } from '@/ui/icons/registry';
import { useRaidWords } from '@/ui/parts/raidWords';
import { openRaid, useRealm } from '@/ui/realm/open';
import { eventKey } from '@/ui/realm/unread';

/**
 * Одна тревога — для обоих видов интерфейса. Список собирается здесь один раз, а рисуют его двое: строки
 * прежнего вида (`AlertBar`) и значки нового (`next/Alerts`). Две копии сборки разошлись бы в том, о чём
 * тревожить и куда вести, — заметил бы игрок, у которого тревога есть в одном виде и нет в другом.
 */
export interface AlertItem {
  key: string;
  /** Значок листа; `null` — эмодзи как есть: у мятежа и пустых мест своего рисунка нет. */
  icon: string | null;
  glyph: string;
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
      icon: null,
      glyph: ORDER_TEXT.mutiny.icon,
      text: `${ORDER_TEXT.mutiny.alert}${due ? ` · ${due}` : ''}`,
      title: 'Мятеж невольников',
      body: 'Невольники стоят, пока не ответишь.',
      timer: due,
      urgent: true,
      raid: true,
      go: () => openMail(eventKey(mutiny)),
      goWord: 'К вести',
    });
  }
  for (const { win, short } of raids) {
    // Тап ведёт туда, где это решают: в донесение о набеге — перехват на карте и сбор дружины. Не успевает
    // полный сбор — у строки значок времени: вышло время полного сбора.
    const m = win.march;
    const left = realLeft(win.seconds);
    out.push({
      key: m.id,
      icon: win.late ? 'ui-time' : 'alert-raid',
      glyph: win.late ? '⏳' : '⚔️',
      text: `Набег · ${m.fromName} · ${left}${short ? ` · ${short}` : ''}`,
      title: `Набег · ${m.fromName}`,
      body: short ? `Придёт через ${left}, ${short}.` : `Придёт через ${left}.`,
      timer: left,
      urgent: true,
      raid: true,
      go: () => openRaid(m.id),
      goWord: 'К вести',
    });
  }
  // Пустые места агентов, на которые не идёт найм: тревога на здание, где нанимают. Своего поля тревоги у
  // них нет — `derived` про людей на местах не знает нарочно (`agents.owners.test.ts`).
  const empty = new Map<BuildingTypeId, string[]>();
  for (const id of FIGURE_IDS) {
    const p = s.agents[id];
    if (!p.vacant || p.hiring) continue;
    // Место, которого держава ещё не открыла, — не пустое, а отсутствующее.
    if (!placeOpen(s, id)) continue;
    const at = HIRE_AT[id];
    empty.set(at, [...(empty.get(at) ?? []), FIGURE_BY_ID[id].name.toLowerCase()]);
  }
  for (const [type, who] of empty) {
    const b = buildingOfType(s, type);
    const isGeneral = who.includes(FIGURE_BY_ID.general.name.toLowerCase());
    const where = hireWhere(s, FIGURE_IDS.find((id) => HIRE_AT[id] === type) ?? 'scout');
    // «Нужен разведчик», «Нужны разведчик и лазутчик»: на одно здание найма — одно или два места.
    const need = who.length > 1 ? `Нужны ${who.slice(0, -1).join(', ')} и ${who[who.length - 1]}` : `Нужен ${who[0]}`;
    out.push({
      key: `vacant-${type}`,
      icon: null,
      glyph: isGeneral ? '🎖️' : '👣',
      text: need,
      sub: isGeneral ? 'Без него дружина не выходит.' : undefined,
      title: need,
      body: isGeneral ? `Без полководца дружина не выходит. Нанимают ${where}.` : `Нанимают ${where}.`,
      urgent: false,
      go: b ? () => openBuilding(b.id) : null,
      goWord: 'Нанять',
    });
  }
  // Новый полководец без дружины: держится, пока её не соберут или пока он не сходит в первый бой. Решает
  // одно правило (`sim/agents.bareGeneral`).
  if (bareGeneral(s, general)) {
    const statue = buildingOfType(s, 'statue');
    out.push({
      key: 'bare-general',
      icon: null,
      glyph: '🎖️',
      text: 'Полководец без отряда',
      title: 'Полководец без отряда',
      body: 'Отряд собирают в Статуе.',
      urgent: false,
      go: statue ? () => openBuilding(statue.id) : null,
      goWord: 'К Статуе',
    });
  }
  for (const a of alerts(s)) {
    const target = a.goto ? buildingOfType(s, a.goto) : null;
    // Порядок чинят не в здании: тревога ведёт в справку, где сказано, кто держит невольников.
    const tab = a.open;
    out.push({
      key: a.id,
      icon: iconName('alert', a.id),
      glyph: a.icon,
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
