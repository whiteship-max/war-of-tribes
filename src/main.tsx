import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initTelegram } from './telegram/webapp';
import './ui/styles.css';
import { bootDone } from './boot/stage';
import { bootUiMode } from './ui/uimode';
import { bootMapLook } from './ui/map/look';
import { bootBattleLook } from './ui/battle/look';

const params = new URLSearchParams(location.search);
if (params.has('replay')) {
  // Стенд ролика о бое: снимки приёмки и замер бюджета в середине отъезда.
  // Отдельным чанком, как и стенд графики, — в игру он не попадает.
  void import('./render/battle-stand').then((m) => {
    m.mountReplayStand(params);
    bootDone();
  });
} else if (params.has('showcase')) {
  // Стенд-витрина для проверки графики: одно здание по ступеням или целый
  // посёлок заданного уровня. Отдельный чанк — в игру он не попадает.
  void import('./render/showcase').then((m) => {
    m.mountShowcase(params);
    bootDone();
  });
} else {
  initTelegram();
  // Вид этого устройства — интерфейс, карта, ролик боя: адрес (`?ui=old`, `?map=old`, `?battle=old`; обратно — `new`,
  // `tw`) пишет выбор до первого кадра (`ui/device.ts`). По умолчанию у всех трёх — новое.
  bootUiMode(location.search);
  bootMapLook(location.search);
  bootBattleLook(location.search);
  const start = (): void =>
    createRoot(document.getElementById('root')!).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  // Сцена игры — город (docs/city.md, «Город — единственный вид»), своим куском: он едет до игры,
  // чтобы первый кадр был городом. Не приехал — игра всё равно встаёт, а холст просит кусок ещё раз
  // (`ui/GameCanvas`).
  void import('./render/city/scene').then(start, start);
}
