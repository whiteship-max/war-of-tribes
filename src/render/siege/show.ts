// Вход ролика осады (docs/gfx.md, ГФ-2) — то, что посчитала осада, плоскими числами. Чистый, без three и без мира.
//
// Ролик мира не читает (как ролик боя: тест «показ не считает бой»). Запись осады из донесения (`world/siegerecord`) в эти
// числа переводит зовущий — слой игры (`ui/battle/siege.ts`) — теми же дверями мира, что окно осады: проломы после каждой
// фазы — `siegeroll.breachesOf`, залп фазы — `volleyIn`, готовность машин — `machines.machinesAt`, выбитое башней —
// запись (`SiegeRecord.thinned`, пишет мир), свет минуты — час племени. Здесь своих чисел исхода нет: только то, что дал зовущий.
import type { Ground } from '@/battle/replay';

/** Исход фазы — те же строки, что `siegeroll.PhaseOut` (тест сверяет). */
export type ShowOut = 'plague' | 'calm' | 'short' | 'breach' | 'gates';
/** Чем кончилась осада — те же строки, что `siegerecord.SiegeEnd` (тест сверяет). */
export type ShowEnd = 'hunger' | 'gates' | 'terms' | 'storm' | 'broken' | 'wasted' | 'paid' | 'ransom' | 'left';
export const SHOW_ENDS: readonly ShowEnd[] = ['hunger', 'gates', 'terms', 'storm', 'broken', 'wasted', 'paid', 'ransom', 'left'];
/** Участь взятого города — те же строки, что `Fate` мира. */
export type ShowFate = 'plunder' | 'captives' | 'burn';
/** Осадные машины — те же строки, что `MachineId` мира. */
export type ShowMachine = 'ladders' | 'ram' | 'tower' | 'mangonel';
export const SHOW_MACHINES: readonly ShowMachine[] = ['ladders', 'ram', 'tower', 'mangonel'];
/** Место боя — те же строки, что `BattleSite` мира. */
export type ShowSite = 'wall' | 'gate' | 'sortie' | 'camp' | 'joint' | 'lair';

/** Фаза осады глазами ролика. */
export interface ShowPhase {
  /** Номер фазы, с единицы. */
  k: number;
  out: ShowOut;
  /** Проломов в стене после броска этой фазы, 0..3 (`siegeroll.breachesOf` по фазам до неё включительно). */
  breaches: number;
  /** Сколько проломов заделано к броску этой фазы (починки, закрытые в ней). */
  repaired: number;
  /** Залп лёг в эту фазу (`siegeroll.volleyIn`). */
  volley: boolean;
  /** Камнемёт лагеря стоял готовым к броску (`machines.mangonelAt`). */
  mangonel: boolean;
  /** Какая доля бойцов строя ушла из лагеря за фазу: истощение и мор (`PhaseRow.waste`). */
  waste: number;
  /** Свет в минуту броска — доля суток рига (`lighting.applyDayNight`: 0 — рассвет, 0.25 — полдень, 0.5 — закат). */
  solar: number;
}

/** Машина лагеря: когда встала готовой, пущена ли на штурм, сожжена ли. */
export interface ShowMachineState {
  id: ShowMachine;
  /** Фаза, к броску которой машина стояла готовой (0 — ещё до первого броска); null — не достроена к концу осады. */
  ready: number | null;
  /** Пущена на штурм. */
  spent: boolean;
  /** Сожжена вылазкой: в какую фазу (бой вылазки — в `fights`); null — не сожжена. */
  burned: number | null;
  /** Свет в минуту готовности. */
  solar: number;
}

/** Бой за время осады. */
export interface ShowFight {
  /** Фаза, на которую пришёлся бой (бой между бросками k−1 и k — фаза k). */
  k: number;
  site: ShowSite;
  /** Победил ли игрок. */
  won: boolean;
  /** Вылазка на машину: на какую. */
  machine?: ShowMachine;
  /** Выручка союзника по пакту. */
  ally?: boolean;
  /** Этим боем осада кончилась (лагерь разбит, город взят штурмом). */
  end?: boolean;
  /** Донесение с роликом этого боя — «Смотреть бой». */
  report?: string;
  solar: number;
}

/**
 * Каким эпизодом бой осады идёт в ролике: удар с поля по лагерю (и клещи с гарнизоном) — выручка, вылазка гарнизона —
 * вылазка, остальное — штурм: стены города, частокола логова, ворот. Одна мерка у режиссуры и у коротких роликов донесения.
 */
export function fightEpisode(site: ShowSite): 'assault' | 'relief' | 'sortie' {
  return site === 'camp' || site === 'joint' ? 'relief' : site === 'sortie' ? 'sortie' : 'assault';
}

/** Проём штурма — те же строки, что у записи боя (`BattleRecord.openings`). */
export type ShowOpening = 'breach' | 'gate' | 'tower' | 'ladders' | 'scaling';

export interface SiegeShow {
  /** Чья осада для игрока: мы осаждали (`atk`) или осадили нас (`def`). Наши — в золоте, чужие — в красном (`side.ts`). */
  us: 'atk' | 'def';
  /** Сид картины: та же осада — тот же город, лагерь и камни. */
  seed: number;
  /**
   * Уровень частокола осаждённого города в минуту постановки; 0 — стены нет: осаждали логово. Вид стены от уровня не
   * зависит — камень и башни города, как в окне города (Р-5, docs/siege_v2.md, 21.1).
   */
  wall: number;
  /** Мест лучников на башне осаждённого города; 0 — орудия на башне нет (башня не била по лагерю). */
  tower: number;
  /** Бойцов строя в лагере, ставивших рогатки, и гарнизон — в минуту постановки. */
  camp: number;
  garrison: number;
  phases: ShowPhase[];
  machines: ShowMachineState[];
  /** Доля лагеря, выбитая башней к концу осады, 0..1 (`SiegeRecord.thinned`). */
  fire: number;
  /** Осаждённый урезал паёк. */
  ration: boolean;
  fights: ShowFight[];
  end: {
    how: ShowEnd;
    /** Участь, с которой пал город; не пал — null. */
    fate: ShowFate | null;
    /** Фаза конца: бросок этой фазы или бой перед ним. */
    k: number;
    /** Проломов в минуту конца. */
    breaches: number;
    solar: number;
    /** Штурм концом осады: чем лезли (`BattleRecord.openings` донесения). Нет — не штурм. */
    openings?: ShowOpening[];
  };
  /** Свет в минуту постановки лагеря. */
  solar0: number;
  /** Земля места: равнина, холмы или берег, лес, зима (свет ролик берёт свой — по минутам осады). */
  ground: Ground;
  /**
   * Гербы на знамёнах строками (`heraldry/arms.armsCode`, П-2): наш и чужих — решает зовущий по донесению
   * (`ui/battle/coats`). Нет — наша прежняя башня и разбойники (стенд).
   */
  coats?: { ours: string; theirs: string };
}
