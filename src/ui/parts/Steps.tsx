/**
 * Ряд шага: −10 −1 [n] +1 +10. Поимённых жителей нет, люди одинаковы, поэтому
 * назначение — это число, а не список карточек: на потолке уровней в поле стоит
 * сотня человек, и сотню строк по одной на голову никто читать не станет.
 *
 * Вынесен из панели здания, когда понадобился второй раз: им ставят вольных и
 * невольников в здание, раздают вольный сбор у костра и выбирают, скольких
 * невольников отпустить. У вылазки (`panels/SortiePanel.tsx`) пока своя копия с
 * другой подписью — она старше этого файла.
 */
export function Steps({
  value,
  max,
  spare,
  step,
  addTut,
  onChange,
}: {
  value: number;
  max: number;
  spare: number;
  step: number;
  addTut?: string;
  onChange: (delta: number) => void;
}) {
  const room = Math.max(0, max - value);
  const canAdd = room > 0 && spare > 0;
  return (
    <div className="stepper wide-steps">
      <button disabled={value <= 0} onClick={() => onChange(-step)} aria-label={`Снять ${step}`}>
        −{step}
      </button>
      <button disabled={value <= 0} onClick={() => onChange(-1)} aria-label="Снять">
        −
      </button>
      <span className="n">{value}</span>
      <button data-tut={addTut} disabled={!canAdd} onClick={() => onChange(1)} aria-label="Поставить">
        +
      </button>
      <button disabled={!canAdd} onClick={() => onChange(step)} aria-label={`Поставить ${step}`}>
        +{step}
      </button>
    </div>
  );
}
