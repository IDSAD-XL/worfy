# 17 — Вопросы с вариантами ответа в Session (AskUserQuestion)

Type: task
Status: claimed 2026-10-21T14:02Z
Branch: worfy-ui/17
Blocked by: —
Source: отзыв владельца 2026-10-19 после ручной приёмки Ticket-а 12: в чате Session worfy — окно
вопроса с вариантами ответа, как окно вопроса в Claude Code desktop; ответить можно и из toast-а
([Ticket 16](16-внутренние-toast-ы.md)). Код перечитан по main `9fa28aed`, типы SDK — по
`@anthropic-ai/claude-agent-sdk` 0.3.289 (`package.json:28`).

## Что происходит

- Claude Code задаёт вопросы инструментом `AskUserQuestion`. Его вход — тип `AskUserQuestionInput`
  (`node_modules/@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:1115`):
  - `questions` — от 1 до 4 вопросов;
  - у вопроса `question`, `header` (метка до 12 символов), `multiSelect` и `options` — от 2 до 4
    вариантов `{ label, description, preview? }`;
  - вариант «Other» модель не даёт, его добавляет тот, кто показывает вопрос;
  - `answers?: { [вопрос]: string }` — «ответы, собранные компонентом разрешений» (`sdk-tools.d.ts:2664`);
  - `annotations?: { [вопрос]: { preview?, notes? } }`.
- Выход `AskUserQuestionOutput` (`sdk-tools.d.ts:3768`): `answers` — текст вопроса → строка ответа,
  ответы `multiSelect` — через запятую. Свободный текст вместо варианта — `response`.
- Отсюда путь ответа по типам: `canUseTool` отвечает `{ behavior: 'allow', updatedInput: { ...input,
  answers } }`. Запуском это не проверено.
- В SDK есть и другой путь диалогов — `onUserDialog` с `supportedDialogKinds`
  (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1507`, `:1765`). Кроме
  `refusal_fallback_prompt` вид диалога в типах не назван. Идёт ли через него `AskUserQuestion`,
  неизвестно.
- Формат `preview` задаёт `toolConfig.askUserQuestion.previewFormat`: `markdown` (по умолчанию) или
  `html` (`sdk.d.ts:1700`, `:9727`).
- В worfy `AskUserQuestion` нигде не обрабатывается: поиск по `src/` пуст.
  - Его вызов идёт общим путём разрешений. `PermissionGate.canUseTool`
    (`src/main/agent/permissions.ts:134`) шлёт событие `permission_request`.
  - Карточка `src/renderer/session/PermissionCard.tsx:51` показывает Allow / Always / Deny, а вход —
    JSON-ом (`permissionInputText`, `:31`).
  - `answer()` (`permissions.ts:172`) на Allow отдаёт `updatedInput: pending.input` (`:176`) — вход
    как был. Выбранный вариант до модели дойти не может.
- Session без человека (Autopilot) отказывает каждому вызову (`unattendedCanUseTool`,
  `permissions.ts:82`).
- Значок Node «Needs permission» (`src/renderer/canvas/badges/NeedsPermission.tsx:15`) и системное
  уведомление (`src/main/notify.ts:223`) реагируют только на `permission_request`.
- fake-агент (`src/main/agent/fake-query.ts`) — скрипт worfy, а не SDK: строка `permission` зовёт
  `canUseTool` во всех режимах, кроме `bypassPermissions` (`fake-query.ts:28`). Как ведёт себя
  настоящий Claude Code с `AskUserQuestion`, fake показать не может.
- Режим новой Session по умолчанию — `bypassPermissions` (`DEFAULT_SETTINGS`,
  `src/shared/agent/settings.ts:33`; меняется в composer-е, в Claude Code уходит через
  `src/main/agent/options.ts:325`). Зовёт ли Claude Code `canUseTool` для `AskUserQuestion` в этом
  режиме — главный неизвестный.
- Факт к шагу 1 (log Stable `e61cb1fe`, 2026-10-19): Agent SDK пишет предупреждение
  `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` — «canUseTool will not be invoked: permissionMode
  'bypassPermissions' auto-approves every tool call». Значит, в `bypassPermissions` карточка вопроса
  не может ехать на `canUseTool`; шаг 1 проверяет `onUserDialog` и hook `PreToolUse` для
  `AskUserQuestion`.

## Что делаем

1. **Сначала — как Claude Code задаёт вопрос.** Один запуск настоящего Claude Code через Agent SDK
   (не fake) с `canUseTool`, который пишет вызовы в файл, в режимах `default`, `acceptEdits` и
   `bypassPermissions`. Prompt просит задать вопрос с двумя вариантами. Записать в «Итог»:
   - зовётся ли `canUseTool` для `AskUserQuestion` и в каких режимах;
   - зовётся ли `onUserDialog`, если объявлен, и с каким `dialogKind`;
   - что модель получила в tool_result на `updatedInput` с `answers` — для одного варианта,
     `multiSelect` и «Other»;
   - что происходит без ответа: deny, отмена.

   Это настоящий вызов модели. Он пишет transcript в `~/.claude/projects`, поэтому нужно согласие
   оркестратора: брифинг говорит `Write to ~/.claude: allowed`, или запускает владелец. Наблюдения
   становятся строкой fake-агента (директива `question` или поле `permission`) — дальше все test-ы
   идут на fake.

   Если `canUseTool` в `bypassPermissions` не зовётся и `onUserDialog` не помогает — Ticket
   останавливается с `ticket block` и вопросом владельцу. Варианты для вопроса:
   - Session с вопросами не в `bypassPermissions`;
   - убрать `AskUserQuestion` из инструментов (`disallowedTools`);
   - оставить как есть.
2. **Main.** `PermissionGate` узнаёт вызов `AskUserQuestion` и шлёт отдельное событие (например
   `question_request`): вопросы, варианты, `multiSelect`, `preview`, id запроса. Ответ приходит
   отдельным каналом (например `agent.answerQuestion`) и уходит в `canUseTool`:
   - на «Ответить» — `allow` с `updatedInput = { ...input, answers }`, форма — по шагу 1;
   - на «Отказаться» — `deny`.

   Отмена при interrupt и закрытии — как у обычного запроса (`cancelAll`). «Always allow» к вопросу
   не предлагается. Session без человека по-прежнему отказывает.
3. **Карточка вопроса** в Session view (`src/renderer/session/QuestionCard.tsx`, новая) вместо
   `PermissionCard` для `AskUserQuestion`:
   - метка `header` и текст вопроса;
   - варианты — кнопками, `description` под `label`;
   - `multiSelect` — переключатели;
   - «Other» — поле свободного текста;
   - `preview` выбранного или наведённого варианта показывается рядом: `markdown` — в моноширинном
     блоке, через Markdown worfy;
   - несколько вопросов — по одному с шагом «дальше / назад» или все сразу (выбор исполнителя, в
     «Итог»);
   - «Submit» активна, когда у каждого вопроса есть ответ.

   Клавиатура: цифры 1–4 выбирают вариант, Enter отправляет, Tab ходит по вариантам. Отвеченная
   карточка показывает выбранные ответы, как `PermissionCard` показывает решение. На экране Linked
   machine с правом «только чтение» (worfy-link 25) карточка видна, ответить нельзя.
4. **Значок и уведомление.** Session, которая ждёт ответа на вопрос, — значок Node «Waits for answer»
   (рядом с `NeedsPermission.tsx`, тот же порядок слотов). Системное уведомление `notify.ts` для
   Session в фоне: «Asks: <первый вопрос>». Клик открывает Session.
5. **Toast `action`** (хранилище Ticket-а 16): вопрос Session, открытой не в этом виде, — toast с
   текстом первого вопроса и вариантами-кнопками для простого случая (один вопрос, без `multiSelect`
   и `preview`) и кнопкой «Open». Ответ из toast-а идёт тем же каналом. Если к claim Ticket 16 не
   влит, пункт 5 уходит в новый Ticket Epic-а, его номер — в «Итог».

## Готово, когда

- [x] «Итог» называет поведение настоящего Claude Code из шага 1 (режимы, путь — `canUseTool` или
      `onUserDialog`, форма `answers`, что видит модель), со ссылкой на файл записи.
- [x] Contract test на fake-агенте (`test/contract/permissions.test.ts` или новый): вопрос даёт
      событие вопроса, а не `permission_request`; ответ одним вариантом, `multiSelect` и «Other»
      отдаёт в `canUseTool` `updatedInput` с `answers` в форме шага 1; отказ — `deny`; interrupt —
      отмена; Session без человека отказывает, как раньше.
- [x] Unit карточки (`test/unit/question-card.test.tsx`): варианты, `multiSelect`, «Other», Submit
      неактивна без ответа, клавиши 1–4 и Enter, отвеченная карточка, только чтение.
- [x] e2e (`test/e2e/session-question.spec.ts`, новый, fake-агент): вопрос → карточка → ответ →
      transcript показывает ответ; значок «Waits for answer» на Node и его снятие после ответа.
- [x] Системное уведомление для Session в фоне — unit `test/unit/notify.test.ts`.
- [x] Toast `action` (если Ticket 16 влит): ответ из toast-а доходит до `canUseTool` (e2e или unit).
- [x] Мутанты красные: `updatedInput` без `answers`; ответ `multiSelect` одной строкой без запятых
      (если шаг 1 подтвердил запятые); вопрос как обычный `permission_request`.
- [ ] Снимки карточки в светлой и тёмной теме — в «Итог»; `pnpm lint`, `pnpm typecheck`,
      `pnpm test` — exit 0; gate full — exit 0 и строка `[gate] зелено (full)` (оркестратор перед
      merge).

## Тесты

- Сначала падающий: contract test, где fake-агент задаёт вопрос и ждёт `answers` в `updatedInput`, —
  красный на main (`answer()` отдаёт вход как был).
- `test/contract/permissions.test.ts` — путь вопроса в `PermissionGate`.
- `test/unit/question-card.test.tsx` (новый), `test/unit/permission-card.test.tsx` — карточка
  разрешения для других инструментов не изменилась.
- `test/unit/notify.test.ts` — уведомление о вопросе.
- `test/e2e/session-question.spec.ts` (новый).

## Где в коде

Файлы, которые меняет diff (сверено с PR #698 после первого раунда review):

- `src/main/agent/permissions.ts`
- `src/main/agent/fake-query.ts`
- `src/main/agent/session.ts`
- `src/main/ipc/agent.ts`
- `src/main/notify.ts`
- `src/shared/agent/events.ts`
- `src/shared/agent/questions.ts` (новый)
- `src/shared/ipc/agent.ts`
- `src/renderer/main.tsx`
- `src/renderer/canvas/badges/NeedsPermission.tsx`
- `src/renderer/canvas/badges/WaitsForAnswer.tsx` (новый)
- `src/renderer/session/QuestionCard.tsx` (новый)
- `src/renderer/session/question-card.css` (новый)
- `src/renderer/session/question-toast.ts` (новый)
- `src/renderer/session/open-requests.ts` (новый)
- `src/renderer/session/shown-session.ts` (новый)
- `src/renderer/session/SessionView.tsx` (одна строка: Session на экране — в `shown-session.ts`)
- `src/renderer/session/rows/QuestionRequest.tsx` (новый; строки transcript находит `import.meta.glob`)
- `test/fixtures/agent-scripts/question.jsonl` (новый)
- `test/contract/ask-user-question-sdk.test.ts` (новый)
- `test/contract/messages-api-stand-in.ts` (новый)
- `test/contract/permissions.test.ts`
- `test/contract/link-access.test.ts`
- `test/unit/link-access.test.ts`
- `test/unit/question-card.test.tsx` (новый)
- `test/unit/questions.test.ts` (новый)
- `test/unit/notify.test.ts`
- `test/e2e/session-question.spec.ts` (новый)

Только читать: `src/renderer/toast/toasts.ts` Ticket-а 16 (пункт 5 зовёт `showToast`).

## Вне скоупа

- Вопросы Session без человека (Autopilot): они по-прежнему получают отказ.
- `preview` в формате `html` (`toolConfig.askUserQuestion.previewFormat`) — только `markdown`.
- Тайм-аут ответа (`askUserQuestionTimeout` в настройках Claude Code) — не трогаем.

## Итог

**Поведение настоящего Claude Code (шаг 1).** Проверено без вызова модели: бинарник Claude Code из
Agent SDK 0.3.289 запущен против локального stand-in Messages API
(`test/contract/messages-api-stand-in.ts`), файл записи — `test/contract/ask-user-question-sdk.test.ts`
(4 теста, ~1 с). Настоящий `~/.claude` не тронут: `HOME` и `CLAUDE_CONFIG_DIR` — временная папка.

- Путь — `canUseTool`, во всех трёх режимах: `default`, `acceptEdits` и `bypassPermissions`. В опциях
  вызова — `requiresUserInteraction: true`. `onUserDialog` для этого инструмента не вызывается.
  Без `canUseTool` модели инструмент даже не предлагается. Предупреждение SDK
  `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` для этого инструмента ложное.
- Ответ — `{ behavior: 'allow', updatedInput: { ...input, answers } }`. `answers` — объект: текст
  вопроса → одна строка. Ответ `multiSelect` — метки через `", "`; Claude Code сам режет по `", "`.
- Что читает модель в `tool_result`:
  - каждый ответ — метка своего вопроса: «Your questions have been answered: "Q"="A". You can now
    continue with these answers in mind.»;
  - хоть один ответ — свой текст («Other»): «The user answered: "Q"="A". Read the answers
    carefully …»;
  - `allow` без `answers` (так было на main): «The user did not answer the questions.»;
  - `deny` — текст отказа с `is_error: true`.
- PreToolUse hook с `updatedInput.answers` тоже работает, но реализация его не использует.

**Что сделано.**
- В main вопрос AskUserQuestion — своё событие `question_request` / `question_resolved`
  (`src/shared/agent/events.ts`), а не `permission_request`. Ответ — новый канал
  `agent.answerQuestion` (доступ `write`: на Linked машине только для чтения отказ).
  Формат `answers` собирается в одном месте — `formatAnswers` в `src/shared/agent/questions.ts`.
  «Always allow» вопрос не отвечает. Вход, который не читается как вопросы, идёт прежним путём
  разрешения.
- Карточка вопроса в transcript (`QuestionCard.tsx`): несколько вопросов — по одному, с Back / Next
  и чипами заголовков сверху; варианты с описанием, «Other», `preview` (markdown) в колонке рядом;
  клавиши 1–4 и Enter; Submit неактивна без ответа на каждый вопрос; Decline — `deny`. Отвеченная
  карточка показывает ответы и исход (Answered / Declined / Cancelled). На экране только для чтения
  карточка видна, ответить нельзя.
- Значок «Waits for answer» на Node (`badges/WaitsForAnswer.tsx`); «Needs permission» прячется,
  когда открыты только вопросы.
- Системное уведомление «Asks: <вопрос>» для Session в фоне (`src/main/notify.ts`).
- Toast (Ticket 16 влит): `question-toast.ts`. Простой вопрос (один, два варианта, без
  `multiSelect` и `preview`) отвечается кнопками toast-а, любой другой — «Open». Toast уходит, когда
  вопрос решён где угодно.
- Fake-агент: директива `{"fake":"question",…}` и текст результата как у настоящего Claude Code.

**Снимки** (e2e `test/e2e/session-question.spec.ts`):
[карточка, светлая](../evidence/17-question-card-light.png),
[карточка, тёмная](../evidence/17-question-card-dark.png),
[toast, светлый](../evidence/17-question-toast-light.png),
[toast, тёмный](../evidence/17-question-toast-dark.png).

**Мутанты — все красные (10 из 10):** `updatedInput` без `answers`; `multiSelect` через пробел;
вопрос как обычный `permission_request`; текст «Other» потерян; Submit на экране только для чтения;
клавиши на экране только для чтения; канал `agent.answerQuestion` с доступом `read`; toast отвечает
`multiSelect`-вопрос; нет уведомления; значок не видит вопросов.

**Проверки** (после rebase на main `7cd9cac7`). `pnpm lint` — exit 0; `pnpm typecheck` — exit 0;
`pnpm test` — exit 0 (371 файл, 7834 теста пройдено, 83 пропущено); e2e `session-question.spec.ts` —
exit 0 (2 теста; самый первый запуск был красным из-за мигания `preview` под курсором, исправлено).
PR #698. Gate full — за оркестратором перед
merge.

**Платформенный PR?** Нет (ADR-0056, пункт 2): в `src` нет веток по платформе, нет скриптов Harness
и упаковки. Contract test запускает бинарник Claude Code текущей платформы. На Windows runner он
прошёл: run 39630300392 на `eb6dbab2` — 3 файла, 64 теста, `ask-user-question-sdk` 4 из 4, не
пропущен. На Linux отдельно не запускался.

**Не сделано / известные пределы.**
- Шапка Session для вопроса по-прежнему говорит «needs permission» (статус Session общий с
  разрешением).
- После перезагрузки окна открытые вопросы renderer не знает — тот же предел, что у карточки
  разрешения.
