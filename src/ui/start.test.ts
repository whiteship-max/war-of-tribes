// Стартовый экран: обещания, которые нельзя проверить глазами.
//
// Экран простой, и весь он — три обещания, каждое из которых стоит доверия
// игрока: кнопка одна и правдивая, настройки на нём те же самые, что в профиле,
// а ждать он не заставляет никого. Первое проверяется чистой функцией, два
// других — чтением исходника: они про то, чего в коде быть НЕ должно, а такое
// поведением не проверишь.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PROLOGUE_FOR_PLAYERS,
  PROLOGUE_IS_TEMPORARY,
  PROLOGUE_LABEL,
  PROLOGUE_NOTE,
  START_LABEL,
  prologueShown,
  startAction,
} from './start';

const SRC = join(__dirname, '..');

/** Исходник без комментариев: объяснения не должны проходить за код. */
const read = (file: string): string =>
  readFileSync(join(SRC, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('кнопка одна, и та, которая правдива', () => {
  it('есть партия — «Продолжить», нет — «Начать игру»', () => {
    expect(startAction(true)).toBe('continue');
    expect(startAction(false)).toBe('new');
    expect(START_LABEL.continue).toBe('Продолжить');
    expect(START_LABEL.new).toBe('Начать игру');
  });

  it('слов на кнопке ровно два, и они разные', () => {
    const words = Object.values(START_LABEL);
    expect(new Set(words).size).toBe(words.length);
  });

  it('экран показывает одну кнопку, а не выбирает из двух в разметке', () => {
    // Пара «Регистрация» и «Вход» вела бы в одно место: игрок опознаётся
    // подписью Telegram, учётная запись заводится первым же заходом. Две
    // кнопки, делающие одно и то же, — это вид выбора, а не выбор.
    const src = read('ui/StartScreen.tsx');
    for (const word of Object.values(START_LABEL)) {
      expect(src, `слово кнопки переписано в разметке: ${word}`).not.toContain(word);
    }
    expect(src).toContain('START_LABEL[action]');
    for (const word of ['Регистрация', 'Вход', 'Войти', 'Зарегистрироваться']) {
      expect(src, `парная заглушка: ${word}`).not.toContain(word);
    }
  });
});

describe('вход в предысторию — временная кнопка, и это видно из кода', () => {
  it('помечена временной', () => {
    // Пометка не украшение: по замыслу предысторией будут начинать все, и в тот
    // день кнопку выдернут отсюда целиком. Снять пометку, чтобы «оставить
    // пока», значит потерять единственное место, за которое её видно.
    expect(PROLOGUE_IS_TEMPORARY).toBe(true);
  });

  it('не притворяется входом в партию', () => {
    // Она ведёт в отдельный режим, а не во вторую дверь к тому же самому, —
    // поэтому и слово у неё своё, и рядом сказано, что с племенем связи нет.
    expect(PROLOGUE_LABEL).not.toBe(START_LABEL.new);
    expect(PROLOGUE_LABEL).not.toBe(START_LABEL.continue);
    expect(PROLOGUE_NOTE).toMatch(/не связана/);
  });

  it('игрокам скрыта, стенду (?probe=1) — на месте', () => {
    // Слово владельца 11.10.2026: кнопку убрать, код оставить. Стенды предыстории и восстановления сцены жмут её.
    expect(PROLOGUE_FOR_PLAYERS).toBe(false);
    expect(prologueShown(false)).toBe(false);
    expect(prologueShown(true)).toBe(true);
    expect(read('ui/StartScreen.tsx')).toContain('prologueShown(probe())');
  });

  it('слово и подпись стоят в разметке из одного места', () => {
    const src = read('ui/StartScreen.tsx');
    expect(src).toContain('{PROLOGUE_LABEL}');
    expect(src).toContain('{PROLOGUE_NOTE}');
    expect(src, 'слово кнопки переписано в разметке').not.toContain(PROLOGUE_LABEL);
  });

  it('стартовый экран не качает предысторию сам', () => {
    // Правило «этот экран ничего не ждёт» сильнее удобства: чанк тянет `App`,
    // и тянет уже после нажатия. Динамический импорт здесь означал бы `await`
    // на экране, которому ждать запрещено.
    const src = read('ui/StartScreen.tsx');
    for (const word of ['import(', 'lazy(', 'prologue/']) {
      expect(src, `стартовый экран сам грузит режим: ${word}`).not.toContain(word);
    }
  });
});

describe('настройки на стартовом экране — тот же компонент, что в профиле', () => {
  it('оба места показывают один и тот же `parts/Settings`', () => {
    for (const file of ['ui/StartScreen.tsx', 'ui/panels/ProfilePanel.tsx']) {
      expect(read(file), `${file}: настройки не оттуда`).toMatch(/import \{ Settings \} from '[./@a-z/]*parts\/Settings'/);
      expect(read(file), `${file}: компонент не показан`).toContain('<Settings />');
    }
  });

  it('стартовый экран не заводит своего звука', () => {
    // Второй рычаг работал бы безупречно ровно до того дня, когда правят
    // первый. Это же обещание с другой стороны проверяет `sound/music.test.ts`.
    const src = read('ui/StartScreen.tsx');
    for (const word of ['setSoundOn', 'soundOn', 'villageMusic', 'battleMusic']) {
      expect(src, `свой звук на стартовом экране: ${word}`).not.toContain(word);
    }
  });

  it('состояние настройки одно на все показы: читают подпиской, а не своим useState', () => {
    const src = read('ui/parts/Settings.tsx');
    expect(src).toContain('useSyncExternalStore(subscribeSound');
    expect(src, 'своё состояние переключателя').not.toMatch(/useState\(\s*soundOn/);
  });

  it('язык — сообщение, а не выключенный выбор', () => {
    const src = read('ui/parts/Settings.tsx');
    // Строка языка не кнопка: нажимать нечего, выбирать не из чего.
    expect(src).toMatch(/<div className="set-row static">/);
    for (const word of ['<select', 'disabled', 'English', 'Скоро']) {
      expect(src, `ложный выбор языка: ${word}`).not.toContain(word);
    }
  });
});

describe('стартовый экран ничего не ждёт', () => {
  const src = read('ui/StartScreen.tsx');

  it('ни запроса, ни кадра, ни таймера', () => {
    // Экран загрузки под ним не делает ни одного внешнего запроса и не ждёт
    // кадра нарочно: в скрытом вебвью `requestAnimationFrame` не вызывается
    // вовсе. Стартовый экран стоит на его месте и обязан быть таким же.
    for (const word of ['await', 'fetch(', 'requestAnimationFrame', 'setTimeout', 'setInterval', 'afterPaint']) {
      expect(src, `стартовый экран ждёт: ${word}`).not.toContain(word);
    }
  });

  it('сервер ему не нужен: кнопка выводится из своего сохранения', () => {
    for (const word of ['useSync', 'apiGet', 'apiPut', 'serverNow', '/api/']) {
      expect(src, `стартовый экран спрашивает сервер: ${word}`).not.toContain(word);
    }
    expect(src).toContain('g.fresh');
  });

  it('вьюпорт Telegram он не трогает', () => {
    // `disableVerticalSwipes` и прочие настройки клиента ставит `telegram/webapp.ts`
    // на запуске. Экран, который правит их под себя, оставляет их правленными и
    // после входа в игру.
    for (const word of ['disableVerticalSwipes', 'expand(', 'setHeaderColor', 'requestFullscreen']) {
      expect(src, `стартовый экран правит клиент: ${word}`).not.toContain(word);
    }
  });

  it('ни слова про алмазы и покупки', () => {
    for (const word of ['алмаз', 'Алмаз', 'gems', 'Купить', 'Stars']) {
      expect(src, `на стартовом экране торгуют: ${word}`).not.toContain(word);
    }
  });
});
