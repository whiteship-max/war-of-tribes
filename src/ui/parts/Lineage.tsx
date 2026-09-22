// Родословная места: кто стоял на нём до нынешнего. Разметка только раскладывает
// записи — запись делает одна дверь (`sim/agents.vacate`), и в ней уже всё
// посчитано: уровень, дела, годы, чем кончил и чем прослыл.
import { useGame } from '@/game/store';
import { LINEAGE_KEEP, LINEAGE_LEVEL } from '@/game/data/traits';
import { REALM_BRANCHES, SKILL_NAME } from '@/game/data/realm';
import { levelOfWord, levelWord, yearsWord } from '@/game/sim/agents';
import type { LineagePlace } from '@/game/types';
import { count } from './plural';
import { traitNames } from './traitLines';

export function Lineage({ id }: { id: LineagePlace }) {
  const s = useGame((g) => g.s);
  const rows = s.lineage?.[id] ?? [];
  const keep = LINEAGE_KEEP[id];
  if (keep <= 0) return null;
  return (
    <>
      <h3>
        Родословная <span className="muted">{rows.length > 0 ? `последние ${rows.length} из ${keep}` : 'пуста'}</span>
      </h3>
      <div className="note">
        {id === 'ruler'
          ? 'Здесь помнят всех, кто правил: уровня у правителя нет, у него три навыка — с ними он и остаётся в памяти.'
          : `Здесь помнят всех, кто погиб, и тех, кто ушёл на покой, дослужив хотя бы до ${levelOfWord(LINEAGE_LEVEL)} уровня.`}{' '}
        Новые — первыми; больше {count(keep, 'имени', 'имён', 'имён')} не хранится.
      </div>
      {rows.map((r, i) => (
        <div key={`${r.name}-${i}`} className="mod">
          <span className="ico">{r.end === 'fell' ? '⚰️' : '🕯️'}</span>
          <span className="name">
            {r.name}
            <em className="sub">
              {r.from}–{yearsWord(r.to)} ·{' '}
              {r.skills
                ? REALM_BRANCHES.map((b) => `${SKILL_NAME[b]} ${r.skills?.[b]}`).join(', ')
                : `${levelWord(r.level)} уровень · ${count(r.deeds, 'дело', 'дела', 'дел')}`}
              {r.traits.length > 0 ? ` · ${traitNames(r.traits)}` : ''}
            </em>
          </span>
          <span className={`val${r.end === 'fell' ? ' neg' : ''}`}>
            {r.end === 'fell' ? 'погиб' : id === 'ruler' ? 'оставил правление' : 'на покое'}
          </span>
        </div>
      ))}
    </>
  );
}
