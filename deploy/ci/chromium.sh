#!/bin/sh
# Chromium браузерных отчётов в контейнере приёмки (`CHROME=` у `scripts/lib/chrome.ts`): видеокарты нет, WebGL —
# программный SwiftShader через ANGLE. Флаги отчёта идут после наших — у повторного ключа берётся последний, поэтому
# `--use-gl=angle` у `scene` и `revive` и `--use-gl=disabled` у `tap` остаются их собственными.
# Песочница выключена: контейнер чужого не открывает, а пространства имён пользователя Docker ей не даёт.
# `/dev/shm` в контейнере мал — разделяемая память идёт через /tmp.
exec /usr/bin/chromium \
  --use-angle=swiftshader \
  --enable-unsafe-swiftshader \
  --no-sandbox \
  --disable-dev-shm-usage \
  "$@"
