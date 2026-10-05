# 33 — Session view: полный транскрипт Сессии, markdown и поле ввода

Type: task
Status: blocked — blocked by 08, 11
Blocked by: 08, 11
Source: [BRIEF.md](../../../docs/design/BRIEF.md), Screen 2; макеты `docs/design/F-session-*.dc.html`; [spec.md](../spec.md), «Точки расширения вместо центральных файлов»

## Что делаем

Вторая половина бывшего тикета 08: экран одной Сессии. Узел Оркестратора (08) уже живёт на Холсте;
здесь — то, что видно после двойного щелчка по нему.

- Session view (переключатель Canvas / Session из тикета 03): полный транскрипт выбранной
  Сессии — сообщения пользователя, текст ассистента (markdown), свёрнутое thinking, строки
  tool-вызовов одной строкой с ✓ или ошибкой, строки hook-ов, строки запуска Subagent-ов. Шапка:
  модель, effort, режим разрешений, стоимость, кнопка «Interrupt».
- Справа — панель из блоков `src/renderer/session/rail/*.tsx`; `rail/index.ts` собирает их через
  `import.meta.glob`. Здесь панель пустая, её заполнят 15, 16, 22.
- `Transcript.tsx` получает транскрипт как список событий из 07 и не знает, откуда они: тикет 14
  подаст туда события, разобранные из файла.
- `src/renderer/markdown/Markdown.tsx` — общий рендер markdown, впервые нужен здесь:
  `react-markdown` + `remark-gfm` (таблицы, списки задач), сырой HTML не исполняется, ссылки
  `https://` открываются в браузере (`shell.openExternal`), относительные ссылки на файлы
  репозитория — в редакторе по умолчанию (`shell.openInEditor`). Оба канала вводит тикет 11.
  Шрифты и цвета — токены темы. Им же пользуются HANDOFF и ADR (тикет 12).
- Поле ввода (`MessageInput.tsx`): Enter — отправить, Shift+Enter — новая строка, ↑/↓ — история
  промптов, автоувеличение высоты. Пока Сессия занята, кнопка отправки становится «Interrupt».
  Очередь, выбор модели и slash-меню — тикеты 19 и 20.
- Двойной щелчок по Узлу Оркестратора открывает Session view этой Сессии.

## Готово, когда

- [ ] На fake-агенте: сообщение из поля ввода → статус `busy` → текст ответа в транскрипте → `idle`; стоимость из `result` видна в шапке.
- [ ] «Interrupt» посреди хода останавливает его; транскрипт показывает пометку прерывания.
- [ ] ↑/↓ в пустом поле листают прошлые промпты этой Сессии.
- [ ] `<script>` и `<img onerror>` в markdown не исполняются (test).
- [ ] Новый блок правой панели добавляется одним файлом в `rail/` без правки `SessionView.tsx`.
- [ ] Ручной прогон на репозитории worfy с настоящим SDK: сообщение «ответь блоком состояния» даёт блок в транскрипте и на Узле Оркестратора; снимок в «Итог».

## Тесты

- `test/unit/markdown.test.tsx` — рендер таблицы, списка задач, отключённый HTML, обе ветки ссылок (новый).
- `test/e2e/session-view.spec.ts` — fake-сценарий: двойной щелчок, отправка, Interrupt, история промптов (новый).
- Сначала падающий test: `markdown.test.tsx` на `<img onerror>`.

## Где в коде

- `src/renderer/session/SessionView.tsx`, `src/renderer/session/Transcript.tsx`, `src/renderer/session/MessageInput.tsx`
- `src/renderer/session/rail/index.ts`
- `src/renderer/markdown/Markdown.tsx`
- `src/renderer/canvas/nodes/OrchestratorNode.tsx` — двойной щелчок
