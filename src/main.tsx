import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initTelegram } from './telegram/webapp';
import './ui/styles.css';

const params = new URLSearchParams(location.search);
if (params.has('showcase')) {
  // Стенд-витрина для проверки графики: сетка одного здания по ступеням и эпохам
  // или целый посёлок заданной стадии. Отдельный чанк — в игру он не попадает.
  void import('./render/showcase').then((m) => m.mountShowcase(params));
} else {
  initTelegram();
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
