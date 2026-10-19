import { Icon } from '@/ui/icons/Icon';
import type { IconName } from '@/ui/icons/alias';
/**
 * Полоска множителя прироста, 0..1: чем короче, тем сильнее эта причина тормозит.
 * Живёт отдельно от «Племени», потому что справочный экран населения показывает
 * ровно те же три полоски — считать их дважды нельзя, разойдутся.
 */
export function Factor({
  icon,
  name,
  k,
  hint,
  worst,
}: {
  icon: IconName;
  name: string;
  k: number;
  hint: string;
  /** Именно этот множитель сейчас и есть узкое место. */
  worst?: boolean;
}) {
  const pct = Math.round(Math.max(0, Math.min(1, k)) * 100);
  return (
    <div className={`res-line${worst ? ' bottleneck' : ''}`}>
      <span className="ico"><Icon name={icon} /></span>
      <span className="name">
        {name}
        {worst && <em className="tag">тормозит</em>}
      </span>
      <span className={`val${pct < 40 ? ' full' : ''}`}>{pct}%</span>
      <span className="delta">{hint}</span>
      <span className="bar">
        <i style={{ width: `${pct}%` }} className={pct < 40 ? 'full' : ''} />
      </span>
    </div>
  );
}
