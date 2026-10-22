// Окно вести державы (СБ-2): «что изменится» до выбора — строками со значком, по ответу. Чисел своих здесь нет: стабильность
// — сдвиг той же двери (`sim/stability.stabNudge`), примеренный на копии партии, остальное — последствия вести
// (`sim/crown.crownFx`) и таблица правил (`crownrules`). Показано то, что ответ и сделает (правило 18).
import type { GameState } from '@/game/types';
import type { IconName } from '@/ui/icons/alias';
import { CROWN_RULES, crownStab } from '@/game/crownrules';
import { CROWN_BY_ID, type Fx } from '@/game/data/crown';
import { BOON_BY_ID, boonWords } from '@/game/data/boons';
import { RESOURCE_META } from '@/game/constants';
import { stabName } from '@/game/data/stability';
import { daysSpan } from '@/game/span';
import { SEASON_DAYS } from '@/game/data/seasons';
import { crownFx } from '@/game/sim/crown';
import { stabNudge, stabOf, stabLevel } from '@/game/sim/stability';
import { STAB_MAX, STAB_MIN } from '@/game/stabrules';
import { people } from '@/game/data/eventKit';
import { BRANCH_ICON, BRANCH_WORD } from './branches';

/** Строка «что изменится»: значок, слова и к лучшему ли это. */
export interface FxLine {
  icon: IconName;
  text: string;
  tone: 'good' | 'bad' | 'flat';
}

const sign = (n: number): string => (Math.round(n) === 0 ? '0' : `${n > 0 ? '+' : '−'}${Math.abs(Math.round(n))}`);
const pct = (n: number): string => `${sign(n)} %`;

/** Стабильность после ответа — примеркой на копии: та же дверь и те же края, что у ответа. */
export function stabLine(s: GameState, d: number): FxLine | null {
  if (d === 0) return null;
  const was = stabOf(s);
  // Сдвиг трогает только стабильность и летопись: копии хватает своих этих двух полей.
  const copy: GameState = { ...s, stab: s.stab ? structuredClone(s.stab) : undefined, log: [] };
  stabNudge(copy, d);
  const now = stabOf(copy);
  const tone = d > 0 ? 'good' : 'bad';
  const icon: IconName = 'ui-pillar';
  if (now.level !== was.level) return { icon, tone, text: `Стабильность: «${stabName(was.level)}» → «${stabName(now.level)}»` };
  if (Math.round(now.drift) !== Math.round(was.drift)) {
    return { icon, tone, text: `Стабильность ${pct(d)} ступени: сдвиг ${pct(was.drift)} → ${pct(now.drift)}` };
  }
  // Край шкалы: сдвиг не копится — сказано прямо, чтобы обещание не висело пустым.
  const why = d > 0 && stabLevel(s) >= STAB_MAX ? 'выше некуда' : d < 0 && stabLevel(s) <= STAB_MIN ? 'ниже некуда' : 'без перемен';
  return { icon, tone: 'flat', text: `Стабильность ${pct(d)} ступени: ${why}` };
}

/** Одно последствие строкой. */
export function fxLine(f: Fx): FxLine | null {
  switch (f.k) {
    case 'boon': {
      const b = BOON_BY_ID[f.id];
      if (!b) return null;
      const worse = (b.folk ?? 0) > 0 || (b.hungry ?? 0) > 0 || Object.values(b.jobs ?? {}).some((m) => (m ?? 1) < 1) || (b.morale ?? 0) < 0;
      return { icon: b.icon, tone: worse ? 'bad' : 'good', text: `${b.name}: ${boonWords(b).toLowerCase()} — ${daysSpan(b.days)}` };
    }
    case 'res':
      return { icon: `res-${f.r}` as IconName, tone: f.n > 0 ? 'good' : 'bad', text: `${RESOURCE_META[f.r].name} ${sign(f.n)}` };
    case 'gold':
      return { icon: 'res-gold', tone: f.n > 0 ? 'good' : 'bad', text: `Золото ${sign(f.n)}` };
    case 'fame':
      return { icon: 'ui-crown', tone: f.n > 0 ? 'good' : 'bad', text: `Слава ${sign(f.n)}` };
    case 'morale':
      return { icon: 'bat-morale', tone: f.n > 0 ? 'good' : 'bad', text: `Мораль ${sign(f.n)}` };
    case 'strain':
      return { icon: 'ui-flame', tone: 'bad', text: `Надлом веры +${Math.round(f.n)}` };
    case 'pop':
      return { icon: 'nav-people', tone: 'bad', text: `${f.died ? 'Умрут' : 'Уйдут'} ${people(-f.n)}` };
    case 'bonded':
      return { icon: 'ui-chain', tone: 'bad', text: `Невольников ${sign(f.n)}` };
    case 'relic':
      return { icon: 'ui-candle', tone: 'good', text: 'Святыня в храм' };
    case 'chain': {
      const next = CROWN_BY_ID[f.id];
      const good = CROWN_RULES[f.id]?.opts.every((o) => o.stab >= 0) ?? false;
      const when = daysSpan(f.seasons * SEASON_DAYS);
      const text = f.p >= 1 ? `Через ${when} — «${next?.title ?? ''}»` : `Риск ${Math.round(f.p * 100)} %: «${next?.title ?? ''}» через ${when}`;
      return { icon: good ? 'ui-dove' : 'ui-warning', tone: good ? 'good' : 'bad', text };
    }
  }
}

/** Всё, что изменит ответ `i` вести `id`, — стабильность, очки, цена очками и последствия. Цена со склада — строкой `Cost`. */
export function crownLines(s: GameState, id: string, i: number): FxLine[] {
  const out: FxLine[] = [];
  const st = stabLine(s, crownStab(id, i));
  if (st) out.push(st);
  const gain = CROWN_RULES[id]?.opts[i]?.gain;
  if (gain) out.push({ icon: BRANCH_ICON[gain[0]], tone: 'good', text: `${BRANCH_WORD[gain[0]]}: +${gain[1]} очков` });
  for (const [b, n] of Object.entries(CROWN_BY_ID[id]?.opts[i]?.points ?? {}) as [keyof typeof BRANCH_WORD, number][]) {
    if (n > 0) out.push({ icon: BRANCH_ICON[b], tone: 'bad', text: `${BRANCH_WORD[b]}: −${n} очков` });
  }
  for (const f of crownFx(s, id, i)) {
    const l = fxLine(f);
    if (l) out.push(l);
  }
  return out;
}
