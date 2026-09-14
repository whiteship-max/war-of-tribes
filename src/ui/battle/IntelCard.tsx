// Разведданные рядом с расстановкой: игрок должен иметь возможность контрить,
// не выходя и не запоминая. Чего разведка не даёт — план, приказы, резерв —
// здесь не появится никогда: на этом держится вся неопределённость системы.
//
// Прогноза исхода и шансов на победу тут нет и быть не может. Показав вероятность,
// мы убили бы и разведку, и блеф.
import { FRONT, KIND_META, REAR, SECTOR_NAME, UNIT_KINDS, type Stack } from '@/battle';
import { formatAge, formatEstimate, PRECISION_NOTE } from '@/world/intel';
import type { IntelReading } from '@/world/types';

/** Короткая подпись сектора для сетки 3×2. */
const SHORT: Record<string, string> = {
  A: 'лев. фланг',
  B: 'центр',
  C: 'прав. фланг',
  D: 'лев. тыл',
  E: 'тыл центра',
  F: 'прав. тыл',
};

function Cell({ id, stack }: { id: string; stack: Stack | undefined }) {
  const parts = stack ? UNIT_KINDS.filter((k) => stack[k] > 0) : [];
  return (
    <div className="bi-cell">
      <span className="bi-name">{SHORT[id] ?? SECTOR_NAME[id as 'A']}</span>
      {parts.length === 0 ? (
        <i className="bf-empty">пусто</i>
      ) : (
        <span className="bf-stack">
          {parts.map((k) => (
            <em key={k}>
              {KIND_META[k].icon}
              {(stack as Stack)[k]}
            </em>
          ))}
        </span>
      )}
    </div>
  );
}

export function IntelCard({ intel, name }: { intel: IntelReading | null; name: string }) {
  if (!intel) {
    return (
      <>
        <h3>Разведданные</h3>
        <p className="note bad">
          Про {name} мы не знаем ничего: ни сколько их, ни как они стоят. Пошли разведку — или иди вслепую.
        </p>
      </>
    );
  }

  const stale = intel.precision !== 'exact';
  return (
    <>
      <h3>
        Разведданные <small>{formatAge(intel.ageSeconds)}</small>
      </h3>
      <p className={`note${stale ? ' bad' : ''}`}>
        {intel.hearsay ? 'донесение лазутчика: числа приблизительны с самого начала' : PRECISION_NOTE[intel.precision]}
        {intel.style ? ` · ${intel.style}` : ''}
        {'. Данные всегда старее боя минимум на пять минут: до самой отметки противник может перестроиться.'}
      </p>

      <div className="mod-list">
        {UNIT_KINDS.map((k) => {
          const e = intel.kinds?.[k];
          return (
            <div className="mod" key={k}>
              <span className="ico">{KIND_META[k].icon}</span>
              <span className="name">{KIND_META[k].name}</span>
              <span className={`val${e ? '' : ' neg'}`}>{e ? formatEstimate(e) : 'неизвестно'}</span>
            </div>
          );
        })}
        <div className="mod total">
          <span className="ico">⚔️</span>
          <span className="name">Всего замечено</span>
          <span className="val">{formatEstimate(intel.power)} силы</span>
        </div>
      </div>

      <h3>Как они стояли</h3>
      {intel.formation ? (
        <div className="bi">
          <div className="bi-row">
            {FRONT.map((id) => (
              <Cell key={id} id={id} stack={intel.formation?.[id]} />
            ))}
          </div>
          <div className="bi-row">
            {REAR.map((id) => (
              <Cell key={id} id={id} stack={intel.formation?.[id]} />
            ))}
          </div>
          <p className="note">
            Полосы — со стороны их строя: их левый фланг встанет против нашего правого. Резерв и план
            разведка не показывает — их не знает никто.
          </p>
        </div>
      ) : (
        <p className="note bad">
          Построение неизвестно: данные слишком стары, за это время их уже перестроили.
        </p>
      )}
    </>
  );
}
