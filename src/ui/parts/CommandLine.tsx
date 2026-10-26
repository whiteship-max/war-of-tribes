// Командиры флангов строкой в «Дружине» (ДР-3, docs/siege_v2.md, «Решения ДР-3», К12): кто ведёт левый и правый фланг и
// тактика его фланга; кнопка «Командующие» открывает меню своим куском (`ui/next/CommandDesk`). Здесь только чтение мест
// (`derived.commanderOn`) — первая загрузка растёт на строку.
import { useGame } from '@/game/store';
import { FLANKS } from '@/game/commandrules';
import { commanderOn } from '@/game/derived';
import { commandSeat } from '@/game/sim/command';
import { Icon } from '@/ui/icons/Icon';
import { num } from '@/game/num';

const FLANK_SHORT = { left: 'Левый фланг', right: 'Правый фланг' } as const;

export function CommandLine({ onOpen }: { onOpen: () => void }) {
  const s = useGame((g) => g.s);
  return (
    <>
      {FLANKS.map((f) => {
        const seat = commandSeat(s, f);
        const c = commanderOn(s, f);
        const t = c?.tactics ?? 0;
        return (
          <div className="mod" key={f}>
            <span className="ico">
              <Icon name={c?.birth === 'noble' ? 'est-knights' : 'hud-army'} />
            </span>
            <span className="name">
              {FLANK_SHORT[f]} · {seat ? seat.name : 'ведёт полководец'}
            </span>
            {c && <span className={`val ${t > 0 ? 'good' : t < 0 ? 'bad' : ''}`}>тактика {t > 0 ? `+${num(t, 0)}` : `−${num(-t, 0)}`}</span>}
          </div>
        );
      })}
      <div className="dr-hire">
        <button type="button" className="btn wide cm-open" onClick={onOpen}>
          <Icon name="hud-army" /> Командующие <small>найм и смена</small>
        </button>
      </div>
    </>
  );
}
