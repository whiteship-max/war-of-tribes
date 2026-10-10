/**
 * Кости → уголь: ступень сохранения, одна на партию и на мир (docs/economy.md, «Уголь вместо костей»).
 *
 * Пятый припас звался костями со времён игры про древних людей; в 1200 году его место занял древесный уголь — топливо
 * горна (решение владельца 10.10.2026). Идентификатор `bones` лежит в старых сохранениях везде, где лежит припас: склад,
 * счёт рынка и караваны (`GoodId`), трофей у ворот, добыча и цена в мире. Перечислять поля нельзя — пропущенное поле
 * молча потеряло бы уголь, — поэтому ступень обходит прочитанный JSON целиком: ключ `bones` становится `charcoal`
 * (с прибавкой, если оба есть), строка `'bones'` — `'charcoal'`. Других `bones` ни в партии, ни в мире нет: это имя
 * было только у припаса. Без `@/`: модуль читает и сохранение мира.
 */
export function bonesToCharcoal(v: unknown): unknown {
  if (v === 'bones') return 'charcoal';
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) v[i] = bonesToCharcoal(v[i]);
    return v;
  }
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    for (const key of Object.keys(o)) o[key] = bonesToCharcoal(o[key]);
    if ('bones' in o) {
      const old = o.bones;
      delete o.bones;
      o.charcoal = typeof old === 'number' && typeof o.charcoal === 'number' ? o.charcoal + old : (o.charcoal ?? old);
    }
    return o;
  }
  return v;
}
