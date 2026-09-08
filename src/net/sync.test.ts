import { describe, expect, it } from 'vitest';
import { decide } from './sync';

/**
 * Правило встречи двух копий. Проверяется отдельно от всего остального, потому
 * что это единственное место, где прогресс может пропасть: три ветки из четырёх
 * что-нибудь перезаписывают, и любая, поставленная не туда, стирает вечер игры
 * молча.
 */
describe('какую партию оставить при запуске', () => {
  it('на сервере пусто — кладём свою', () => {
    expect(decide({ hasLocal: true, remoteEtag: null, knownEtag: null })).toBe('first');
    expect(decide({ hasLocal: false, remoteEtag: null, knownEtag: 'e1' })).toBe('first');
  });

  /**
   * Ради этого сервер и заведён: игрок почистил данные браузера или зашёл с
   * нового телефона. Спорить не с чем — берём серверную и ни о чём не спрашиваем.
   */
  it('своей нет — берём серверную без вопросов', () => {
    expect(decide({ hasLocal: false, remoteEtag: 'e1', knownEtag: null })).toBe('adopt');
    expect(decide({ hasLocal: false, remoteEtag: 'e1', knownEtag: 'e0' })).toBe('adopt');
  });

  it('серверная — наша же предыдущая: играем дальше и кладём поверх', () => {
    expect(decide({ hasLocal: true, remoteEtag: 'e7', knownEtag: 'e7' })).toBe('continue');
  });

  /**
   * Здесь и живёт обещание «прогресс не пропадает молча». Все три случая, когда
   * серверная запись не наша, ведут к вопросу, а не к тихому выбору: играли на
   * двух устройствах; на этом устройстве ещё ни разу не синхронизировались;
   * копию, которой мы наследовали, кто-то перезаписал.
   */
  it('серверная не продолжает нашу — спрашиваем игрока', () => {
    expect(decide({ hasLocal: true, remoteEtag: 'e9', knownEtag: 'e7' })).toBe('ask');
    expect(decide({ hasLocal: true, remoteEtag: 'e9', knownEtag: null })).toBe('ask');
  });

  /**
   * Отдельно: пустая отметка не считается совпадением. Иначе устройство, ни
   * разу не синхронизировавшееся, молча затирало бы чужую партию — а это ровно
   * тот случай, ради которого вопрос и заведён.
   */
  it('«не знаю, чему наследую» — это не «наследую этому»', () => {
    expect(decide({ hasLocal: true, remoteEtag: 'e1', knownEtag: null })).not.toBe('continue');
  });

  it('перезаписывающих веток ровно три, и каждая либо наша, либо выбрана игроком', () => {
    const all = [
      decide({ hasLocal: true, remoteEtag: null, knownEtag: null }),
      decide({ hasLocal: false, remoteEtag: 'e1', knownEtag: null }),
      decide({ hasLocal: true, remoteEtag: 'e7', knownEtag: 'e7' }),
      decide({ hasLocal: true, remoteEtag: 'e9', knownEtag: 'e7' }),
    ];
    expect(new Set(all)).toEqual(new Set(['first', 'adopt', 'continue', 'ask']));
  });
});
