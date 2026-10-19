import { useGame } from '@/game/store';
import { PACE_TEXT } from '@/game/data/pace';
import { waitDays } from '@/ui/parts/wait';
import { Leave } from '@/ui/parts/leave';
import { Icon } from '@/ui/icons/Icon';

/**
 * Время в игре пошло медленнее — и партии, начатой до этого, об этом говорят прямо, один раз
 * (docs/time.md, разделы 4 и 17). Ничего не отнято: состояние то же, сроки выросли. Отметку
 * кладёт ступень сохранения 15 → 16 (`GameState.paceNotice`), снимает её это окно.
 *
 * Модалки делят один слой: окно ждёт, пока закроют «С возвращением» и отброшенное сохранение.
 */
export function PaceModal() {
  const notice = useGame((g) => g.s.paceNotice === true);
  const offline = useGame((g) => g.offlineSeconds);
  const legacy = useGame((g) => g.legacyReset);
  const act = useGame((g) => g.act);
  const open = notice && !legacy && offline < 60;
  const dismiss = () =>
    act((s) => {
      delete s.paceNotice;
      return null;
    });
  return (
    <Leave open={open}>
      <div className="modal-backdrop" onClick={dismiss}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="m-ico"><Icon name="ui-time" /></div>
          <h2>{PACE_TEXT.title}</h2>
          <p>{PACE_TEXT.body(waitDays(1))}</p>
          <p>{PACE_TEXT.kept}</p>
          <div className="options">
            <button className="btn" onClick={dismiss}>
              {PACE_TEXT.ok}
            </button>
          </div>
        </div>
      </div>
    </Leave>
  );
}
