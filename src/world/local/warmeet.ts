// Дела полководца против похода игрока на свой город у мира — перехват в поле (ПЛ-1, docs/siege_v2.md, «Решения ПЛ-1») и удар по
// лагерю у своих стен и выручка союзника (docs/pvp.md, docs/siege_v2.md, раздел 5) — докачкой: первой загрузке они не нужны (с
// ПЛ-1 удар и приказ выручки уехали сюда же, чтобы она не росла).
// Окно и приказ (`interceptRow`, `interceptView`, `intercept`, `strikePlan`, `strike`) зовут асинхронные двери мира (`errands`,
// `interceptPlan`, `errand`, `strikePlan`, `strikeCamp`); путь к встрече, срыв, отбитую добычу и слова боя в поле (`chase`, `regain`, `fieldWords`) — шаг войн (`stepWars`),
// и кусок подтягивается до него, когда в записи войн есть что разбирать (`LocalWorld.meetDue`). Своих правил здесь нет: встреча —
// `pvpmeet.warMeet`, одна с сервером войны; бой и исход считает сервер (`war.meetBattle`).
import { troopTotal, type TroopStack } from '@/game/battle/kinds';
import { kindsOf, troopPower } from '@/game/battle/price';
import { asGame, realMs } from '@/game/pace';
import type { Spirit } from '@/battle';
import { warMissedId, warRegainId, type Counts, type WarBattle, type WarView } from '../../../netlify/lib/contract';
import { clampToWorld, distance, formatLeft, secondsLeft } from '../geo';
import { MEET_CAMP, MEET_FAR, MEET_GONE, warMeet, warMoving } from '../pvpmeet';
import { strikeSeed } from '../gait';
import { fieldTroops, inTown, postureOf } from '../muster';
import { perilShare, routPeril } from '../peril';
import { siegeSince, STRIKE_FROM_TOWN } from '../siege';
import { gateBusyText, refusedAtGate, strikeForecast } from '../works';
import type { Meeting } from '../pursuit';
import type { Coord, ErrandOption, InterceptPlan, Loot, MarchView, PlayerCastle, SettlementId, StrikePlan } from '../types';
import type { StoredFigure, StoredMarch } from './state';
import { HOME_ID, type LocalWorld } from './LocalWorld';

/** Двери мира, которыми ходит перехват. */
export type MeetWorld = Pick<
  LocalWorld,
  | 'chaseBlock'
  | 'settleHandover'
  | 'offDuty'
  | 'retiringBlock'
  | 'spotOf'
  | 'warPaceOf'
  | 'noBand'
  | 'energyCost'
  | 'warCity'
  | 'wearGeneral'
  | 'generalSpirit'
  | 'generalPips'
  | 'energyOf'
  | 'warSend'
  | 'warList'
  | 'ourMeet'
  | 'myCastle'
  | 'walk'
  | 'strikeLeg'
  | 'payEnergy'
  | 'write'
  | 'figureAt'
  | 'touching'
  | 'homecoming'
  | 'addEffect'
  | 'overflow'
  | 'warGeneralBusy'
  | 'warWindow'
  | 'garrison'
  | 'strikeSeconds'
  | 'backMsFrom'
  | 'routRisk'
  | 'homeName'
  | 'reliefPlan'
>;

/** Дорога в мс мира с темпом войны — в настоящие мс: энергия дороги идёт днями пути, без темпа (как у удара). */
const roadMs = (world: MeetWorld, ms: number): number => Math.max(0, Math.round(ms * world.warPaceOf()));

/** Дух в приказ — мораль и дисциплина, как у похода (`LocalWorld.warMarch`). */
const spiritOf = (v: Spirit | undefined): { spirit?: Spirit } => (v ? { spirit: { morale: v.morale, discipline: v.discipline } } : {});

/**
 * Перехват похода игрока до приказа: встреча — той же функцией, что посчитает сервер (`pvpmeet.warMeet`: земля пути войны,
 * скорость полководца в режиме марша, с этой минуты), отказы — словами мира и сервера. Встреча есть и при отказе «нет
 * отряда»: окно дела показывает срок и точку, пока игрок выбирает состав (ДР-6).
 */
export function interceptPlan(world: MeetWorld, f: StoredFigure, w: WarView, now: number): { meet: Meeting | null; reason: string | null } {
  const no = (reason: string, meet: Meeting | null = null): { meet: Meeting | null; reason: string } => ({ meet, reason });
  if (w.phase === 'camp') return no(MEET_CAMP);
  if (w.phase !== 'march' && w.phase !== 'back') return no(MEET_GONE);
  const blocked = world.chaseBlock(now);
  if (blocked) return no(blocked);
  world.settleHandover(f, now);
  const off = world.offDuty('general', now) ?? world.retiringBlock('general');
  if (off) return no(off);
  if (f.handover) return no(`Отряд ещё в сборе: ${formatLeft(Math.max(0, f.handover.until - now) / 1000)}.`);
  const meet = warMeet(world.spotOf(f, now), f.gait, w, now, world.warPaceOf());
  if (!meet) {
    const end = w.phase === 'back' ? (w.backAt ?? now) : w.arriveAt;
    return no(`${MEET_FAR.replace(/\.$/, '')}: им идти ${formatLeft(secondsLeft(end, now))}.`);
  }
  if (troopTotal(f.troops ?? {}) === 0) return no(world.noBand(now), meet);
  const tired = world.energyCost('general', 'chase', now, roadMs(world, meet.time - now)).block;
  if (tired) return no(tired, meet);
  return { meet, reason: null };
}

/** Строка «Перехватить» меню дел у похода игрока: срок встречи, дорога домой от неё, энергия и риск — планом перехвата. */
export function interceptRow(
  world: MeetWorld,
  f: StoredFigure,
  w: WarView,
  now: number,
  row: (reason: string | null, extra: Partial<ErrandOption>) => ErrandOption,
  at: Coord,
): ErrandOption {
  const { meet, reason } = interceptPlan(world, f, w, now);
  return row(reason, {
    walkMs: meet ? Math.max(0, Math.round(meet.time - now)) : 0,
    backMs: meet ? world.backMsFrom('general', meet.at) : 0,
    energy: meet ? world.energyCost('general', 'chase', now, roadMs(world, meet.time - now)) : null,
    risk: [world.routRisk(meet?.at ?? at)],
  });
}

/** Окно «Перехватить в поле» у похода игрока: та же встреча, что у меню дел. */
export function interceptView(world: MeetWorld, f: StoredFigure, w: WarView, now: number): InterceptPlan {
  const { meet, reason } = interceptPlan(world, f, w, now);
  const end = w.phase === 'back' ? (w.backAt ?? now) : w.arriveAt;
  return {
    can: meet !== null && reason === null,
    reason,
    at: meet ? { x: Math.round(meet.at.x), y: Math.round(meet.at.y) } : null,
    seconds: meet ? meet.seconds : 0,
    targetName: world.warCity(w, 'atk'),
    men: troopTotal(w.army.troops as TroopStack),
    targetSeconds: secondsLeft(end, now),
    ...(meet ? { energy: world.energyCost('general', 'chase', now, roadMs(world, meet.time - now)) } : {}),
  };
}

/**
 * Перехват похода игрока — приказом серверу войны: точку и минуту встречи он посчитает сам (`war.interceptOrder`), а
 * показанную игроку сверит. Полководец идёт к точке встречи и приходит в минуту, названную сервером; бой там считает
 * сервер, итог мир применит на пульсе (`warBattle`, `allyBattle`), домой полководец вернётся сам (`errandBack`).
 */
export async function intercept(world: MeetWorld, f: StoredFigure, w: WarView, now: number): Promise<string | null> {
  const plan = interceptPlan(world, f, w, now);
  if (plan.reason || !plan.meet) return plan.reason ?? MEET_FAR;
  // Налегке дружина тает в пути (ДР-5): приказ несёт состав на выходе — списанный к этой минуте.
  world.wearGeneral(now);
  const from = world.spotOf(f, now);
  const road = roadMs(world, plan.meet.time - now);
  const err = await world.warSend({
    op: 'intercept',
    id: w.id,
    from,
    ...(f.gait ? { gait: f.gait } : {}),
    meet: { x: plan.meet.at.x, y: plan.meet.at.y, at: Math.round(plan.meet.time) },
    shown: now,
    army: {
      troops: { ...(f.troops ?? {}) } as Counts,
      resolve: 0,
      ...spiritOf(world.generalSpirit()),
      pips: { ...world.generalPips() } as Counts,
      ...(f.rest ? { rest: { ...f.rest } } : {}),
      energy: { ...world.energyOf('general', now) },
    },
  });
  if (err) return err;
  const back = world.warList().find((x) => x.id === w.id);
  const meet = back ? world.ourMeet(back) : null;
  f.chase = undefined;
  world.walk('general', clampToWorld(meet?.spot ?? plan.meet.at), now);
  f.arriveAt = Math.max(now, meet?.at ?? Math.round(plan.meet.time));
  world.strikeLeg(now, Math.round(road / world.warPaceOf()), strikeSeed('intercept', w.id, from, road));
  // Цена перехвата — при приказе (как у перехвата набега, `LocalWorld.intercept`).
  world.payEnergy('general', 'chase', now);
  world.write();
  return null;
}

/**
 * Наш перехват на пульсе: поход сменил путь — сервер посчитал встречу заново, и полководец идёт к новой точке к новой минуте;
 * перехват сорвался (`WarMissed`) — полководец встаёт в поле там, где был, и донесение — один раз.
 */
export function chase(world: MeetWorld, f: StoredFigure, w: WarView, seen: Set<string>, now: number): void {
  const me = world.myCastle(w);
  if (!me) return;
  const mine = f.errand?.deed === 'intercept' && f.errand.target === `war-${w.id}`;
  const meet = world.ourMeet(w);
  if (meet && mine && f.phase === 'moving' && (f.arriveAt !== meet.at || distance(f.to, meet.spot) > 0.01)) {
    f.from = world.figureAt(f, now);
    f.departAt = now;
    f.to = clampToWorld(meet.spot);
    f.arriveAt = Math.max(now, meet.at);
  }
  for (const x of w.missed ?? []) {
    const id = warMissedId(w.id, x.castle, x.at);
    if (x.castle !== me || seen.has(id) || x.at > now) continue;
    seen.add(id);
    if (mine) {
      f.errand = undefined;
      f.from = { ...x.spot };
      f.to = { ...x.spot };
      f.departAt = x.at;
      f.arriveAt = x.at;
      f.phase = world.touching(x.spot)?.home ? 'home' : 'field';
      if (f.phase === 'home') world.homecoming(now);
    }
    world.addEffect({
      id,
      lost: {},
      resources: {},
      prestige: 0,
      morale: 0,
      battle: null,
      text: `Перехват сорвался: отряд из «${world.warCity(w, 'atk')}» сменил путь, догнать его уже нельзя. Полководец встал в поле.`,
      good: false,
    });
  }
}

/**
 * Добыча, отбитая перехватом на обратном пути (`WarBattle.regain`): победителю — на склад дверью племени (`addStock`, не выше
 * вместимости), походу — убыль со склада. Один раз, по отметке; у победителя это добро без дела, у похода — убыль без дела:
 * книга запасов сервера знает их по записи войн.
 */
export function regain(world: MeetWorld, w: WarView, b: WarBattle, seen: Set<string>): void {
  if (!b.regain) return;
  const id = warRegainId(b.id);
  if (seen.has(id)) return;
  const take = w.role !== 'atk';
  if (take && !(w.role === 'def' ? !b.ally : Boolean(w.me) && b.ally === w.me)) return;
  seen.add(id);
  const loot = { ...(b.regain as Loot) };
  const n = Object.values(loot).reduce((a: number, v) => a + (v ?? 0), 0);
  const over = take ? world.overflow(loot) : 0;
  const minus = Object.fromEntries(Object.entries(loot).map(([k, v]) => [k, -(v ?? 0)])) as Loot;
  world.addEffect({
    id,
    lost: {},
    resources: take ? loot : minus,
    prestige: 0,
    morale: 0,
    battle: null,
    text: take
      ? `Добычу «${world.warCity(w, 'atk')}» отбили в поле: вернулось ${n} добра.${over > 0 ? ` Не поместилось ${over}: склад полон.` : ''}`
      : `Обоз из «${world.warCity(w, 'def')}» отбили в поле: добыча потеряна.`,
    good: take,
  });
}

/**
 * Слова донесения о бое в поле: у города и у похода (`warBattle`), у союзника (`allyBattle`). `won` — победила ли сторона
 * получателя; `other` — чужой город; `lostText` — потери своими словами донесения; `ally` — у города, когда перехватил его
 * союзник: бой не наш, гарнизон не выходил.
 */
export function fieldWords(
  w: WarView,
  b: WarBattle,
  side: 'atk' | 'def' | 'ally',
  won: boolean,
  other: string,
  lostText: string,
  ally?: string,
): { title: string; text: string } {
  const went = won ? 'отряд разбит' : 'отряд прошёл';
  if (side === 'ally') {
    return {
      title: `Перехват в поле: отряд ${other} ${won ? 'разбит' : 'прошёл'}`,
      text: `Мы вышли навстречу отряду города ${other}, что шёл ${w.phase === 'back' || b.regain ? 'от' : 'на'} союзника: ${went}.${lostText}`,
    };
  }
  if (ally) {
    return {
      title: `Перехват в поле: «${ally}» ${won ? 'разбил' : 'не остановил'} отряд ${other}`,
      text: `Союзник «${ally}» вышел навстречу отряду города ${other}: ${went}. Наш гарнизон в бой не выходил.`,
    };
  }
  const atk = side === 'atk';
  const after = atk ? (won ? ' Отряд идёт дальше.' : ' Остаток отряда отходит домой.') : won ? ' Остаток их отряда отходит домой.' : ' Их отряд идёт дальше.';
  return {
    title: atk
      ? `Перехват из ${other}: ${won ? 'отбились' : 'отряд разбит в поле'}`
      : `Перехват в поле: ${won ? `отряд ${other} разбит${b.regain ? ', добыча отбита' : ''}` : `отряд ${other} прошёл`}`,
    text: `Бой в поле с ${atk ? 'дружиной' : 'отрядом'} города ${other}: ${won ? 'победа' : 'поражение'}.${lostText}${after}`,
  };
}

/** Удар полководца по лагерю игрока под нашими стенами — до приказа: та же `strikeForecast`, что бой. */
export function strikePlan(world: MeetWorld, f: StoredFigure, home: Coord, w: WarView, garrison: boolean, now: number): StrikePlan {
  const rout = perilShare(routPeril(0));
  const no = (reason: string): StrikePlan => ({ can: false, reason, seconds: asGame(0), rear: { went: 0, passed: 0 }, front: null, garrisonable: true, rout });
  const off = world.offDuty('general', now) ?? world.retiringBlock('general');
  if (off) return no(off);
  // Удар по этому лагерю уже идёт — та же проверка: полководец бьёт лагерь у своих стен (BTL-2).
  const busy = world.warGeneralBusy();
  if (busy) return no(busy);
  world.settleHandover(f, now);
  if (f.handover) return no(`Отряд ещё в сборе: ${formatLeft(Math.max(0, f.handover.until - now) / 1000)}.`);
  // Из города лагерь у своих стен бьют вылазкой — этот отказ, а не «отряда нет» (ДР-6, как `strikeCheck`).
  if (inTown(f, now)) return no(STRIKE_FROM_TOWN);
  if (troopTotal(f.troops ?? {}) === 0) return no('При полководце нет отряда.');
  const force = fieldTroops(f, now);
  if (troopTotal(force) === 0) return no(STRIKE_FROM_TOWN);
  const c = world.warWindow(w);
  if (!c) return no('Под этими стенами лагеря нет.');
  const from = world.figureAt(f, now);
  const seconds = world.strikeSeconds(from, home, f.gait);
  const arriveAt = now + realMs(seconds);
  if (arriveAt >= (w.starvesAt ?? Infinity)) return no('Не успеть: хлеб в городе кончится раньше.');
  const going = garrison ? world.garrison(now) : null;
  const cast = strikeForecast(
    { since: siegeSince(c), builders: c.builders ?? 0, gateAt: c.gateAt, rearGateAt: c.rearGateAt, wood: c.wood },
    arriveAt,
    kindsOf(force),
    going ? kindsOf(going) : null,
  );
  const refused = refusedAtGate(cast.rear, cast.front);
  // Удар — бой: цена в энергии — к минуте прихода, с дорогой (та же, что у удара по лагерю логова).
  const energy = world.energyCost('general', 'strike', now, realMs(seconds));
  return {
    can: !refused && !energy.block,
    reason: refused ? gateBusyText(Math.max(cast.rear.waitMs, cast.front?.waitMs ?? 0) + realMs(seconds)) : energy.block,
    seconds,
    rear: { went: cast.rear.went, passed: cast.rear.passed },
    front: cast.front ? { went: cast.front.went, passed: cast.front.passed } : null,
    garrisonable: true,
    rout,
    energy,
  };
}

/**
 * Удар полководца по лагерю игрока: дружина — с тыла, гарнизон, если зовут, — со стороны города. Бой
 * случится в минуту прихода, и считает его сервер; полководец идёт к своим воротам этой же дорогой.
 */
export async function strike(world: MeetWorld, f: StoredFigure, home: Coord, w: WarView, garrison: boolean, now: number): Promise<string | null> {
  const plan = strikePlan(world, f, home, w, garrison, now);
  if (!plan.can) return plan.reason;
  const walkMs = Math.round(realMs(plan.seconds));
  // Налегке дружина тает в пути (ДР-2, М4): уход за дорогу считает сервер (ДР-5, `gait.strikeWorn`), приказ несёт состав на
  // выходе — списанный к этой минуте; мир списывает за дорогу ровно то же (`strikeLeg`).
  world.wearGeneral(now);
  const force = fieldTroops(f, now);
  const from = world.spotOf(f, now);
  const err = await world.warSend({
    op: 'strike',
    id: w.id,
    joint: garrison,
    walkMs,
    from,
    ...(f.gait ? { gait: f.gait } : {}),
    army: {
      troops: force as Counts,
      resolve: 0,
      ...spiritOf(world.generalSpirit()),
      pips: { ...world.generalPips() } as Counts,
      ...(f.rest ? { rest: { ...f.rest } } : {}),
      energy: { ...world.energyOf('general', now) },
    },
  });
  if (err) return err;
  // Полководец идёт к своим воротам той же ходьбой, что всякая фигура (`walk`), а приходит в минуту удара,
  // названную сервером: у сервера может стоять темп войны.
  if (walkMs > 0) {
    f.chase = undefined;
    world.walk('general', { ...home }, now);
    world.strikeLeg(now, Math.round(walkMs / world.warPaceOf()), strikeSeed('strike', w.id, from, walkMs));
    const at = world.warList().find((x) => x.id === w.id)?.strike?.at;
    if (at !== undefined) f.arriveAt = Math.max(now, at);
  }
  // Цена удара — при приказе, как у удара по лагерю логова.
  world.payEnergy('general', 'strike', now);
  world.write();
  return null;
}

/** Поход игрока набегом мира — для положения на карте и дороги: путь войска одной мерой с сервером (`pvpmeet.warMoving`). */
export function asMarch(world: MeetWorld, w: WarView): StoredMarch | null {
  const mv = warMoving(w);
  if (!mv) return null;
  const back = w.phase === 'back';
  const troops = w.army.troops as TroopStack;
  const town = w.role === 'def' ? world.homeName() : world.warCity(w, 'def');
  return {
    id: `war-${w.id}`,
    seed: 0,
    mission: 'raid',
    units: { warrior: troopTotal(troops) },
    own: false,
    fromId: (back ? w.defCastle : w.atkCastle) as SettlementId,
    targetId: back ? (w.atkCastle as SettlementId) : w.role === 'def' ? HOME_ID : (w.defCastle as SettlementId),
    from: { ...mv.from },
    to: { ...mv.to },
    fromName: back ? town : world.warCity(w, 'atk'),
    toName: back ? world.warCity(w, 'atk') : town,
    departAt: mv.departAt,
    arriveAt: mv.arriveAt,
    phase: back ? 'back' : 'out',
    power: Math.round(troopPower(troops)),
    troops: { ...troops },
    loot: null,
  };
}

/**
 * Чужие походы на нас и лагерь под стенами — отрядами на карте и тревогой, как набег логова; поход на союзника по пакту и
 * обратный путь с добычей — тоже (ПЛ-1: их можно перехватить в поле). Положение — нынешним отрезком пути той же мерой, что
 * встреча (`pvpmeet.warMoving`): прежний вид рисовал отряд от выхода, и после смены режима марша он стоял не там, где шёл.
 */
export function marches(world: MeetWorld): MarchView[] {
  const out: MarchView[] = [];
  for (const w of world.warList()) {
    if (w.role === 'atk' || (w.phase !== 'march' && w.phase !== 'camp' && w.phase !== 'back')) continue;
    // Союзнику — только поход на союзника и его обратный путь: лагерь у чужих стен — его выручка, она в карточке города.
    const camp = w.phase === 'camp';
    if (camp && w.role === 'ally') continue;
    const troops = w.army.troops as TroopStack;
    const m = camp ? null : asMarch(world, w);
    out.push({
      id: `war-${w.id}`,
      mission: 'raid',
      units: { warrior: troopTotal(troops) },
      troops: { ...troops },
      own: false,
      hostile: true,
      phase: camp ? 'stay' : w.phase === 'back' ? 'back' : 'out',
      from: m ? m.from : { ...w.from },
      to: m ? m.to : { ...w.to },
      fromName: m ? m.fromName : world.warCity(w, 'atk'),
      toName: m ? m.toName : world.homeName(),
      targetId: m ? m.targetId : HOME_ID,
      departAt: m ? m.departAt : w.sentAt,
      arriveAt: camp ? (w.starvesAt ?? w.arriveAt) : (m?.arriveAt ?? w.arriveAt),
      loot: null,
      recallable: false,
      ...(camp ? { siege: true } : {}),
    });
  }
  return out;
}

/**
 * На выручку союзнику (docs/siege_v2.md, раздел 5): полководец из поля идёт к его городу и бьёт лагерь с тыла в минуту прихода —
 * бой считает сервер войны. Цена удара — при приказе, как у удара по лагерю у своих стен.
 */
export async function relief(world: MeetWorld, f: StoredFigure, c: PlayerCastle, w: WarView, now: number, out: boolean): Promise<string | null> {
  const plan = world.reliefPlan(c, now, out);
  if (!plan?.can) return plan?.reason ?? 'Союзник не в осаде.';
  const walkMs = Math.round(realMs(plan.seconds));
  // Налегке выручка тает в пути (ДР-2, М4): уход за дорогу считает сервер (ДР-5, `gait.strikeWorn`), приказ несёт состав
  // на выходе — списанный к этой минуте; мир списывает за дорогу ровно то же (`strikeLeg`).
  world.wearGeneral(now);
  const force = out && postureOf(f, now) === 'stands' ? { ...(f.troops ?? {}) } : fieldTroops(f, now);
  const from = world.spotOf(f, now);
  const err = await world.warSend({
    op: 'relief',
    id: w.id,
    walkMs,
    // Откуда идёт — сервер сверяет срок с расстоянием и место со слепком (docs/security.md, ЗЩ-2).
    from,
    ...(f.gait ? { gait: f.gait } : {}),
    army: {
      troops: force as Counts,
      resolve: 0,
      ...spiritOf(world.generalSpirit()),
      pips: { ...world.generalPips() } as Counts,
      ...(f.rest ? { rest: { ...f.rest } } : {}),
      energy: { ...world.energyOf('general', now) },
    },
  });
  if (err) return err;
  // Полководец идёт к городу союзника той же ходьбой, что всякая фигура, а приходит в минуту удара, названную сервером.
  f.chase = undefined;
  world.walk('general', { x: c.x, y: c.y }, now);
  world.strikeLeg(now, Math.round(walkMs / world.warPaceOf()), strikeSeed('relief', w.id, from, walkMs));
  const at = world
    .warList()
    .find((x) => x.id === w.id)
    ?.reliefs?.find((r) => r.castle === w.me)?.at;
  if (at !== undefined) f.arriveAt = Math.max(now, at);
  world.payEnergy('general', 'strike', now);
  world.write();
  return null;
}
