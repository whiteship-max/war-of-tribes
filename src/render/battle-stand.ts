// Стенд ролика о бое. Открывается по ?replay=… и заменяет собой игру — так же,
// как ?showcase=… заменяет её стендом графики. Стенд не часть визуализации: он
// сам считает бой, чтобы было что проигрывать (`standBattle`), а показывает его
// ролик TW (`tw/stand.ts`, параметры — там же). Прежний ролик удалён вместе со
// своим стендом (docs/ui_audit.md, 16).
import { simulateBattle } from '@/battle/sim';
import { deploySetup, emptyStack, stackTotal } from '@/battle/setup';
import { troopsOfKinds } from '@/game/battle/faces';
import { type BattleLand, type BattlePlace } from '@/game/battle/ground';
import { DAY_LENGTH } from '@/game/constants';
import { type TroopStack } from '@/game/battle/kinds';
import { kindsOf } from '@/game/battle/price';
import { HORSE_KINDS, type BattleResult, type GroundPenalty, type Side, type Stack } from '@/battle/types';
import { wallFront, type Assault, type Opening, type WallFront } from '@/world/wall';

/**
 * Состав по числу бойцов: сбалансированное войско, доли те же на любом размере.
 * Виды настоящие и разные — стенд обязан показывать то же, что игра, а на
 * близком плане ровно это и проверяется: видно, кого собрал.
 */
export function armyOf(men: number): TroopStack {
  const part = (k: number): number => Math.max(0, Math.round(men * k));
  return {
    spearman: part(0.25),
    legionary: part(0.12),
    swordsman: part(0.13),
    clubman: part(0.1),
    archer: part(0.25),
    rider: part(0.15),
  };
}

/**
 * Место боя из адреса — той же формы, что кладёт в запись мира. Стенд обязан
 * ходить тем же путём, что игра: если бы он собирал `Ground` напрямую, кадры
 * приёмки ничего не доказывали бы про настоящий ролик.
 */
function placeOf(p: URLSearchParams): BattlePlace | undefined {
  const marks = (p.get('place') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const hour = p.has('hour') ? Number(p.get('hour')) : null;
  const winter = p.get('winter') === '1';
  if (marks.length === 0 && hour === null && !winter) return undefined;
  const land: BattleLand = marks.includes('shore') ? 'shore' : marks.includes('hills') ? 'hills' : 'plain';
  const place: BattlePlace = { land };
  if (marks.includes('river') || marks.includes('ford')) place.river = true;
  if (marks.includes('ford')) place.ford = true;
  if (marks.includes('ridge')) place.ridge = true;
  if (marks.includes('road')) place.road = true;
  if (marks.includes('woods')) place.woods = true;
  // Час и время года приходят одним числом — игровым временем племени, ровно
  // как в игре. Зима — это просто день из зимнего сезона (`SEASON_DAYS`).
  const day = winter ? 15 : 0;
  place.time = (day + (hour === null ? 0.5 : hour / 24)) * DAY_LENGTH;
  return place;
}

/**
 * Штраф места нападающему — как его кладёт мир (`world/place.groundAt`, таблица EU4): лес и холмы −1, гребень −2,
 * переправа −1. Числа здесь, а не импортом: таблица мира живёт в куске первой загрузки, и ленивый стенд вытянул бы
 * её наружу лишним именем; что они те же, сверяет тест (`tw/plan.test.ts`). `&ground=0` — бой без штрафа.
 */
export const STAND_GROUND = { land: 1, ridge: 2, crossing: 1 } as const;

export function standGround(place: BattlePlace | undefined): GroundPenalty | undefined {
  if (!place) return undefined;
  let land = place.land === 'hills' || place.woods ? STAND_GROUND.land : 0;
  if (place.ridge) land = Math.max(land, STAND_GROUND.ridge);
  const crossing = place.river ? STAND_GROUND.crossing : 0;
  const out: GroundPenalty = {};
  if (land > 0) out.land = land;
  if (crossing > 0) out.crossing = crossing;
  return land > 0 || crossing > 0 ? out : undefined;
}

function fight(a: Stack, d: Stack, seed: number, ground?: GroundPenalty, garrison?: Stack, front?: WallFront | null): BattleResult {
  // Обе стороны встают по правилу развёртывания — как в игре: пресетов больше нет (docs/battle_eu4.md, 14.5). Штраф
  // места — только нападающему, как у мира (`world/battle.resolveField`). Кто из ворот (совместный удар) — наблюдение ядра.
  // Штурм с проёмами (`&open=`) — стеной-проходом мира (`world/wall`): ширина, грань стены, ворота посреди боя, конница
  // без прохода стоит у стены — тем же правилом, что `fights.horseHeld` мира (дверь мира стенд не тянет: она тяжела).
  const kinds = { ...a };
  if (front && !front.horse) for (const k of HORSE_KINDS) kinds[k] = 0;
  const wallGround = front && front.wall > 0 ? { ...(ground ?? {}), wall: front.wall } : ground;
  return simulateBattle({
    seed,
    attacker: { ...deploySetup(kinds), ...(wallGround ? { ground: wallGround } : {}), ...(garrison ? { garrison } : {}) },
    defender: deploySetup(d),
    ...(front ? { width: front.width, fire: front.fire, ...(front.widen ? { widen: front.widen } : {}) } : {}),
  });
}

/** Проёмы штурма из адреса: `&open=ladders,ram,tower,b2` — машины и проломы; `&open=scaling` — лестницы на себе. */
function assaultOf(open: string | null): Assault | null {
  if (!open) return null;
  const parts = open.split(',');
  const b = parts.find((x) => /^b[0-3]$/.test(x));
  return {
    ...(b ? { breaches: Number(b.slice(1)) } : {}),
    ...(parts.includes('ladders') ? { ladders: true } : {}),
    ...(parts.includes('ram') ? { ram: true } : {}),
    ...(parts.includes('tower') ? { tower: true } : {}),
  };
}

/** Бой стенда из адреса: состав, место и час — тем же путём, что в игре. Его же берёт стенд ролика TW (`tw/stand.ts`). */
export interface StandBattle {
  men: number;
  foe: number;
  seed: number;
  beasts: boolean;
  us: Side;
  result: BattleResult;
  troops: Record<Side, TroopStack>;
  place: BattlePlace | undefined;
  /** Чья сторона — стая (`BattleRecord.beasts`). */
  beastSide: Side | undefined;
  /** Место боя (`BattleRecord.site`, ролик TW): `&site=wall|gate|sortie|camp|joint|lair`. */
  site: string | undefined;
  /** Ополчение у своих ворот (`BattleRecord.militia`): на штурме стены и у ворот — как `gateField` мира. */
  militia: Record<Side, { men: number; archers: number }> | undefined;
  /** Залпов обстрела перед штурмом (`BattleRecord.shots`, ролик TW, раздел 15): `&shots=1..3`; нет — без обстрела. */
  shots: number | undefined;
  /** Проёмы штурма (`BattleRecord.openings`): `&open=` на `site=wall`; нет — прежний штурм без стены-прохода. */
  openings?: Opening[];
}

export function standBattle(p: URLSearchParams): StandBattle {
  const men = Number(p.get('men') ?? 200);
  const foe = Number(p.get('foe') ?? men);
  const seed = Number(p.get('seed') ?? 7);
  const beasts = p.get('beasts') === '1';
  const us = (p.get('us') as Side) ?? (beasts ? 'defender' : 'attacker');
  const mine = armyOf(men);
  const theirs = p.get('foeKinds') === '1' ? null : armyOf(foe);
  const place = placeOf(p);
  const ground = p.get('ground') === '0' ? undefined : standGround(place);
  const site = p.get('site') ?? undefined;
  const shots = Number(p.get('shots') ?? 0) || undefined;
  // У своих ворот и на стене к гарнизону встаёт ополчение — жители, частокол и башня (`gateField` мира).
  const home = site === 'wall' || site === 'gate';
  const militiaMen = home ? Number(p.get('militia') ?? Math.round(men * 0.4)) : 0;
  const militiaArchers = home ? Math.min(militiaMen, Number(p.get('archers') ?? Math.round(militiaMen / 3))) : 0;
  const militia = home ? { attacker: { men: 0, archers: 0 }, defender: { men: militiaMen, archers: militiaArchers } } : undefined;
  const withMilitia = (k: Stack): Stack => ({ ...k, infantry: k.infantry + militiaMen - militiaArchers, archer: k.archer + militiaArchers });
  if (beasts) {
    // Стая у ворот — как в игре: волки нападают лёгкой конницей без снаряжения, состава племени у них нет, и
    // запись боя несёт только их сторону (`BattleRecord.beasts`).
    const result = fight({ ...emptyStack(), cavalry: foe }, withMilitia(kindsOf(mine)), seed, ground);
    return { men, foe, seed, beasts, us, result, troops: { attacker: {}, defender: mine }, place, beastSide: 'attacker', site, militia, shots };
  }
  if (home) {
    // Штурм стены и бой у ворот: пришедшие нападают, мы обороняем — `men` наш гарнизон, `foe` пришедшие. `&us=attacker` на
    // штурме — наоборот (снимки П-6: город глазами нападающего): `men` — наши на стену, `foe` — гарнизон с ополчением.
    const raiders = theirs ?? armyOf(foe);
    const assault = site === 'wall' ? assaultOf(p.get('open')) : null;
    const front = assault ? wallFront(assault) : null;
    const storming = site === 'wall' && p.get('us') === 'attacker';
    const result = storming ? fight(kindsOf(mine), withMilitia(kindsOf(raiders)), seed, ground, undefined, front) : fight(kindsOf(raiders), withMilitia(kindsOf(mine)), seed, ground, undefined, front);
    return {
      men,
      foe,
      seed,
      beasts,
      us: storming ? 'attacker' : 'defender',
      result,
      troops: storming ? { attacker: mine, defender: raiders } : { attacker: raiders, defender: mine },
      place,
      beastSide: undefined,
      site,
      militia,
      shots,
      ...(front ? { openings: front.openings } : {}),
    };
  }
  // Совместный удар: часть наших вышла из ворот — `&garrison=` бойцов (по умолчанию 40 %), в той же доле каждого рода, как
  // мир отдаёт ядру прошедший гарнизон (`LocalWorld.campBattle`).
  const ours = kindsOf(mine);
  const share = site === 'joint' ? Math.max(0, Math.min(1, Number(p.get('garrison') ?? Math.round(men * 0.4)) / Math.max(1, stackTotal(ours)))) : 0;
  const garrison = share > 0 ? (Object.fromEntries(Object.entries(ours).map(([k, n]) => [k, Math.round(n * share)])) as Stack) : undefined;
  const result = fight(ours, theirs ? kindsOf(theirs) : { ...emptyStack(), infantry: foe }, seed, ground, garrison);
  // Чужой состав — как в игре: из родов и ступени снаряжения (`foeKinds=1` показывает именно этот путь, а не поимённый).
  const foeTroops = theirs ?? troopsOfKinds(result.sides.defender.initial, { infantry: 3 });
  return { men, foe, seed, beasts, us, result, troops: { attacker: mine, defender: foeTroops }, place, beastSide: undefined, site, militia: undefined, shots };
}

export function mountReplayStand(p: URLSearchParams): void {
  // Ролик один — в стиле Total War (docs/battle_tw.md), прежний удалён (docs/ui_audit.md, 16): любой `?replay=`
  // открывает его стенд. Свой кусок — в стенд боя он не едет. `&layer=1` — ролик тем же слоем, что в игре (`TwReplay`:
  // шкала сил, кнопки, карточка итога), на записи боя стенда; `&at=` — кадр стоит на моменте (docs/gfx.md, «Кадры»).
  // `?replay=siege` — ролик осады (docs/gfx.md, ГФ-2): свой стенд и свой кусок.
  if (p.get('replay') === 'siege') {
    if (p.get('layer') === '1') void import('./siege/stand').then((m) => m.mountSiegeStandUi(p));
    else void import('./siege/stand').then((m) => m.mountSiegeStand(p));
    return;
  }
  if (p.get('layer') === '1') void import('./tw/stand').then((m) => m.mountTwStandUi(p));
  else void import('./tw/stand').then((m) => m.mountTwStand(p));
}
