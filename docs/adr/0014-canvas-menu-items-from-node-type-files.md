# Контекстное меню Canvas собирается из файлов типов Node-ов

Дата: 2026-10-05. Статус: принят.

**Контекст.** Ticket-ы 16, 18 и 27 добавляют пункты в контекстное меню Canvas. Общий файл со списком
пунктов (или правка `Canvas.tsx`) конфликтовал бы в параллельных ветках так же, как список каналов
IPC до ADR-0006.

**Решение.** Меню — overlay `src/renderer/canvas/overlays/CanvasMenu.tsx`, который открывается
правым щелчком по пустому месту Canvas. Пункт «создать Node» даёт файл типа Node-а
`src/renderer/canvas/nodes/<Type>Node.tsx` экспортом `createLabel` — строкой с названием действия
по `docs/design/BRIEF.md` (например, `export const createLabel = 'New terminal'`). Пункт создаёт
Node этого `kind` размером `defaultWidth` × `defaultHeight` в точке щелчка. Пункты сортируются по
названию; сборка — `src/renderer/canvas/overlays/create-items.ts`. `createLabel`, который не
является непустой строкой, или `createLabel` у файла без зарегистрированного `kind` — ошибка
программиста при загрузке Canvas.

**Следствие.** Новый тип Node-а получает пункт меню одной строкой в своём файле, без правки
`CanvasMenu.tsx` и `Canvas.tsx`. Пункты, которые не создают Node (например, «Show binding» Ticket-а
16), этим решением не покрыты: для них нужен отдельный экспорт или отдельный каталог.

Источник: Ticket 27 (`.scratch/worfy-mvp/issues/27-узел-терминал.md`, раздел «Итог»), PR #17.

## Considered Options

- Пункты из экспорта `createLabel` в файлах типов Node-ов (выбрано): параллельные Ticket-ы не правят
  общий файл.
- Список пунктов в `CanvasMenu.tsx`: общий файл, конфликты между ветками.
- Правка `Canvas.tsx` (`onPaneContextMenu`): запрещена брифом и тоже общий файл.
- Нативное `Menu.popup`: Playwright его не нажимает (Ticket 04).
