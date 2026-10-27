// Прежний найм агента в здании — только доживание и имена (АГ-1, docs/city_v3.md, «Решения АГ-1»).
//
// С АГ-1 нанимают в Ратуше из кандидатов (`sim/recruits`, запись — `sim/recruit`): сразу, за золото вперёд и жалованье. Здесь
// остались две вещи шага партии: найм прежнего вида, начатый в здании до АГ-1, доходит своим сроком (старое сохранение: идущий
// найм заканчивается как раньше, человек встаёт ровным), и безымянным дают имя, как только мир назвал веру.
import type { FigureId } from '@/world/types';
import type { GameState } from '../types';
import { FIGURE_IDS } from '@/world/data/figures';
import { NEW_GENERAL, nameAgents, seat, titled, yearsWord } from './agents';
import { log } from './log';

/**
 * Где нанимают — словами, для строк «место пустует» (летопись, «Походы», кольцо карты): с АГ-1 всех четверых — в Ратуше, в
 * разделе «Агенты» (`sim/recruits`). Профильные здания работают по-прежнему, а их кнопка найма ведёт туда же.
 */
export function hireWhere(_s: GameState, _agent: FigureId): string {
  return 'в Ратуше';
}

/**
 * Шаг партии для мест агентов: пришёл нанятый — встаёт на место; безымянным дать имя,
 * если вера уже известна. Возвращает, изменилось ли что-нибудь.
 */
export function settleHires(s: GameState): boolean {
  let changed = nameAgents(s);
  for (const id of FIGURE_IDS) {
    const hiring = s.agents[id].hiring;
    if (!hiring || s.time < hiring.until) continue;
    seat(s, id, hiring.until, hiring.age0, hiring.name);
    const p = s.agents[id];
    log(s, `${titled(s, id)} встал на место, ${yearsWord(Math.floor(p.age0))}.`, 'good');
    // Отряд в городе не собирают (ДР-6): его дают в окне дела, перед выходом. Сказано сразу — тревога держится до первого дела.
    if (id === 'general') log(s, NEW_GENERAL, 'info');
    changed = true;
  }
  return changed;
}
