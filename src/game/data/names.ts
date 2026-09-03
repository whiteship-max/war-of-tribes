export const MALE_NAMES = ['Ток', 'Рун', 'Гор', 'Бран', 'Тар', 'Кай', 'Дар', 'Орм', 'Ург', 'Зан', 'Тул', 'Рагх', 'Нок', 'Вал', 'Хар', 'Ил', 'Морн', 'Сав', 'Йор', 'Бор'];
export const FEMALE_NAMES = ['Ума', 'Ая', 'Лея', 'Иса', 'Мира', 'Нура', 'Вея', 'Зая', 'Тэя', 'Ора', 'Юна', 'Айла', 'Рэн', 'Эла', 'Сай', 'Кира', 'Нэя', 'Лура', 'Оми', 'Тая'];

export function pickName(sex: 'm' | 'f', rnd: () => number): string {
  const list = sex === 'm' ? MALE_NAMES : FEMALE_NAMES;
  return list[Math.floor(rnd() * list.length)];
}
