# 11 — Страница Sessions

Type: task
Status: done 2026-10-30T23:41Z
PR: #1079
Blocked by: 06
Source: «Как устроено» и Q9 [spec.md](../spec.md); решения владельца 2026-10-30, Q2, Q3, Q7, Q9, Q10, Q20, Q21, Q22; [ADR-0088](../../../docs/adr/0088-feature-pages-in-english.md) (английский как основной язык Feature page)

## Что происходит

- Описания этих Feature в репозитории нет. После Ticket-а 01 `docs/features/sessions.md` и
  `docs/features/ru/sessions.md` — заготовки в одну строку.

## Что делаем

1. Читает код и test-ы из свежего `origin/main`. Это источник страницы (Q7). Ticket-ы и ADR нужны только
   для «почему так» и как подсказка, где искать.
2. Пишет `docs/features/sessions.md` на английском, по разделу на каждый Feature:
- Session.
- Subagent.
- Transcript.
- Claude home.
- Memory.
- Limits.
3. В каждом разделе — три блока шаблона: **Behaviour** (без путей), **How it works** («почему так» — одна-две
   фразы и ссылка на ADR), **Implementation** (модули и точки входа с путями, поток данных, главные test-ы;
   без номеров строк и без копий сигнатур). Отличия платформ и работа на Linked machine — подзаголовком внутри нужного блока (`On a Linked machine`). Для Feature с многими состояниями внутри Behaviour разрешены подзаголовки и таблицы. Конкретные числа на странице остаются. Linux не описывается: пакета для него нет. Скриншотов
   нет. Только настоящее: без changelog и без пересказа ADR. Пути — в форме из индекса
   `docs/features/README.md`.
4. Утверждение, которое не подтверждается кодом или test-ом, на страницу не попадает. Оно уходит в раздел
   `## Итог` этого Ticket-а (Q20). Запускать приложение не нужно, платных запросов к Claude нет.
5. Страница вышла больше примерно 400 строк — делит её на две и пишет об этом в `## Итог`, таблица spec-а и
   индекс правятся отдельным PR (Q9).
6. Пишет `docs/features/ru/sessions.md`: перевод с шапкой `> Перевод [английской версии](../sessions.md), commit `same-pr`.`
   под заголовком. Термины и названия UI остаются на английском.
7. Индекс не правит (Q22).

## Готово, когда

- [ ] Обе страницы в `main`, заготовки заменены, разделы соответствуют списку или отличия объяснены в
      `## Итог`.
- [ ] Страница на английском, это не ошибка: для `docs/features/` действует исключение ADR-0088.
- [ ] Review: один агент уровня `low` сверяет каждое утверждение с кодом и проверяет, что на странице нет
      номеров строк. Merge блокирует только неверное утверждение (Q21; исключение из правила о PR только с
      документами, раздел «Исключения» spec-а). Отчёт review называет уровень и потраченные токены.
- [ ] `ci-ok` зелёный. Gate full не нужен: код не меняется.
- [ ] `## Итог` называет утверждения, которые не подтвердились. Токены на страницу записывает Orchestrator
      при закрытии Ticket-а, не implementer.

## Тесты

Новых test-ов нет. Проверка путей Ticket-а 02 читает английскую страницу.

## Где в коде

Папки выведены из имён, код при составлении Ticket-а не читался. Автор проверяет список при claim и дополняет:

- `src/main/agent`
- `src/shared/agent`
- `src/renderer/session`
- `src/shared/transcript`
- `src/main/claude-home`
- `src/renderer/claude-home`
- `src/shared/memory.ts`
- `src/renderer/memory`
- `src/renderer/limits`

## Вне скоупа

- Исправление найденных багов продукта: такая находка — в `## Итог`.
- Feature, которых нет в `main`.

## Итог

**Страница разделена на две (Q9).** Текст вышел больше 500 строк, и он разбит так:

- `docs/features/sessions.md`, 310 строк: Session и Subagent.
- `docs/features/transcripts-and-usage.md`, 214 строк: Transcript, Claude home, Memory и Limits.
- Переводы лежат в `docs/features/ru/` под теми же именами.

Индексы `docs/features/README.md`, `docs/features/ru/README.md` и таблица в `spec.md` по этому Ticket-у не менялись. В них
нужно добавить новую страницу отдельным PR. Пока на неё ведёт ссылка из вступления `sessions.md`.

**Что значит Memory.** В коде это показатель памяти собственных процессов worfy в toolbar, а не память Claude. Раздел написан про него.

**Утверждения, которые не подтвердились и на страницу не попали:**

- «Session с открытым запросом разрешения нельзя закрыть». Так можно понять UI, но код отказывает только в `busy`. На странице
  написано только про `busy`.
- «Limits показываются и в rail Session view», как сказано в комментарии заголовка `src/shared/agent/limits.ts`. Этот комментарий
  устарел: Limits рисует только toolbar (`src/renderer/shell/toolbar/LimitsMeter.tsx`), и на странице написано так.

**Что подтверждено только кодом или комментарием, без запуска:**

- Части Windows написаны из кода и test-ов. Приложение не запускалось.
- Причины поведения Windows взяты из комментариев в коде: поздний `exit` у Node и поток событий watch после исчезновения папки данных.

**Возможные баги продукта (код не менялся):**

- `closeRefusal` в `src/main/agent/resume.ts` отказывает только в `busy`. UI считает `needs_permission` идущим turn-ом
  (`src/renderer/session/SessionView.tsx`), комментарий к функции говорит про «a running turn». Поэтому Session с открытым запросом
  разрешения можно закрыть, а Orchestrator в этом состоянии пускает «New conversation». Не проверено, задумано ли так.
- «New conversation» без предупреждения теряет сообщения очереди, придержанные тоже (`src/main/agent/orchestrator.ts`, `newConversation`):
  старая Session закрывается без `handOverQueue`, а Node не спрашивает подтверждения.
- «Return to send» и «Return to queue» на Windows всё равно говорят Return (`src/renderer/session/MessageInput.tsx`): это постоянный текст,
  а подсказка под полем берёт клавиши из `src/renderer/session/hints.ts` и пишет Enter.
- На Session Node нет Interrupt в `needs_permission` (`src/renderer/canvas/nodes/SessionNode.tsx`): кнопка показывается только в `busy`, а Session view
  предлагает Interrupt и в этом состоянии.

Эти три нашла проверка PR #1079 при чтении кода. Приложение для них не запускалось.

**Поправка к списку «Где в коде».** Кроме перечисленных папок, понадобились:

- `src/main/diagnostics/memory.ts`.
- `src/main/ipc/`: `agent.ts`, `sessions.ts`, `orchestrator.ts`, `claude-home.ts`, `limits.ts`, `memory.ts`, `session-autocompact.ts`.
- `src/shared/ipc/`, те же домены.
- `src/renderer/shell/toolbar/` (Limits и Memory) и `src/renderer/shell/sidebar/SessionsSection.tsx`.
- `src/renderer/settings/SessionsSection.tsx`, `src/renderer/settings/GeneralSection.tsx`, `src/shared/settings/app-settings.ts`.
- `src/renderer/canvas/nodes/` (Node Session, Orchestrator и Subagent), `src/renderer/canvas/sources/subagents.ts`,
  `src/renderer/canvas/overlays/SessionNodes.tsx`.
- `src/renderer/palette/CommandPalette.tsx`, `src/main/notify.ts`, `scripts/statusline-bridge.sh`, `scripts/statusline-bridge.mjs`.

