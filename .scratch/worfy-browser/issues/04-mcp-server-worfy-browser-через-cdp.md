# 04 — MCP server `worfy-browser` через CDP: инструменты Session, список origin-ов, плашка «Claude управляет», перехват

Type: task
Status: claimed 2026-10-22T03:23Z
Branch: worfy-browser/04
Blocked by: 03
Source: [spec.md](../spec.md); [ADR-0078](../../../docs/adr/0078-browser-node.md) (Browser Node), пункт 4
(свой MCP server через CDP, `webContents.debugger`; входит в список Profile), пункт 8 (Session
открывает Browser под существующим Browser profile; плашка; перехват), пункт 5 (переход вне списка
origin-ов отклоняется), «Последствия» (CDP-сессия — только на Machine Project-а);
[ADR-0021](../../../docs/adr/0021-mcp-servers-allowlist-in-profile.md) (список MCP server-ов в Profile).
Код перечитан по main `dd6b0afb`.

## Что происходит

- MCP server-ы Session собираются в `src/main/agent/options.ts:355-370`: встроенный `worfy-canvas`
  добавляется, если его пропускает `allowed(name)` (`:349`), затем server-ы Harness plugin-а через
  тот же фильтр. Список из Profile приходит в `src/main/agent/app-registry.ts:107`.
- `worfy-canvas` — in-process server SDK (`createSdkMcpServer`): `createCanvasServer`
  (`src/main/mcp/canvas-server.ts:281`), инструменты из одной таблицы `CANVAS_TOOL_NAMES`
  (`src/shared/canvas/tools.ts:67`), инструкции агенту — `src/main/mcp/agent-instructions.md`.
- После Ticket-а 03 у Browser есть Browser profile со списком origin-ов, а CDP-сессии нет.

## Что делаем

1. **Server** — `src/main/mcp/browser-server.ts` (новый), имя `worfy-browser`, устроен как
   `worfy-canvas`: in-process, таблица инструментов в `src/shared/browser/tools.ts` (новый),
   инструкции — `src/main/mcp/browser-instructions.md` (новый). Добавляется в `options.ts` через
   `allowed(name)`, как `worfy-canvas` (ADR-0021).
2. **CDP** — `src/main/browser/cdp.ts` (новый): `webContents.debugger` guest-страницы Browser, только
   в main на Machine Project-а. Реестр Live Browser-ов (id Node-а → webContents) —
   `src/main/browser/live.ts` (новый).
3. **Инструменты** (ADR-0078, п. 4): открыть Browser под Browser profile, перейти по URL, кликнуть,
   напечатать, screenshot, прочитать страницу, консоль, сеть. Плюс список Browser profile-ов
   Project-а (имя, origin-ы) — без него Session не выберет, под каким открыть. Названия — вопрос 1.
4. **Открыть Browser.** Session открывает Browser только под существующим Browser profile; создать
   Browser profile она не может. Новый Node — операция `create` Layout-а (`types.ts:126`) мимо ⌘Z. В
   `data` Node-а пишется `openedBy` — Session, открывшая Browser (его читает Ticket 06).
5. **Список origin-ов** — `src/main/browser/origins.ts` (новый): переход Session по URL вне списка
   Browser profile отклоняется ошибкой с origin-ом и списком. Пользователь руками ходит куда угодно.
6. **Плашка «Claude управляет»** на рамке, пока Session ведёт Browser. Клик или ввод пользователя в
   этом Browser забирает управление: плашка снимается, следующий вызов инструмента Session получает
   ошибку «пользователь перехватил».

## Готово, когда

- [ ] Unit `test/unit/browser-origins.test.ts`: URL в списке, вне списка, другой порт, другая схема,
      `about:blank`, `data:`, `javascript:`; пустой список — Session никуда не ходит.
- [ ] Unit `test/unit/agent-options.test.ts` (`mcpAllowlist`, `src/main/agent/options.ts:349`), три
      случая: `null` — фильтра нет, разрешено всё, `worfy-browser` есть; `[]` — запрещено всё,
      `worfy-browser` нет; список называет `worfy-browser` — есть, не называет — нет.
- [ ] Contract `test/contract/browser-tools.test.ts` (как `test/contract/canvas-tools.test.ts`): схемы
      инструментов; «открыть» под несуществующим Browser profile — ошибка.
- [ ] e2e `test/e2e/browser-mcp.spec.ts` на fixture-страницах: Session открывает Browser, переходит,
      кликает, печатает, получает screenshot, текст страницы, сообщение консоли и запрос сети;
      переход вне списка — ошибка, страница не сменилась; плашка «Claude управляет» видна, клик
      пользователя её снимает, следующий вызов — «пользователь перехватил»; снимок
      `browser-claude-drives` в обеих темах.
- [ ] По решениям владельца 2026-10-22: e2e — redirect и клик по ссылке на origin вне списка
      отклоняются, страница не сменилась, ошибка называет origin; после перехвата вызовы получают
      ошибку до «Return control to Claude», после него Session снова ведёт Browser; «напечатать» в
      `input[type=password]` — ошибка «вход делает человек»; Browser, открытый Session, стоит рядом с
      её Node-ом без перекрытий.
- [ ] Мутанты красные: проверка origin-а только по host (без порта); перехват не сбрасывает
      управление; server добавлен мимо `allowed(name)`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

## Тесты

- Сначала падающий: unit `browser-origins.test.ts` на другой порт.
- Unit `test/unit/browser-origins.test.ts` (новый), `test/unit/agent-options.test.ts`; contract
  `test/contract/browser-tools.test.ts` (новый); e2e `test/e2e/browser-mcp.spec.ts` (новый).

## Где в коде

- `src/main/mcp/browser-server.ts` (новый)
- `src/main/mcp/browser-instructions.md` (новый)
- `src/shared/browser/tools.ts` (новый)
- `src/main/browser/cdp.ts` (новый)
- `src/main/browser/live.ts` (новый)
- `src/main/browser/origins.ts` (новый)
- `src/main/agent/options.ts` (`allowed` `:349`, сборка `:355-370`)
- `src/main/agent/app-registry.ts` (`:107`)
- `src/shared/ipc/browser.ts` (событие «Claude управляет» и перехват)
- `src/renderer/canvas/nodes/BrowserNode.tsx` (плашка)
- `test/unit/browser-origins.test.ts` (новый)
- `test/unit/agent-options.test.ts`
- `test/contract/browser-tools.test.ts` (новый)
- `test/e2e/browser-mcp.spec.ts` (новый)
- Дописано исполнителем при работе: `src/main/ipc/browser.ts` (handler-ы `browser.page.live` и
  `browser.control.*`), `src/renderer/browser/control.ts` (новый: кто ведёт Browser, в окне),
  `src/renderer/canvas/overlays/BrowserLayer.tsx` (страница сообщает main свой web contents),
  `src/renderer/canvas/nodes/BrowserNode.css` (вид рамки под управлением Session),
  `test/unit/link-access.test.ts` (метки новых channel-ов), `test/contract/workflow-profile.test.ts`
  (список Profile с `worfy-canvas` получает `worfy-browser`, решение 6).

Только чтение: `src/main/mcp/canvas-server.ts` (`createCanvasServer` `:281`), `src/shared/canvas/tools.ts`
(`:67`), `src/main/browser/profiles.ts`, `src/shared/layout/types.ts` (`create` `:126`).

## Вне скоупа

- Пробуждение Asleep Browser вызовом инструмента и ошибка «все Live Browser-ы заняты» — Ticket 05.
- Family и уход Browser вместе с Session — Ticket 06.
- Autopilot и флажок «доступен Autopilot» — Ticket 08.

## Открытые вопросы (решены 2026-10-22, см. «Решения владельца»)

1. **Названия и аргументы инструментов** (`browser_open`, `browser_navigate`, …) ADR не задаёт.
   Исполнитель предлагает в PR; решает ревью.
2. **Переход, который вызвал клик Session**, а не прямой переход по URL (ссылка, redirect, OAuth на
   чужой origin): отклонять как переход Session или нет — ADR не говорит. Решает владелец до claim.
3. **Возврат управления после перехвата:** может ли Session снова вести Browser следующим вызовом
   или ждёт слова пользователя — ADR не решает.
4. **Что возвращает «прочитать страницу»** — текст, accessibility tree или DOM — и сколько хранится
   консоли и сети (последние N записей, тела запросов или нет). ADR не задаёт.
5. **Место нового Browser на Canvas**, когда его открывает Session: рядом с Session Node-ом или по
   `freePlace` (ADR-0038). ADR не говорит.
6. **`worfy-browser` в списках Profile, которые уже есть:** добавляется сам или пользователь вписывает
   его руками (ADR-0021). ADR говорит только «как любой другой».
7. **Поле пароля.** Отклонять ли «напечатать» в поле `type=password`, раз вход делает только
   пользователь (ADR-0078, п. 5), — ADR прямо не решает. Предложение: отклонять; решает владелец.

## Решения владельца — 2026-10-22

Владелец согласился со всеми предложениями по вопросам 1–7 (Q-B1…Q-B7 в HANDOFF):

1. **Названия и аргументы инструментов** предлагает исполнитель в PR; их утверждает ревью.
2. **Любой переход всей страницы на origin вне списка отклоняется**, кто бы его ни вызвал: клик по
   ссылке, redirect, шаг OAuth. Страница остаётся прежней. Ошибка инструмента называет origin.
3. **После перехвата** Session не может вести этот Browser, пока пользователь не нажмёт «Return control
   to Claude».
4. **«Прочитать страницу»** по умолчанию возвращает текстовый снимок accessibility tree, последние 200
   сообщений консоли и последние 200 запросов сети без тел.
5. **Browser, который открыла Session,** встаёт рядом с её Node-ом; место выбирает `freePlace`
   (ADR-0038).
6. **`worfy-browser` добавляется в списки Profile, которые уже есть, сам** (ADR-0021).
7. **«Напечатать» в поле `input[type=password]` отклоняется.** Ошибка говорит, что вход делает человек.

Пункты 3–6 «Что делаем» читать вместе с этими решениями. Решение 2 расширяет пункт 5: проверка origin-а
стоит на каждом переходе всей страницы, а не только на вызове «перейти по URL». Решение 3 меняет пункт 6:
следующий вызов после перехвата получает ошибку «пользователь перехватил», и так до «Return control to
Claude».

## Итог

Заполняется при закрытии.
