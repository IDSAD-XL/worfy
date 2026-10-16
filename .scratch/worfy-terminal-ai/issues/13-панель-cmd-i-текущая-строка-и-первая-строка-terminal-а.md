# 13 — Панель ⌘I: текущая строка shell-а уходит модели, первая строка Terminal-а остаётся видна

Type: task
Status: open
Blocked by: —
Source: решение владельца 2026-10-16 по двум пунктам Consider [low] из
[Ticket-а 06](06-command-request.md), «Gate оркестратора (2026-10-14)»: панель ⌘I не отправляет
текущую строку и закрывает первую строку Terminal-а. Код перечитан по main `ed820a51`.

## Что происходит

- **Строка не уходит модели.** Spec требует её в контексте Command request
  ([spec.md](../spec.md), «Контекст и приватность», `:95`), Ticket 06 — тоже («Что делаем», пункт 5).
  Панель шлёт только слова: `invoke('terminalAi.request', { projectId, nodeId, text })`
  (`src/renderer/canvas/nodes/TerminalAiRequest.tsx:51`). Main зовёт `requestCommand(…, key, text, …)`
  (`src/main/ipc/terminal-ai-request.ts:120`), а тот строит контекст с пустой строкой:
  `terminalAiInput(state, '', { request: words })` (`src/main/terminal-ai/features/command-request.ts:42`).
  Main строку zsh не видит: `BUFFER` приходит к нему только в `ask` от widget-а Ticket-а 03. Для
  строки `# …` пустая строка верна: строкой была сама просьба.
- **Панель закрывает первую строку Terminal-а.** Она висит над верхом экрана xterm.js:
  `.w-terminal-request__panel` — `position: absolute`, `top: 6px`
  (`src/renderer/canvas/nodes/TerminalNode.css:138-152`, якорь нулевой высоты — `:132-137`). Под ней
  первая строка экрана. В «Terminal is busy» не видно, какая команда идёт.
- Экран при открытой панели размер не меняет, и shell не получает resize — так задумано в Ticket-е 06
  (комментарий `TerminalNode.css:128-131`), это остаётся.
- Экземпляр xterm.js создаётся в `src/renderer/canvas/nodes/TerminalNode.tsx:217`, панель
  рисуется там же (`:433`) и буфера xterm сейчас не получает.

## Что делаем

1. **Renderer читает текущую строку из буфера xterm** и отправляет её вместе со словами. Строка —
   то, что набрано после prompt-а: без текста prompt-а и без правого prompt-а, длинная строка,
   перенесённая на несколько рядов экрана, — одной строкой. Серый Suggestion (`POSTDISPLAY`,
   `src/main/terminal/zsh/rc.d/10-assist.zsh:49-69`) в строку не входит: он не набран. Начало строки
   можно брать от метки конца prompt-а `633;B` (`src/main/terminal/zsh/integration.zsh:21`) через
   обработчик OSC в xterm.js или другим способом — выбор исполнителя, решение и его границы — в
   «Итог». Строку в renderer-е может подделать программа, напечатав метку: это меняет только текст
   строки в контексте, не больше.
2. **Канал `terminalAi.request` получает поле строки** (`src/shared/ipc/terminal-ai-request.ts:46`),
   не длиннее `MAX_FIELD_CHARS` (`src/shared/terminal-ai/context.ts:19`). Main передаёт её в `requestCommand`; путь строки
   `# …` по-прежнему шлёт пустую строку. Редакция секретов и правило «строка с пробела в начале не
   уходит» уже в `prepareContext` (`src/shared/terminal-ai/context.ts`) — строка панели идёт через
   них, как строка `ask`.
3. **Панель не закрывает первую строку Terminal-а.** Она сдвигается так, чтобы первая строка экрана
   оставалась видна, в том числе в «Terminal is busy». Экран по-прежнему не меняет размер, shell
   resize не получает.

## Готово, когда

- [ ] Набрано `git status --short` (без Enter), ⌘I, просьба, Enter — fake backend получил в контексте
      эту строку (e2e `test/e2e/terminal-ai-request.spec.ts`, журнал fake).
- [ ] Строка без набранного текста — в контексте пустая строка; prompt в неё не попадает.
- [ ] Серый Suggestion в строке на экране — в контекст он не уходит (contract или e2e).
- [ ] Строка длиннее ширины Terminal-а (перенос на два ряда) — уходит целиком, одной строкой.
- [ ] Строка с секретом (`export TOKEN=…`) уходит редактированной; строка с пробела в начале — не уходит.
- [ ] Путь `# …` + Enter не изменился: контекст строки пустой (contract `test/contract/terminal-ai-request.test.ts`).
- [ ] Открытая панель не пересекает первую строку экрана xterm.js: нижний край панели ниже нижнего края
      первого ряда `.xterm-rows`, текст первой строки виден; то же в «Terminal is busy» с идущей
      командой (e2e, обе темы на снимке).
- [ ] Открытие и закрытие панели не меняют число рядов и колонок pty (e2e, как в Ticket-е 06).
- [ ] Мутанты: строка не передаётся в `requestCommand`; Suggestion входит в строку; `top` панели как на
      main — каждый красный.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full — exit 0 и строка
      `[gate] зелено (full)` (оркестратор перед merge); Linux CI зелёный.

## Тесты

- Unit (`test/unit/terminal-ai-request.test.tsx`): панель шлёт строку, которую дал Terminal; разбор
  строки из буфера — prompt, перенос, Suggestion.
- Contract (`test/contract/terminal-ai-request.test.ts`): строка из канала доходит до контекста
  запроса, редакция и строка с пробела; `# …` — пустая строка.
- e2e (`test/e2e/terminal-ai-request.spec.ts`): строка в журнале fake; положение панели против первого
  ряда; размер pty.

## Где в коде

- `src/renderer/canvas/nodes/TerminalNode.tsx`
- `src/renderer/canvas/nodes/TerminalNode.css`
- `src/renderer/canvas/nodes/TerminalAiRequest.tsx`
- `src/shared/ipc/terminal-ai-request.ts`
- `src/main/ipc/terminal-ai-request.ts`
- `src/main/terminal-ai/features/command-request.ts`
- `test/unit/terminal-ai-request.test.tsx`
- `test/contract/terminal-ai-request.test.ts`
- `test/e2e/terminal-ai-request.spec.ts`

Только читать (не в списке, чтобы не давать ложных пересечений Wave):
`src/shared/terminal-ai/context.ts`, `src/main/terminal/zsh/integration.zsh`,
`src/main/terminal/zsh/rc.d/10-assist.zsh`.

Пересечение с другим Epic-ом: `TerminalNode.tsx` и `TerminalAiRequest.tsx` правит открытый
[PR #328](https://github.com/IDSAD-XL/worfy/pull/328) (`worfy-ui` 11, реестр сочетаний). Сверка — перед
claim; кто влит вторым, тот делает rebase.

## Вне скоупа

- Расширение протокола Ticket-а 03, чтобы main сам знал `BUFFER`: строку читает renderer (решение
  владельца 2026-10-16).
- `# слова` + Enter при выключенном Command request: обычный `accept-line` zsh — принято как есть
  (решение владельца 2026-10-16, Ticket 06).
- ⌘I на Windows (Ctrl+I) — вместе с Terminal AI для PowerShell, позже.

## Итог

—
