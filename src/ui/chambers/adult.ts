// «Сцены для взрослых» (docs/city_v3.md, Г-7): рычаг в настройках, память устройства. Выключен — в разговорах покоев нет
// варианта «ночь вдвоём». Отдельный крошечный модуль: настройки — в первой загрузке, разговоры покоев — нет.
const KEY = 'tribe.adult';

/** Включены, пока игрок их не выключил. */
export function adultScenes(): boolean {
  try {
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
}

export function setAdultScenes(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* не запомнится — останется включённым */
  }
}
