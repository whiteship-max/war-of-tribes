// Запись осады для показа — ролик осады (docs/gfx.md, ГФ-2). Чистый модуль: ни состояния мира, ни часов.
//
// Окно осады (`SiegeWindow`) живёт, пока стоит лагерь, и удаляется в минуту, когда осада кончилась (`LocalWorld.liftSiege`,
// у сервера войны — `war.turnBack`). Донесение о конце осады до этой правки не несло ничего, кроме слов: боя при падении
// голодом нет (`battle: null`), и ролику не из чего было показать, как шла осада. Запись — замороженная копия того, что окно
// знало в минуту конца: журнал фаз, дела с минутой (залпы и починки), очередь машин, древесина, обстрел с башни, паёк, —
// и чем осада кончилась. Своих чисел у неё нет: проломы, готовность машин и выбитое башней выводятся из неё теми же дверями
// мира, что из живого окна (`siegeroll.breachesOf`, `machines.machinesAt`, `bombard.thinAt`), — она и есть окно, только
// после конца.
//
// ЯДРО (CLAUDE.md, «Зоны»): запись лежит в сохранении мира необязательным полем донесения (`Report.siege`), а
// `WORLD_SAVE_VERSION` не поднимается — донесение без поля читается как прежде. Писатель один — `siegeRecordOf`: окно в
// запись переводит только он, и двум переводам негде разойтись.
import type { SiegeWindow } from './siege';
import type { BattlePlace } from '@/game/battle/ground';
import type { BattleSite, Fate } from './types';
import type { WoodPlan } from './works';
import type { Fire } from './bombard';
import type { PhaseRow, SiegeDeed } from './siegeroll';
import type { MachineId, MachineOrder } from './machines';

/**
 * Чем кончилась осада:
 *  - `hunger` — город доели голодом, гарнизон разошёлся;
 *  - `gates` — ворота открыли на фазе осады или город сдали кнопкой: участь на ступень мягче, гарнизон ушёл живым;
 *  - `terms` — сдача на условиях (переговоры у стен): участь — из условий, гарнизон ушёл живым;
 *  - `storm` — город взят штурмом из лагеря;
 *  - `broken` — лагерь разбит вылазкой, ударом с тыла или клещами;
 *  - `wasted` — лагерь растаял от истощения и мора;
 *  - `paid` — город дал дань, лагерь снят;
 *  - `ransom` — осаждённый двор дал выкуп нашему лагерю;
 *  - `left` — осаждающий ушёл сам: отозван, штурмовать стало некем.
 */
export type SiegeEnd = 'hunger' | 'gates' | 'terms' | 'storm' | 'broken' | 'wasted' | 'paid' | 'ransom' | 'left';
export const SIEGE_ENDS: readonly SiegeEnd[] = ['hunger', 'gates', 'terms', 'storm', 'broken', 'wasted', 'paid', 'ransom', 'left'];

/** Город пал: голодом, сдачей, на условиях или штурмом. */
export const fellBy = (how: SiegeEnd): boolean => how === 'hunger' || how === 'gates' || how === 'terms' || how === 'storm';

/** Бой за время осады: вылазка, удар по лагерю, совместный удар, штурм, вылазка на машину. */
export interface SiegeFight {
  at: number;
  /** Место боя — то же, что у записи боя (`BattleRecord.site`). */
  site: BattleSite;
  /** Победил ли игрок. */
  won: boolean;
  /** Донесение, где лежит ролик этого боя; нет — донесения у игрока нет (чужой бой войны). */
  report?: string;
  /** Вылазка на машину лагеря: на какую. Победа её сожгла (`MachineOrder.burned`). */
  machine?: MachineId;
  /** Выручка союзника по пакту: бил не сам город. */
  ally?: true;
}

/** Осада глазами донесения — замороженное окно в минуту конца. Поля окна — те же имена и смысл (`world/siege.ts`). */
export interface SiegeRecord {
  /** Чья осада для игрока: мы осаждали (`atk`) или осадили нас (`def`). */
  us: 'atk' | 'def';
  campId: string;
  startedAt: number;
  sinceAt?: number;
  /** Объявленная участь (`SiegeWindow.fate`); нет — «ограбить». */
  fate?: Fate;
  /** Уровень частокола осаждённого города в минуту постановки; нет — стены нет (логово, двор мира). */
  wall?: number;
  homeDays?: number;
  wood?: WoodPlan;
  fire?: Fire;
  log?: SiegeDeed[];
  phases?: PhaseRow[];
  machines?: MachineOrder[];
  ration?: boolean;
  lead?: number;
  /** Гарнизон в минуту постановки и люди лагеря, ставившие рогатки (бойцы строя). */
  garrison: number;
  camp: number;
  /** Уровень башни осаждённого города (вид замка); нет — не известен или башни нет. */
  tower?: number;
  /** Бои за время осады, по минутам. Нет — боёв не было. */
  fights?: SiegeFight[];
  /** Чем и когда кончилась; `fate` — участь, с которой город пал (у сдачи — мягче объявленной, у условий — из них). */
  end: { at: number; how: SiegeEnd; fate?: Fate };
  /**
   * Место и игровое время племени по последнему слепку (`BattlePlace.time`, как у записи боя — `LocalWorld.placeOf`): из
   * них ролик выводит землю, час и сезон каждой минуты осады (минута раньше конца — время раньше на столько же игровых
   * секунд). Нет — ровное поле в полдень.
   */
  place?: BattlePlace;
}

/** Что осаде известно сверх окна: кто сколько стоял, башня, бои, место. */
export interface SiegeExtra {
  camp: number;
  tower?: number;
  fights?: SiegeFight[];
  place?: BattlePlace;
}

/** Окно осады — в запись. Массивы копируются: окно после этого удаляется или правится, запись — нет. */
export function siegeRecordOf(w: SiegeWindow, us: 'atk' | 'def', end: SiegeRecord['end'], extra: SiegeExtra): SiegeRecord {
  const rec: SiegeRecord = {
    us,
    campId: w.campId,
    startedAt: w.startedAt,
    garrison: Math.max(0, Math.round(w.garrisonAtStart)),
    camp: Math.max(0, Math.round(extra.camp)),
    end: { ...end },
  };
  if (w.sinceAt !== undefined) rec.sinceAt = w.sinceAt;
  if (w.fate) rec.fate = w.fate;
  if (w.wall !== undefined) rec.wall = w.wall;
  if (w.homeDays !== undefined) rec.homeDays = w.homeDays;
  if (w.wood) rec.wood = { ...w.wood, ...(w.wood.base ? { base: { ...w.wood.base } } : {}) };
  if (w.fire) rec.fire = { ...w.fire };
  if (w.log?.length) rec.log = w.log.map((d) => ({ ...d }));
  if (w.phases?.length) rec.phases = w.phases.map((r) => ({ ...r, mods: { ...r.mods }, ...(r.orders ? { orders: [...r.orders] } : {}) }));
  if (w.machines?.length) rec.machines = w.machines.map((m) => ({ ...m }));
  if (w.ration) rec.ration = true;
  if (w.lead) rec.lead = w.lead;
  if (extra.tower !== undefined && extra.tower > 0) rec.tower = extra.tower;
  if (extra.fights?.length) rec.fights = [...extra.fights].sort((a, b) => a.at - b.at).map((f) => ({ ...f }));
  if (extra.place) rec.place = { ...extra.place };
  return rec;
}

/**
 * Запись глазами дверей окна: те же поля, что у `SiegeWindow`, кроме еды и гарнизона, — их ролик не читает. По ней ролик
 * считает проломы, машины и выбитое башней теми же функциями мира, что окно осады (`siegeroll`, `machines`, `bombard`).
 */
export const asWindow = (r: SiegeRecord): SiegeWindow => ({
  byId: '',
  campId: r.campId,
  startedAt: r.startedAt,
  ...(r.sinceAt !== undefined ? { sinceAt: r.sinceAt } : {}),
  foodAtStart: 0,
  garrisonAtStart: r.garrison,
  townPerHour: 0,
  perManPerHour: 0,
  ...(r.fate ? { fate: r.fate } : {}),
  ...(r.wall !== undefined ? { wall: r.wall } : {}),
  ...(r.homeDays !== undefined ? { homeDays: r.homeDays } : {}),
  ...(r.wood ? { wood: r.wood } : {}),
  ...(r.fire ? { fire: r.fire } : {}),
  ...(r.log ? { log: r.log } : {}),
  ...(r.phases ? { phases: r.phases } : {}),
  ...(r.machines ? { machines: r.machines } : {}),
  ...(r.ration ? { ration: true } : {}),
  ...(r.lead ? { lead: r.lead } : {}),
  builders: r.camp,
});
