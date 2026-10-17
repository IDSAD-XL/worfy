# 13 — Панель ⌘I: текущая строка shell-а уходит модели, первая строка Terminal-а остаётся видна

Type: task
Status: done 2026-10-17T16:32Z
PR: #441
Branch: worfy-terminal-ai/13
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

- [x] Набрано `git status --short` (без Enter), ⌘I, просьба, Enter — fake backend получил в контексте
      эту строку (e2e `test/e2e/terminal-ai-request.spec.ts`, журнал fake).
- [x] Строка без набранного текста — в контексте пустая строка; prompt в неё не попадает.
- [x] Серый Suggestion в строке на экране — в контекст он не уходит (contract или e2e).
- [x] Строка длиннее ширины Terminal-а (перенос на два ряда) — уходит целиком, одной строкой.
- [x] Строка с секретом (`export TOKEN=…`) уходит редактированной; строка с пробела в начале — не уходит.
- [x] Путь `# …` + Enter не изменился: контекст строки пустой (contract `test/contract/terminal-ai-request.test.ts`).
- [x] Открытая панель не пересекает первую строку экрана xterm.js: нижний край панели ниже нижнего края
      первого ряда `.xterm-rows`, текст первой строки виден; то же в «Terminal is busy» с идущей
      командой (e2e, обе темы на снимке).
- [x] Открытие и закрытие панели не меняют число рядов и колонок pty (e2e, как в Ticket-е 06).
- [x] Мутанты: строка не передаётся в `requestCommand`; Suggestion входит в строку; `top` панели как на
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

**Как читается строка.** Новый файл `src/renderer/canvas/nodes/terminal-line.ts`. Обработчик OSC 633
xterm.js (`terminal.parser.registerOscHandler`) на метке `B` запоминает ячейку курсора и ставит
marker xterm.js на её ряд: marker сдвигается вместе с прокруткой. Метки `A` и `C` его сбрасывают.
Пока метки нет, строка пустая. При Enter в панели строка читается из normal buffer от этой ячейки:

- prompt в неё не входит, потому что чтение начинается после метки;
- ряд продолжается на следующий, если xterm.js пометил тот как `isWrapped` или если последняя ячейка
  ряда занята. zsh рисует длинную строку сам и переходит на новый ряд своим line feed, поэтому
  xterm.js такой ряд перенесённым не помечает. e2e на настоящем zsh сначала падал именно на этом:
  в контекст ушли только первые 73 символа;
- серый текст (`fg=8` или dim) в конце строки, начиная с курсора, отбрасывается. Это Suggestion и
  серые заметки (`POSTDISPLAY`);
- правый prompt отбрасывается, если выполнены три условия: текст стоит у правого края первого ряда,
  ниже ничего нет, а перед текстом пробел не меньше 5 пустых ячеек правее курсора. Порог взят из
  shell integration VS Code;
- пробелы в конце обрезаются, пробел в начале остаётся: по нему `prepareContext` не отправляет строку;
- строка длиннее `MAX_FIELD_CHARS` режется до лимита вместе со словом, на которое пришёлся разрез.
  Так половина секрета не уйдёт без редакции.

Nonce renderer не знает. Программа может напечатать `B` сама, и тогда изменится только текст строки
в контексте. Пока идёт команда, панель ничего не шлёт.

Границы записаны в коде комментарием `shortcut:`:
- из BUFFER в несколько строк уходит только первая;
- правый prompt ближе 5 ячеек к тексту остаётся в строке;
- строка, которая кончается ровно у края ряда, захватывает ряд под ней (например, список
  дополнений).

**Канал и main.** У `terminalAi.request` новое поле `line`: `z.string().max(MAX_FIELD_CHARS).default('')`.
Без поля строка пустая, поэтому старый клиент (экран Linked machine) работает как раньше.
`requestCommand(context, terminal, words, line, signal)` передаёт строку в `terminalAiInput`. Путь
`# …` передаёт `''` явно. Редакция и правило пробела в начале — прежние, в `prepareContext`.

**Панель.** При ⌘I `TerminalNode.tsx` меряет низ первого ряда `.xterm-rows` с поправкой на масштаб
Canvas. Панель получает `top`: низ первого ряда плюс 4px. Если рядов ещё нет, остаётся запасной
`top: 26px` из `TerminalNode.css`. Якорь нулевой высоты прежний, поэтому экран размер не меняет и
resize shell не получает. Панель по-прежнему закрывает ряды со второго по пятый. Если prompt стоит
ниже первого ряда, набранная строка под панелью не видна. Ticket требует только первый ряд.

**Файлы вне следа (с согласия orchestrator-а):**
- `src/renderer/canvas/nodes/terminal-line.ts`. Функции чтения строки экспортируются для unit test-а,
  а экспорт функции из `.tsx` нарушает правило `react-refresh/only-export-components` уровня error
  (`eslint.config.js:101-103`).
- `test/unit/terminal-theme.test.tsx` и `test/unit/terminal-ai-fix-button.test.tsx`: по одной
  строке, заглушка `parser` в поддельном Terminal. Без неё `TerminalNode` падал на
  `registerOscHandler`, это 8 красных test-ов.

**Test-ы.**
- Unit `test/unit/terminal-ai-request.test.tsx`. Поддельный Terminal теперь держит настоящий
  xterm.js без отрисовки: панель шлёт строку из настоящего буфера и читает её при Enter, а не при ⌘I.
  Отдельно проверяется разбор: prompt, prompt в несколько рядов, отсутствие метки, `C`, перенос
  xterm.js, перенос line feed-ом zsh, prompt во весь ряд, список дополнений, серый текст, правый
  prompt, лимит длины.
- Contract `test/contract/terminal-ai-request.test.ts`. Строка из канала доходит до контекста,
  секрет редактируется, строка с пробела не уходит. Строку длиннее `MAX_FIELD_CHARS` канал
  отклоняет. Для `# …` по-прежнему `line: ''`.
- e2e `test/e2e/terminal-ai-request.spec.ts`, 4 passed под `/tmp/worfy-e2e.lock`. Проверено:
  - `git status --short` уходит в журнал fake;
  - Suggestion из истории в строку не попадает;
  - строка в 165 символов уходит целиком;
  - `export GITHUB_TOKEN=…` уходит как `[redacted]`;
  - строка с пробела в начале уходит пустой;
  - панель ниже первого ряда и в «Terminal is busy» (`sleep 30`), и у prompt-а; точка на первом
    символе первого ряда не панель;
  - число рядов xterm.js и `stty size` до и после панели равны.

**Мутанты, каждый красный:**
- строка не передаётся в `requestCommand` (contract, 2 test-а);
- `# …` передаёт строку `ask.line` (contract, 2);
- панель шлёт `line: ''` (unit, 2);
- Suggestion входит в строку (unit, 2; e2e: `echo wo` → `echo worfy-tai-… second third`);
- `top` панели как на main, `6px` и без `style` (e2e: 149 < 161);
- перенос только по `isWrapped` (unit);
- `C` не сбрасывает метку (unit);
- правый prompt не отбрасывается (unit);
- лимит длины не применяется (unit).

**Проверки.** `pnpm lint`, `pnpm typecheck`, `pnpm test` дали exit 0: 279 файлов, 5877 test-ов.
Gate fast — в отчёте implementer-а. Gate full и Linux CI (batch после Wave) — за orchestrator-ом.

Снимки обеих тем — панель у prompt-а и в «Terminal is busy»:
[светлая](../evidence/13-request-panel-light.png), [тёмная](../evidence/13-request-panel-dark.png),
[busy светлая](../evidence/13-request-panel-busy-light.png), [busy тёмная](../evidence/13-request-panel-busy-dark.png).

Ручных пунктов в Ticket-е нет.

Ревью и merge (2026-10-17): гейт глубины low — `VERIFIED` с первого круга
([вердикт](https://github.com/IDSAD-XL/worfy/pull/441#issuecomment-6235339490)); редакция секретов строки — на
стороне main (`src/main/terminal-ai/assist.ts:447`); снимки проверяющего в обеих темах. Вне следа, с согласия
оркестратора: `src/renderer/canvas/nodes/terminal-line.ts` и строка-заглушка `parser` в двух unit test-ах.
`GATE_SCOPE=all` gate full зелёный со второго прогона (первый — таймауты `e3-sandbox.test.ts` вне diff под
нагрузкой); влит — `3f6cc2d4`.
Долги (low):
- `src/renderer/canvas/nodes/terminal-line.ts:58` — ветка dim (`cell.isDim()`) без test-а: мутант без неё зелёный.
- `src/renderer/canvas/nodes/terminal-line.ts:105` — «правый prompt только на первом ряду строки» без test-а:
  перенесённая строка, у которой второй ряд кончается у края после 5+ пробелов, потеряла бы хвост.
- `src/renderer/canvas/nodes/TerminalNode.tsx:141` — панель закрывает ряды 2–5: prompt на 2-м ряду не виден под
  панелью (снимок `13-request-panel-light.png`); Ticket требовал только первый ряд.
