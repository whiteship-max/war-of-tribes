import { useGame } from '@/game/store';
import { winterForecast, type ResourceForecast } from '@/game/derived';
import { SEASON_DAYS } from '@/game/data/seasons';
import { waitDays } from '@/ui/parts/wait';
import { Leave } from '@/ui/parts/leave';
import { Icon } from '@/ui/icons/Icon';
import type { IconName } from '@/ui/icons/alias';

const n1 = (x: number): string => String(Math.round(x * 10) / 10);

/**
 * Строка запаса: не «еды маловато», а сколько дней зимы она покроет.
 * Без конкретного числа зима читается как несправедливость, а с ним — как задача.
 */
function Stock({ icon, name, f, days }: { icon: IconName; name: string; f: ResourceForecast; days: number }) {
  const covered = Math.min(days, Math.floor(f.days * 10) / 10);
  return (
    <div className={`stock${f.ok ? ' ok' : ''}`}>
      <div className="head">
        <span className="ico"><Icon name={icon} /></span>
        <b>{name}</b>
        <span className="days">
          {waitDays(covered)} из {waitDays(days)}
        </span>
      </div>
      <div className="progress">
        <div className={f.ok ? 'ok' : 'no'} style={{ width: `${Math.min(100, (covered / days) * 100)}%` }} />
      </div>
      <small>
        {f.drainPerDay > 0
          ? `В запасе ${Math.floor(f.have)}, уходит ${n1(f.drainPerDay)} в день, на зиму надо ${Math.ceil(f.need)}.`
          : `В запасе ${Math.floor(f.have)}, зимой добыча больше трат.`}
      </small>
    </div>
  );
}

export function WinterModal() {
  const s = useGame((g) => g.s);
  const offline = useGame((g) => g.offlineSeconds);
  // Модалки делят один слой: наложенное поверх окна офлайна предупреждение
  // закрыло бы его. Флаг живёт в состоянии, поэтому просто ждём своей очереди.
  // События больше не окно — они ждут в почте державы и слоя не занимают.
  const open = s.winterWarning && !(offline >= 60 || s.paceNotice);
  // Закрытое окно ещё тает (`leave.tsx`): тело — своим компонентом, его зовут только открытым.
  return <Leave open={open}>{open && <WinterBody />}</Leave>;
}

function WinterBody() {
  const s = useGame((g) => g.s);
  const dismiss = useGame((g) => g.dismissWinterWarning);
  const openSeason = useGame((g) => g.openTab);
  const f = winterForecast(s);
  const ready = f.food.ok && f.wood.ok;

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="m-ico"><Icon name="season-winter" /></div>
        <h2>Скоро зима</h2>
        <p>
          Скоро поля встанут, а очаги запросят дров.
          {f.first ? ' Первая зима мягче, но запасы считай уже сейчас.' : ''}
        </p>

        <div className="stocks">
          <Stock icon="res-food" name="Еда" f={f.food} days={SEASON_DAYS} />
          <Stock icon="res-wood" name="Дрова" f={f.wood} days={SEASON_DAYS} />
        </div>

        <p className={ready ? 'verdict ok' : 'verdict no'}>
          {ready
            ? 'Амбаров и поленниц хватит до весны.'
            : 'До весны не дотянем. Поставь людей на еду и дрова или придержи стройку.'}
        </p>

        <div className="options">
          <button
            className="opt"
            onClick={() => {
              dismiss();
              openSeason('season');
            }}
          >
            <span>Что меняет зима</span>
            <small><Icon name="season-winter" /></small>
          </button>
          <button className="btn" onClick={dismiss}>
            Готовимся
          </button>
        </div>
      </div>
    </div>
  );
}
