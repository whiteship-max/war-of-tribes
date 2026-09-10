import { useState } from 'react';
import { useGame } from '@/game/store';
import { bootSaying } from '@/boot/stage';
import { haptic } from '@/telegram/webapp';
import { Settings } from './parts/Settings';
import { START_LABEL, startAction } from './start';

/**
 * Стартовый экран.
 *
 * Он не второй экран загрузки, а его продолжение: тот же арт, та же присказка,
 * то же место на экране. Экран загрузки живёт в `index.html` и снимается по
 * первому кадру диорамы; ровно в этот миг под ним уже стоит этот экран — с
 * кнопкой на месте полоски. Игрок видит не смену экранов, а исчезновение
 * полоски и появление кнопки.
 *
 * **Ждать этот экран не заставляет никого, и заставить не может.** Он часть
 * React-дерева и рисуется вместе с приложением, то есть когда игра уже готова:
 * состояние прочитано, диорама собрана, кадр отдан. Ни одного запроса, ни
 * одного `await`, ни одного ожидания кадра он не добавляет — а значит, правило
 * «экран загрузки не имеет права ждать» им не тронуто. Скрытый вебвью, в
 * котором `requestAnimationFrame` не вызывается вовсе, для него не существует:
 * ему нечего у него просить.
 *
 * **Сервер ему тоже не нужен.** Есть партия на устройстве — «Продолжить», нет —
 * «Начать игру»; ни то, ни другое не спрашивает сеть. Синхронизация идёт своим
 * ходом и позади, как и раньше.
 *
 * Диораму под собой он не останавливает, хотя закрывает её целиком. Пауза здесь
 * стоила бы дороже сэкономленных кадров: сторож в `GameCanvas` считает
 * законными только две остановки — карту и скрытую страницу, — и остановленную
 * ради стартового экрана сцену объявил бы поломкой (`diagnose`). Экран живёт
 * секунды, и платить за них новым состоянием в приборе не стоит.
 */
export function StartScreen({ onEnter }: { onEnter: () => void }) {
  // `fresh` — сохранения на диске не было. Это и есть весь вопрос, на который
  // отвечает единственная кнопка (почему она одна — в `ui/start.ts`).
  const fresh = useGame((g) => g.fresh);
  const [settings, setSettings] = useState(false);
  const action = startAction(!fresh);

  const enter = (): void => {
    haptic('medium');
    onEnter();
  };

  return (
    <div className="start">
      {/*
        Тот же файл, что у экрана загрузки, и тот же кадр. Второго запроса он не
        стоит: браузер взял его минуту назад с `fetchpriority="high"` и отдаёт из
        кэша. Не приехал вовсе — под ним остаётся фон и отсвет костра, ровно как
        на экране загрузки, и это правильный вид, а не поломка.
      */}
      <img className="start-art" src="/assets/splash/boot.webp" alt="" aria-hidden="true" decoding="async" />
      <div className="start-scrim" />

      <div className="start-body">
        <h1 className="start-name">TRIBE</h1>
        {/* Присказка захода — та же, что стояла на экране загрузки, и взятая у
            него же: список присказок живёт в `index.html` в одном экземпляре. */}
        <p className="start-say">{bootSaying()}</p>
        <button className="start-go" onClick={enter}>
          {START_LABEL[action]}
        </button>
        <button className="start-more" onClick={() => setSettings(true)}>
          Настройки
        </button>
      </div>

      {settings && (
        /* Тот же компонент настроек, что и в профиле, — не копия его строк.
           Почему это важно, написано в `parts/Settings.tsx`. */
        <div className="modal-backdrop" onClick={() => setSettings(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <Settings />
            <div className="options">
              <button className="btn" onClick={() => setSettings(false)}>
                Готово
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
