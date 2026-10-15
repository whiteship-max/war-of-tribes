// Война между игроками глазами клиента (docs/pvp.md): свои войны с сервера и приказы туда. Мир про
// сеть по-прежнему не знает ничего — ему приносят готовый список (`LocalWorld` через `opts.wars`) и дверь
// приказа (`opts.warOrder`), как реестр замков.
//
// Исход здесь не считается и не отправляется: бой считает сервер в минуту прихода, клиент только
// читает итог и применяет свою сторону. Вне Telegram войны нет — подписи нет, и сервер не ответит.
import { apiGet, apiPost } from './api';
import { askWriteOnce, NOTIFY_ON } from './notify';
import { tgInitData } from '@/telegram/webapp';
import type { SpyMenu, SpyView, WarOrder, WarPact, WarResponse, WarSheet, WarView } from '../../netlify/lib/contract';

export type { SpyMenu, SpyView, WarOrder, WarPact, WarSheet, WarView };

/** Как часто спрашивать свои войны. Тревога о походе на город приходит не позже этого. */
export const WAR_PULL_MS = 15_000;

interface Cached {
  at: number;
  wars: WarView[];
  /** Дела лазутчиков: свои и чужие у нас, которые мы видим (docs/spy_pvp.md). */
  spies: SpyView[];
  /** Пакты и предложения пакта с соседями-игроками (docs/siege_v2.md, раздел 5). */
  pacts: WarPact[];
  pace: number;
}

let cache: Cached | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let sheet: (() => WarSheet | null) | null = null;

/** Свои войны из последнего ответа. Ответа не было — пусто, и мир войну не трогает. */
export const wars = (): WarView[] => cache?.wars ?? [];

/** Дела лазутчиков из последнего ответа (docs/spy_pvp.md). */
export const spies = (): SpyView[] => cache?.spies ?? [];

/** Пакты из последнего ответа: с кем заключён, кому предложен, кто предлагает нам. */
export const pacts = (): WarPact[] => cache?.pacts ?? [];

/** Темп войны с сервера (`TRIBE_WAR_PACE`): во сколько раз быстрее походы. Нет ответа — 1. */
export const warPace = (): number => cache?.pace ?? 1;

/** Был ли ответ сервера вообще: без него «войны нет» и «не знаем» не различить. */
export const warsKnown = (): boolean => cache !== null;

const keep = (res: WarResponse): void => {
  // Ответ на чтение, ушедшее раньше приказа, может вернуться позже ответа на приказ — старый список не
  // затирает новый: полководец иначе на миг «вернулся бы домой» из только что начатого похода.
  if (cache && res.now < cache.at) return;
  cache = {
    at: res.now,
    wars: Array.isArray(res.wars) ? res.wars : [],
    spies: Array.isArray(res.spies) ? res.spies : [],
    pacts: Array.isArray(res.pacts) ? res.pacts : [],
    pace: typeof res.pace === 'number' && res.pace >= 1 ? res.pace : 1,
  };
  // Война идёт — на нас или наша: о бое бот напишет обеим сторонам, и право писать спрашивается сейчас.
  if (NOTIFY_ON && cache.wars.some((w) => w.phase !== 'done')) askWriteOnce();
};

/** Перечитать свои войны. Неудача — значением: остаётся прежний список. */
export async function warPull(): Promise<void> {
  const res = await apiGet<WarResponse>('/api/war');
  if (res.ok) keep(res.data);
}

const FAIL: Record<string, string> = {
  auth: 'Война между игроками идёт только в Telegram.',
  busy: 'Слишком часто. Попробуй через несколько секунд.',
  offline: 'Нет связи. Приказ не отдан.',
  conflict: 'Приказ разминулся с другим. Попробуй ещё раз.',
  server: 'Приказ не принят. Попробуй ещё раз.',
};

/** Отдать приказ. null — принят, иначе причина словами (отказ сервера — его словами). */
export async function warOrder(order: WarOrder): Promise<string | null> {
  const res = await apiPost<WarResponse>('/api/war', order);
  if (!res.ok) return FAIL[res.why] ?? FAIL.server;
  keep(res.data);
  return res.data.error ?? null;
}

/**
 * Меню дел лазутчика против города (docs/spy_pvp.md): шанс и гибель считает сервер — чужого слепка у клиента нет. Отказ —
 * строкой (словами сервера или сети).
 */
export async function spyLook(target: string): Promise<SpyMenu | string> {
  const res = await apiGet<WarResponse>(`/api/war?spy=${encodeURIComponent(target)}`);
  if (!res.ok) return FAIL[res.why] ?? FAIL.server;
  keep(res.data);
  return res.data.spyMenu ?? res.data.error ?? FAIL.server;
}

/** Откуда брать слепок обороны для записи партии: его собирает мир (`LocalWorld.warSheet`). */
export const provideSheet = (fn: () => WarSheet | null): void => {
  sheet = fn;
};

/** Слепок обороны сейчас — едет в запись партии (`net/snapshot`). Мира ещё нет — нет и слепка. */
export const warSheet = (): WarSheet | null => {
  try {
    return sheet?.() ?? null;
  } catch {
    return null;
  }
};

/**
 * Отметка того, что в слепке обороны держит раскладка: отряд полководца дома, свой поход и отметки полководца у стен
 * (`WarSheet.retinue`, `out`, `pips`, docs/retinue.md). Сменилась — запись партии уходит раньше срока
 * (`net/sync.pushDue`): слепок, лёгший до выхода полководца, держал бы его отряд дома до следующей записи, а игрок,
 * ушедший из игры, её не пришлёт. Отметки — сами по себе: полководец в городе ведёт оборону и без отряда
 * (`world/muster.inTown`), и его выход без бойцов отряда не меняет. Слепка нет — нет.
 */
export const sheetMark = (): string | null => {
  const s = warSheet();
  return s ? JSON.stringify([s.retinue ?? {}, s.out ?? [], s.pips ?? {}]) : null;
};

/** Начать спрашивать свои войны. Вне Telegram — не начинать: подписи нет. */
export function warBoot(): void {
  if (timer || !tgInitData()) return;
  void warPull();
  timer = setInterval(() => void warPull(), WAR_PULL_MS);
}
