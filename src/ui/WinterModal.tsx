import { useGame } from '@/game/store';
import { winterForecast, type ResourceForecast } from '@/game/derived';
import { SEASON_DAYS } from '@/game/data/seasons';
import { gameDaysText } from '@/ui/parts/wait';

const n1 = (x: number): string => String(Math.round(x * 10) / 10);

/**
 * Строка запаса: не «еды маловато», а сколько дней зимы она покроет.
 * Без конкретного числа зима читается как несправедливость, а с ним — как задача.
 */
function Stock({ icon, name, f, days }: { icon: string; name: string; f: ResourceForecast; days: number }) {
  const covered = Math.min(days, Math.floor(f.days * 10) / 10);
  return (
    <div className={`stock${f.ok ? ' ok' : ''}`}>
      <div className="head">
        <span className="ico">{icon}</span>
        <b>{name}</b>
        <span className="days">
          {covered} из {gameDaysText(days)}
        </span>
      </div>
      <div className="progress">
        <div className={f.ok ? 'ok' : 'no'} style={{ width: `${Math.min(100, (covered / days) * 100)}%` }} />
      </div>
      <small>
        {f.drainPerDay > 0
          ? `В запасе ${Math.floor(f.have)}, уходит ${n1(f.drainPerDay)} в день. Нужно на зиму ${Math.ceil(f.need)}.`
          : `В запасе ${Math.floor(f.have)}, зимой племя добывает больше, чем тратит.`}
      </small>
    </div>
  );
}

export function WinterModal() {
  const s = useGame((g) => g.s);
  const dismiss = useGame((g) => g.dismissWinterWarning);
  const openSeason = useGame((g) => g.openTab);
  const offline = useGame((g) => g.offlineSeconds);
  if (!s.winterWarning) return null;
  // Модалки делят один слой: наложенное поверх окна офлайна предупреждение
  // закрыло бы его. Флаг живёт в состоянии, поэтому просто ждём своей очереди.
  // События больше не окно — они ждут в почте державы и слоя не занимают.
  if (offline >= 60 || s.paceNotice) return null;

  const f = winterForecast(s);
  const ready = f.food.ok && f.wood.ok;

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="m-ico">❄️</div>
        <h2>Скоро зима</h2>
        <p>
          Через день поля встанут, сбор просядет, а очаги начнут жечь дрова.
          {f.first ? ' Первая зима будет мягче — но считать запасы стоит уже сейчас.' : ''}
        </p>

        <div className="stocks">
          <Stock icon="🍖" name="Еда" f={f.food} days={SEASON_DAYS} />
          <Stock icon="🌲" name="Дрова" f={f.wood} days={SEASON_DAYS} />
        </div>

        <p className={ready ? 'verdict ok' : 'verdict no'}>
          {ready
            ? 'Запасов хватит на всю зиму. Можно ковать и учить бойцов — казармы и кузница зимы не боятся.'
            : 'Запасов не хватит до весны. Переведи людей на еду и дрова или сократи стройку.'}
        </p>

        <div className="options">
          <button
            className="opt"
            onClick={() => {
              dismiss();
              openSeason('season');
            }}
          >
            <span>Посмотреть множители зимы</span>
            <small>❄️</small>
          </button>
          <button className="btn" onClick={dismiss}>
            Готовимся
          </button>
        </div>
      </div>
    </div>
  );
}
