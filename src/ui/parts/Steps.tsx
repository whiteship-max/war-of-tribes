/**
 * Ряд шага: −10 −1 [n] +1 +10. Поимённых жителей нет, люди одинаковы, поэтому
 * назначение — это число, а не список карточек: на потолке уровней в поле стоит
 * сотня человек, и сотню строк по одной на голову никто читать не станет.
 *
 * Вынесен из панели здания, когда понадобился второй раз: им ставят вольных и
 * невольников в здание, раздают вольный сбор у костра и выбирают, скольких
 * невольников отпустить, переводят бойцов между гарнизоном и отрядом полководца
 * (`Muster`, `names` — подписи для чтения с экрана: куда идёт шаг вниз и вверх). У
 * вылазки (`panels/SortiePanel.tsx`) пока своя копия с другой подписью — она старше
 * этого файла.
 */
export function Steps({
  value,
  max,
  spare,
  step,
  addTut,
  names = { less: 'Снять', more: 'Поставить' },
  onChange,
}: {
  value: number;
  max: number;
  spare: number;
  step: number;
  addTut?: string;
  names?: { less: string; more: string };
  onChange: (delta: number) => void;
}) {
  const room = Math.max(0, max - value);
  const canAdd = room > 0 && spare > 0;
  return (
    <div className="stepper wide-steps">
      <button disabled={value <= 0} onClick={() => onChange(-step)} aria-label={`${names.less} ${step}`}>
        −{step}
      </button>
      <button disabled={value <= 0} onClick={() => onChange(-1)} aria-label={names.less}>
        −
      </button>
      <span className="n">{value}</span>
      <button data-tut={addTut} disabled={!canAdd} onClick={() => onChange(1)} aria-label={names.more}>
        +
      </button>
      <button disabled={!canAdd} onClick={() => onChange(step)} aria-label={`${names.more} ${step}`}>
        +{step}
      </button>
    </div>
  );
}
