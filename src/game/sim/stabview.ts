// Стабильность словами: вид раздела «Стабильность» и прогноз вестей в бот (docs/stability.md, разделы 1 и 2.8).
//
// Чисел здесь нет: веса причин, полосы и давление считает дверь `sim/stability` (`folkParts`, `hungryParts`, `barsOf`,
// `pressureParts`) — здесь к её числам приставляются значок, имя, пояснение и дверь «где изменить». Модуль едет куском меню
// державы и прогнозом вестей (`world/store` берёт его, когда составляет список): шагу партии слова не нужны, и первая
// загрузка за них не платит.
import type { EstateId, GameState, StabGroup } from '../types';
import type { MoraleBreakdown } from '../derived';
import { DAY_LENGTH, MUTINY_FUSE } from '../constants';
import { asGame, type GameSec } from '../pace';
import { bondedTotal, buildingOfType, decreeOf, estatesNow, moraleBreakdown, mutinyOpen, orderBreakdown, orderState, payGraceDays, rationOf, taxOf, unrestLeft } from '../derived';
import { GROUP_META, stabName } from '../data/stability';
import { ESTATE_META, estateVerb } from '../data/estates';
import { BOON_BY_ID } from '../data/boons';
import { GROUP_RISE, REVOLT_AT, REVOLT_NEAR } from '../stabrules';
import { barsOf, folkParts, hungryParts, pressureParts, stabLevel, stabOf, targetOf, type Part } from './stability';
import type { IconName } from '@/ui/icons/alias';

/** Куда ведёт «Где изменить»: имя двери интерфейса, а не сама дверь — симуляция интерфейса не знает. */
export type StabGo = 'decrees' | 'storage' | 'build' | 'faith' | 'army' | 'order' | 'market' | 'tech' | 'mail' | 'estates';

/** Строка разбора: слагаемое давления (% ступени в день) или причина недовольства (%). */
export interface StabLine {
  id: string;
  icon: IconName;
  name: string;
  value: number;
  /** Откуда число — живыми величинами партии. */
  hint: string;
  go?: StabGo;
}

/** Полоса группы: где она, куда идёт и когда мятеж. */
export interface GroupView {
  id: StabGroup;
  /** Полоса, %. */
  value: number;
  /** Куда идёт (у податных и голодных), %. У невольников и войска цели нет — у них срок. */
  target: number | null;
  /** Растёт ли полоса сейчас. */
  rising: boolean;
  /** Сколько игровых секунд до мятежа (у войска — до ухода), если растёт к нему; null — не грозит. */
  eta: GameSec | null;
  /** Причины. */
  lines: StabLine[];
}

type Face = Omit<StabLine, 'id' | 'value'>;

/** Лицо слагаемого по имени: значок, имя, пояснение и дверь — по нынешнему состоянию партии. */
const FACE: Record<string, (s: GameState) => Face> = {
  tax: (s) => ({ icon: 'res-gold', name: `Налог: ${taxOf(s).name.toLowerCase()}`, hint: taxOf(s).effect, go: 'decrees' }),
  decree: (s) => ({ icon: 'ui-scroll', name: `Указ: ${decreeOf(s).name}`, hint: decreeOf(s).effect, go: 'decrees' }),
  crowding: () => ({ icon: 'ui-ruin', name: 'Теснота', hint: 'жителей больше, чем крыш', go: 'build' }),
  freezing: () => ({ icon: 'season-winter', name: 'Город мёрзнет', hint: 'дрова кончились', go: 'storage' }),
  heresy: () => ({ icon: 'ui-flame', name: 'Вера трещит', hint: 'набожность ниже раскола', go: 'faith' }),
  rite: () => ({ icon: 'ui-candle', name: 'Обряд', hint: 'идёт обряд в храме', go: 'faith' }),
  stab: (s) => ({ icon: 'ui-pillar', name: 'Стабильность', hint: stabName(stabLevel(s)) }),
  clergy: () => ({ icon: ESTATE_META.clergy.icon, name: 'Проповедь терпения', hint: 'духовенство в силе гасит налог', go: 'estates' }),
  starving: () => ({ icon: 'ui-skull', name: 'Закрома пусты', hint: 'еды нет', go: 'storage' }),
  hungry: () => ({ icon: 'res-food', name: 'Голодно', hint: 'еды меньше чем на сутки', go: 'storage' }),
  'siege-ration': () => ({ icon: 'ui-bowl', name: 'Осадный паёк', hint: 'еды урезано', go: 'storage' }),
  ration: (s) => ({ icon: 'ui-loaf', name: `Паёк: ${rationOf(s).name.toLowerCase()}`, hint: rationOf(s).effect, go: 'decrees' }),
  calm: () => ({ icon: 'ui-home', name: 'Тихие дни', hint: 'ровная жизнь держит лад' }),
  // Статуя Героя (ДР-7): памятник держит лад вместе с тихими днями; дверь — стройка, где её поднимают.
  statue: (s) => ({ icon: 'bld-statue', name: 'Статуя Героя', hint: `ур. ${buildingOfType(s, 'statue')?.level ?? 0}: гордость города`, go: 'build' }),
  siege: (s) => ({ icon: 'ui-warning', name: 'Осада у стен', hint: `под стенами ${s.siege?.byName ?? 'враг'}` }),
};

/** Пояснение ропота сословия: влияние и лояльность — числами партии. */
const estateHint = (s: GameState, e: EstateId): string => {
  const n = estatesNow(s)[e];
  return `влияние ${Math.round(n.infl)} %, лояльность ${Math.floor(n.loyalty)}`;
};

/** Слагаемые словами. Слагаемое группы (`g-…`) — её значком и именем, пояснение — полоса. */
function faced(s: GameState, parts: readonly Part[], bars?: Record<StabGroup, number>): StabLine[] {
  return parts.map((p) => {
    const group = p.id.startsWith('g-') ? (p.id.slice(2) as StabGroup) : null;
    const boon = p.id.startsWith('boon:') ? BOON_BY_ID[p.id.slice(5)] : undefined;
    const estate = p.id.startsWith('estate:') ? (p.id.slice(7) as EstateId) : null;
    const face: Face = group
      ? { icon: GROUP_META[group].icon, name: `${GROUP_META[group].name} недовольны`, hint: `полоса ${Math.round(bars?.[group] ?? 0)} %` }
      : boon
        ? { icon: boon.icon, name: boon.name, hint: 'след вести державы', go: 'mail' }
        : estate
          ? { icon: ESTATE_META[estate].icon, name: `${ESTATE_META[estate].name} ${estateVerb(estate, 'ропщет', 'ропщут')}`, hint: estateHint(s, estate), go: 'estates' }
          : FACE[p.id](s);
    return { id: p.id, value: p.value, ...face };
  });
}

/** Причины недовольства податных словами. */
export const folkCauses = (s: GameState, mb: MoraleBreakdown = moraleBreakdown(s)): StabLine[] => faced(s, folkParts(s, mb));

/** Причины недовольства голодных словами. */
export const hungryCauses = (s: GameState, mb: MoraleBreakdown = moraleBreakdown(s)): StabLine[] => faced(s, hungryParts(s, mb));

/** Срок до ста при полосе `v`, идущей к цели `t` (только если цель — мятеж). */
const etaTo = (v: number, t: number): GameSec | null => (t >= REVOLT_AT && v < 100 ? asGame(((100 - v) / GROUP_RISE) * DAY_LENGTH) : null);

/** Полосы всех четырёх групп — для раздела. */
export function groupsOf(s: GameState, mb: MoraleBreakdown = moraleBreakdown(s)): GroupView[] {
  const st = stabOf(s);
  const revolt = st.revolt?.group;
  const bars = barsOf(s);
  const folkLines = folkCauses(s, mb);
  const hungryLines = hungryCauses(s, mb);
  const fT = targetOf(folkLines);
  const hT = targetOf(hungryLines);
  const ropot = orderState(s) === 'unrest';
  const late = s.pay?.late ?? 0;
  const grace = payGraceDays(s) * DAY_LENGTH;
  const order = orderBreakdown(s);
  return [
    { id: 'folk', value: bars.folk, target: fT, rising: revolt !== 'folk' && fT > bars.folk, eta: revolt ? null : etaTo(bars.folk, fT), lines: folkLines },
    { id: 'hungry', value: bars.hungry, target: hT, rising: revolt !== 'hungry' && hT > bars.hungry, eta: revolt ? null : etaTo(bars.hungry, hT), lines: hungryLines },
    {
      id: 'bonded',
      value: bars.bonded,
      target: null,
      rising: ropot && !mutinyOpen(s),
      eta: ropot ? unrestLeft(s) : null,
      lines:
        bondedTotal(s) > 0
          ? [{ id: 'order', icon: 'hud-order', name: `Порядок ${Math.round(order.value)}`, value: ropot ? 100 : 0, hint: `надзор держит ${Math.round(order.hold)} из ${order.bonded}`, go: 'order' }]
          : [],
    },
    {
      id: 'army',
      value: bars.army,
      target: null,
      rising: late > 0 && bars.army < 100,
      eta: late > 0 && bars.army < 100 ? asGame(Math.max(0, grace - late)) : null,
      lines:
        late > 0
          ? [{ id: 'pay', icon: 'hud-army', name: (s.pay?.debt ?? 0) > 0 ? 'Жалованье не плачено' : 'Дружине нечего есть', value: 100, hint: 'терпит до срока Статуи', go: 'army' }]
          : [],
    },
  ];
}

/** Что влияет на стабильность словами: слагаемые давления, % ступени за игровой день. */
export function pressureOf(s: GameState, groups: readonly GroupView[] = groupsOf(s)): { lines: StabLine[]; total: number } {
  const bars = Object.fromEntries(groups.map((g) => [g.id, g.value])) as Record<StabGroup, number>;
  const lines = faced(s, pressureParts(s, bars), bars);
  return { lines, total: lines.reduce((n, l) => n + l.value, 0) };
}

// ---------- Вести в бот ----------

/** Когда полоса дойдёт до «мятеж близок» и до мятежа (у войска — до ухода), игровых секунд от сейчас; null — не дойдёт. */
export interface StabForecast {
  group: StabGroup;
  near: GameSec | null;
  revolt: GameSec | null;
}

/**
 * Прогноз полос для вестей в бот (docs/stability.md, 2.8): при нынешних причинах — когда полоса перейдёт «мятеж близок»
 * (`REVOLT_NEAR`) и когда дойдёт до мятежа. Скорость — та же, что у шага (`GROUP_RISE`, срок ропота, срок Статуи): своей
 * арифметики у прогноза нет. Мятеж на столе и полоса, которая не растёт, — без прогноза: о них игрок уже знает или нечего.
 */
export function stabForecast(s: GameState): StabForecast[] {
  const st = stabOf(s);
  const out: StabForecast[] = [];
  const days = (from: number, to: number): GameSec => asGame((Math.max(0, to - from) / GROUP_RISE) * DAY_LENGTH);
  const mb = moraleBreakdown(s);
  if (!st.revolt) {
    for (const [group, parts] of [
      ['folk', folkParts(s, mb)],
      ['hungry', hungryParts(s, mb)],
    ] as const) {
      const v = st[group];
      const t = Math.min(100, targetOf(parts));
      if (t < REVOLT_NEAR || t <= v) continue;
      out.push({ group, near: days(v, REVOLT_NEAR), revolt: t >= REVOLT_AT ? days(v, 100) : null });
    }
  }
  if (orderState(s) === 'unrest' && !mutinyOpen(s)) {
    const u = Math.max(0, s.unrest ?? 0);
    out.push({ group: 'bonded', near: asGame(Math.max(0, (REVOLT_NEAR / 100) * MUTINY_FUSE - u)), revolt: asGame(Math.max(0, MUTINY_FUSE - u)) });
  }
  const late = Math.max(0, s.pay?.late ?? 0);
  const grace = payGraceDays(s) * DAY_LENGTH;
  if (late > 0 && late < grace) out.push({ group: 'army', near: asGame(Math.max(0, (REVOLT_NEAR / 100) * grace - late)), revolt: null });
  return out;
}

