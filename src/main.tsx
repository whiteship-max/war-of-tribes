import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initTelegram, tgInitData } from './telegram/webapp';
import './ui/styles.css';
import { bootDone } from './boot/stage';
import { Crash } from './ui/Crash';
import { telegramOnly } from './telegram/gate';
import { TelegramOnly } from './ui/TelegramOnly';
import { probe } from './debug';

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
} else if (telegramOnly({ host: location.hostname, hash: location.hash, initData: tgInitData(), probe: probe() })) {
  // Адрес открыт просто в браузере — играть можно только в Telegram (`telegram/gate.ts`). Игра не встаёт: ни стора,
  // ни сохранения, только экран со ссылкой на бота. Стенды и отчёты сюда не попадают — своя машина и `?probe=1`.
  createRoot(document.getElementById('root')!).render(<TelegramOnly />);
  bootDone();
} else {
  initTelegram();
  // Вид у игры один — новый интерфейс, карта по регионам, ролик TW (docs/ui_audit.md, 16): прежние удалены вместе со
  // своими переключателями, и старые адреса (`?ui=old`, `?map=old`, `?battle=old`) и выбор, записанный на устройстве,
  // не читает никто (`ui/oldviews.test.ts`).
  const start = (): void =>
    createRoot(document.getElementById('root')!).render(
      <React.StrictMode>
        <Crash where="игра">
          <App />
        </Crash>
      </React.StrictMode>,
    );
  // Сцена игры — город (docs/city.md, «Город — единственный вид»), своим куском: он едет до игры,
  // чтобы первый кадр был городом. Не приехал — игра всё равно встаёт, а холст просит кусок ещё раз
  // (`ui/GameCanvas`).
  void import('./render/city/scene').then(start, start);
}
