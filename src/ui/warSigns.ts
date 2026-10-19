// Тревоги войны — значками справа снизу, над нижней панелью (П-7, docs/polish.md): осада своего города, набеги на него
// и свой лагерь под чужими стенами. Прежде осада стояла плашкой в пол-экрана (`SiegeBanner`), а набег — пилюлей с текстом
// в ряду под верхом; теперь у каждой войны один квадратный значок 64: знак, слово и срок. Всё остальное — в окне, куда
// значок ведёт: окно осады (вкладка «Осада»), донесение о набеге, окно лагеря.
//
// Список собирается здесь один раз чистой функцией (`warSigns`) — её сверяет тест на виде мира, как его отдаёт пульс.
// Своей арифметики у значка нет: срок голода — `hungerLeft` (одна дверь часов голода), срок набега — `useRaidWords`
// (одна дверь окна ответа), срочное — поля мира как есть: проломы хода осады, предложение другой стороны, готовая машина
// лагеря, выручка на подходе.
import { useEffect, useState } from 'react';
import { useGame } from '@/game/store';
import { useWorld, worldNow } from '@/world/store';
import type { CampView, SiegeView } from '@/world/types';
import { FATE_META } from '@/world/data/fates';
import { hungerLeft } from '@/ui/parts/hunger';
import { plural } from '@/ui/parts/plural';
import { useRaidWords, type RaidWords } from '@/ui/parts/raidWords';
import { openRaid } from '@/ui/realm/open';
import type { IconName } from '@/ui/icons/alias';

/** Сколько значков стоит столбцом; больше — последнее место занимает счётчик остальных. */
export const SIGNS_MAX = 3;

export type WarSignKind = 'siege' | 'raid' | 'camp';

export interface WarSign {
  key: string;
  kind: WarSignKind;
  /** Значок листа и запасной знак — как у `Icon`. */
  icon: IconName;
  /** Слово под знаком: «Осаждён», «Набег», «Лагерь». */
  label: string;
  /** Кто: осаждающий, откуда набег, под чьими стенами лагерь — для строки счётчика «ещё». */
  who: string;
  /** Короткий срок под словом: до голода, до прихода. */
  timer: string;
  /** Срочное: значок горит красным и мягко пульсирует. */
  urgent: boolean;
  /** Что срочного — словами для чтеца экрана и строки «ещё»; на самом значке текста нет. Пусто — срочного нет. */
  why: string[];
  /** Вся тревога одной строкой: имя кнопки (`aria-label`) и строка в подсказке счётчика. */
  title: string;
  go: () => void;
}

/** Куда ведут значки — двери игры, а не свои окна. */
export interface WarSignDoors {
  siege: () => void;
  camp: () => void;
  raid: (marchId: string) => void;
}

export interface WarSignInput {
  siege: SiegeView | null;
  camp: CampView | null;
  raids: RaidWords[];
  now: number;
  go: WarSignDoors;
}

/**
 * Что срочного в осаде своего города (задание П-7): пролом в стене, предложение условий, ждущее ответа, и штурм скоро —
 * у лагеря готова осадная машина (машины лагеря строят только для штурма, docs/siege_v2.md, 4.4). Поля мира как есть.
 */
export function siegeUrgency(v: SiegeView, now: number): string[] {
  const out: string[] = [];
  const breaches = v.phases?.breaches ?? 0;
  if (breaches > 0) out.push(breaches > 1 ? `проломов в стене: ${breaches}` : 'пролом в стене');
  const offer = v.parley?.incoming;
  if (offer && offer.until > now) out.push(offer.kind === 'terms' ? 'враг предлагает условия сдачи' : 'предложена дань');
  const ready = v.answers?.burn.filter((b) => b.ready) ?? [];
  if (ready.length > 0) out.push(`штурм скоро: готов${ready.length > 1 ? 'ы' : ''} ${ready.map((b) => b.name.toLowerCase()).join(', ')}`);
  return out;
}

/** Что срочного в своём лагере под чужими стенами: предложение города, ждущее ответа, и выручка на подходе. */
export function campUrgency(v: CampView, now: number): string[] {
  const out: string[] = [];
  const offer = v.parley?.incoming;
  if (offer && offer.until > now) out.push(offer.kind === 'tribute' ? 'город предлагает дань' : 'предложены условия');
  const r = v.relief;
  if (r && r.at > now) out.push(`на лагерь идёт выручка: ${r.men} ${plural(r.men, 'боец', 'бойца', 'бойцов')}`);
  return out;
}

const RANK: Record<WarSignKind, number> = { siege: 0, raid: 1, camp: 2 };

/**
 * Тревоги войны в порядке столбца: срочные первыми, дальше осада своего города, набеги (ближайший первым) и свой лагерь.
 * Нет осады, набегов и лагеря — пустой список, и столбца нет.
 */
export function warSigns({ siege, camp, raids, now, go }: WarSignInput): WarSign[] {
  const out: WarSign[] = [];
  if (siege) {
    const why = siegeUrgency(siege, now);
    const left = hungerLeft(siege.starvesAt, now);
    out.push({
      key: 'siege',
      kind: 'siege',
      icon: 'alert-siege',
      label: 'Осаждён',
      who: siege.byName,
      timer: left,
      urgent: why.length > 0,
      why,
      title: [`Город в осаде: «${siege.byName}» у ворот, до голода ${left}`, `объявлено: ${FATE_META[siege.fate].name.toLowerCase()}`, ...why].join('. ') + '.',
      go: go.siege,
    });
  }
  for (const { win, left } of raids) {
    const m = win.march;
    out.push({
      key: `raid-${m.id}`,
      kind: 'raid',
      icon: 'alert-raid',
      label: 'Набег',
      who: m.fromName,
      timer: left,
      // Набег — беда по сроку уже идущая: красный, как его кольцо в ряду тревог (`alertItems`).
      urgent: true,
      why: [],
      title: `Набег · ${m.fromName}: у ворот через ${left}.`,
      go: () => go.raid(m.id),
    });
  }
  if (camp) {
    const why = campUrgency(camp, now);
    const left = hungerLeft(camp.starvesAt, now);
    out.push({
      key: 'camp',
      kind: 'camp',
      icon: 'stage-camp',
      label: 'Лагерь',
      who: camp.targetName,
      timer: left,
      urgent: why.length > 0,
      why,
      title: [`Наш лагерь под «${camp.targetName}»: у города хлеба на ${left}`, ...why].join('. ') + '.',
      go: go.camp,
    });
  }
  return out
    .map((s, i) => ({ s, i }))
    .sort((a, b) => Number(b.s.urgent) - Number(a.s.urgent) || RANK[a.s.kind] - RANK[b.s.kind] || a.i - b.i)
    .map(({ s }) => s);
}

/** Столбец не выше `SIGNS_MAX`: влезают все — все; нет — первые без одного, а остальные уходят в счётчик. */
export function fitSigns(list: WarSign[]): { shown: WarSign[]; more: WarSign[] } {
  if (list.length <= SIGNS_MAX) return { shown: list, more: [] };
  return { shown: list.slice(0, SIGNS_MAX - 1), more: list.slice(SIGNS_MAX - 1) };
}

/**
 * Тревоги войны в эту секунду. Пока хоть одна стоит, сроки обязаны идти сами: замерший счётчик читается как сломанный
 * экран, а не как «время ещё есть».
 */
export function useWarSigns(): WarSign[] {
  const siege = useWorld((w) => w.siege);
  const camp = useWorld((w) => w.camp);
  const raids = useRaidWords();
  const openSiege = useGame((g) => g.openSiege);
  const openCamp = useGame((g) => g.openCamp);
  const [, retick] = useState(0);
  const live = siege !== null || camp !== null;
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => retick((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, [live]);
  return warSigns({
    siege,
    camp,
    raids,
    now: worldNow(),
    go: {
      siege: openSiege,
      camp: openCamp,
      // Донесение о набеге живёт в почте державы над городом: с карты значок сначала возвращает в город — иначе держава
      // открылась бы под картой, невидимой (тот же приём, что у ряда тревог, `next/Alerts`).
      raid: (id) => {
        const g = useGame.getState();
        if (g.mapOpen) g.closeMap();
        openRaid(id);
      },
    },
  });
}
