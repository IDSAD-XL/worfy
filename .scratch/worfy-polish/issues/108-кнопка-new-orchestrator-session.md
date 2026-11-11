# 108 — Кнопка «New Orchestrator Session» вместо «New conversation»

Type: polish
Status: claimed 2026-11-11T15:49Z
Branch: worfy-polish/108
Blocked by: —
Source: решение владельца 2026-11-11 (бриф Orchestrator-а): кнопку «New conversation» на Node Orchestrator-а
(`src/renderer/canvas/nodes/OrchestratorNode.tsx`) переименовать в «New Orchestrator Session», tooltip — «The current
Session goes to the history; the Orchestrator starts again with a clean context.»

## Что происходит

На Node Orchestrator-а кнопка называется «New conversation». Словарь `CONTEXT.md` запрещает слово «conversation» для
Session (_Avoid_: сессия, чат, диалог, conversation). Слово «New session» в worfy уже занято: оно добавляет ещё одну
Session, а эта кнопка заменяет текущую Session Orchestrator-а (старая остаётся в истории). Отсюда название
«New Orchestrator Session».

## Что делаем

1. Текст кнопки — «New Orchestrator Session», tooltip в обычном состоянии — «The current Session goes to the history;
   the Orchestrator starts again with a clean context.» Tooltip в `busy` («Interrupt the turn first») и подсказка
   read-only не меняются.
2. Отказ, пока Autopilot ведёт Orchestrator (`AUTOPILOT_OWNS_ORCHESTRATOR` в `src/main/agent/orchestrator.ts`), называет
   кнопку тем же именем: «… stop Autopilot before starting a New Orchestrator Session».
3. Текст настроек Project-а про Vendor Orchestrator-а (`src/renderer/shell/ProjectSettings.tsx`) называет кнопку
   новым именем.
4. Страницы `docs/features/` (английские и `docs/features/ru/`), которые называют кнопку, — новое имя; в русских
   страницах текст кнопки остаётся по-английски. «Old conversation» про Session — «old Session».
5. Комментарии кода и названия test-ов, которые цитируют кнопку, — новое имя. Внутренние идентификаторы остаются:
   канал IPC `orchestrator.newConversation`, метод `Orchestrators.newConversation`, `data-testid`
   `orchestrator-new-conversation` — их не видит человек, а канал IPC входит в список каналов Linked machine
   (`test/unit/link-access.test.ts`), и его смена сломала бы связь машин с разными версиями worfy.
6. Старые тикеты в `.scratch/` и fixture `test/fixtures/worfy-mvp-epic/` — история, не правятся.

## Готово, когда

- [ ] Кнопка на Node Orchestrator-а называется «New Orchestrator Session», её tooltip — новый текст; unit test
      находит кнопку по имени и tooltip-у.
  - evidence: test-run pass · `pnpm test test/unit/orchestrator-node.test.tsx test/unit/linked-read-only.test.tsx` exit 0 · mac - · e1ab280da5a90eb0f327462b755955072889fe48
- [ ] Отказ во время Autopilot называет «New Orchestrator Session» — contract test `test/contract/autopilot.test.ts`.
  - evidence: test-run pass · `pnpm test test/contract/autopilot.test.ts` exit 0 · mac - · e1ab280da5a90eb0f327462b755955072889fe48
- [ ] Ни один текст в `src/` и `docs/features/`, который видит человек, не называет кнопку «New conversation»:
      `git grep -n "New conversation" -- src docs/features` пуст.
  - evidence: commit pass · git grep -n "New conversation" -- src docs/features: no match · - - · e1ab280da5a90eb0f327462b755955072889fe48
- [ ] e2e spec-и с текстом кнопки (`test/e2e/vendor-picker.spec.ts`) ждут новый текст; e2e — только в CI на PR
      (локальный e2e сейчас запрещён: владелец за Mac).
- [ ] lint, typecheck, test-ы затронутых модулей и gate fast — exit 0; `ci-ok` на PR зелёный.
  - evidence: gate pass · `gate fast` exit 0 · mac - · e1ab280da5a90eb0f327462b755955072889fe48

## Где в коде

- `src/renderer/canvas/nodes/OrchestratorNode.tsx`.
- `src/main/agent/orchestrator.ts`, `src/main/agent/app-orchestrators.ts`, `src/shared/ipc/orchestrator.ts`,
  `src/renderer/session/transcript-view.ts` — комментарии.
- `src/renderer/shell/ProjectSettings.tsx`.
- `docs/features/sessions.md`, `docs/features/autopilot.md`, `docs/features/projects.md`, `docs/features/vendors.md` и
  их переводы в `docs/features/ru/`.
- `test/unit/linked-read-only.test.tsx`, `test/unit/orchestrator-node.test.tsx` (новый, если нужен),
  `test/contract/autopilot.test.ts`, `test/contract/node-sessions.test.ts`, `test/contract/app-orchestrators.test.ts`,
  `test/contract/codex-auto-continue.test.ts`, `test/contract/codex-orchestrator.test.ts`.
- `test/e2e/vendor-picker.spec.ts`, `test/e2e/controls.spec.ts`, `test/e2e/new-session.spec.ts`,
  `test/e2e/session-view.spec.ts`.
