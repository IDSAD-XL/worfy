# 24 — Свои Session-ы worfy: один Node до первого хода и верные подписи

Type: task
Status: blocked — blocked by 06, 07, 08, 09, 22, 23
Blocked by: 06, 07, 08, 09, 22, 23
Source: [spec.md](../spec.md), тема C; ручные проверки 2026-10-06, ночь — Ticket-ы 14 и 33 worfy-mvp (`.scratch/worfy-mvp/issues/14-внешние-сессии-только-чтение.md:146`, `.scratch/worfy-mvp/issues/33-session-view-транскрипт-и-ввод.md:182`); HANDOFF, «Риски и долги»

## Что делаем

Session, которую запустил сам worfy, местами выглядит как чужая: как Session из терминала или как
Orchestrator.

**1. Второй Node до первого хода.** До первого хода Session worfy видна на Canvas второй раз —
read-only Node «terminal» с id из реестра. Реестр — файлы `~/.claude/sessions/<pid>.json` живых
процессов Claude Code. У Orchestrator-а нового Project-а дубль появляется сразу при добавлении
Project-а. Пока в Session не отправлено сообщение, дубль не исчезает.

Причина: Session держит временный id `pending-…` до `system/init`
(`src/main/agent/session.ts:234`). А Claude Code пишет настоящий sessionId в реестр сразу при
старте, с `entrypoint: "sdk-ts"`. `worfySessionIds` и `planSessionNodes`
(`src/renderer/claude-home/session-nodes.ts:71` и `:126`) этот id ещё не знают и создают внешний
Node.

Первый шаг — выбрать, как worfy узнаёт настоящий id до `system/init`:

- (а) worfy сам задаёт id новой Session при старте. В типах SDK есть опция `sessionId` («Use a
  specific session ID for the conversation»); тогда у новой Session нет `pending-…`;
- (б) main находит в реестре запись своего процесса Claude Code и сообщает id раньше `system/init`.

Если меняется то, когда Node узнаёт id Session
([ADR-0010](../../../docs/adr/0010-orchestrator-state-session-id-and-cost-only.md)), — ADR. Выбор —
в «Итог».

fake-агент сейчас сам выбирает id Session (`src/main/agent/fake-query.ts:197`) и реестр не пишет.
Чтобы e2e воспроизвёл дефект, fake-агент, как настоящий Claude Code, пишет запись реестра во
временный `WORFY_CLAUDE_HOME` раньше `system/init`. В варианте (а) он берёт id из опции `sessionId`.

**2. Подписи в sidebar.** Sidebar «Sessions» подписывает Session-ы worfy «terminal» и автоименем
реестра (`src/renderer/shell/sidebar/SessionsSection.tsx:96` и `:110`). Внешний Node подписывается
по тому же правилу (`session-nodes.ts:119`). Правка: Session worfy — та, чей id есть в
`worfySessionIds` (`session-nodes.ts:71`), — подписана «worfy» и тем же именем, что на её Node-е.
Остальные Session-ы подписаны по `entrypoint`, как сейчас: `claude-desktop` — «desktop», остальное —
«terminal». Признак «`entrypoint` начинается с `sdk`» для «worfy» не годится: так же пишет любая
программа на Agent SDK.

Пока Session worfy ждёт разрешения, строка sidebar показывает «live»: в реестре у неё статус
`unknown` (`session-nodes.ts:60-66`). У своей Session sidebar показывает то же состояние, что её
Node.

**3. «orch» у обычной Session.** Ответы любой Session в Session view подписаны «orch»:
`assistantLabel="orch"` (`src/renderer/session/SessionView.tsx:191`). «orch» остаётся только у
Orchestrator-а. У остальных Session — «claude», как у read-only Session
(`src/renderer/session/ExternalSessionPanel.tsx:95`).

## Готово, когда

- [ ] До и после первого хода «New session» на Canvas ровно один Node этой Session: e2e, fake-агент пишет запись реестра раньше `system/init`.
- [ ] Добавление нового Project-а даёт один Node Orchestrator-а, без read-only дубля: тот же e2e.
- [ ] Sidebar подписывает Session worfy «worfy» и её именем на Node-е; Session из реестра с `entrypoint: "sdk-ts"`, которую worfy не запускал, — не «worfy»; Session терминала — «terminal», Claude desktop — «desktop». Unit-test правила и e2e строк sidebar.
- [ ] Session worfy, которая ждёт разрешения, в sidebar показана с тем же состоянием, что на её Node-е, а не «live»: e2e с fake-сценарием запроса разрешения.
- [ ] В Session view обычной Session ответы подписаны «claude», у Orchestrator-а — «orch»: e2e.
- [ ] Снимки sidebar и Session view в светлой и тёмной теме сверены с F-SPEC.

## Тесты

- `test/e2e/own-sessions.spec.ts` (новый) — один Node до и после первого хода, Orchestrator нового Project-а, подписи sidebar и Session view.
- `test/unit/session-nodes.test.tsx` — правило подписи; запись реестра с id своей Session не даёт внешнего Node-а.
- `test/contract/agent-session.test.ts` — id новой Session известен до `system/init` (по выбранному варианту).
- Сначала падающий test: e2e до первого хода находит два Node-а одной Session.

## Где в коде

Список покрывает оба варианта пункта 1. После выбора лишнее убирается.

- `src/main/agent/session.ts`
- `src/main/agent/fake-query.ts`
- `src/main/agent/options.ts` (только вариант (а))
- `src/main/claude-home/registry.ts` (только вариант (б))
- `src/renderer/claude-home/session-nodes.ts`
- `src/renderer/shell/sidebar/SessionsSection.tsx`
- `src/renderer/session/SessionView.tsx`
- `test/unit/session-nodes.test.tsx`
- `test/unit/agent-options.test.ts` (только вариант (а))
- `test/contract/agent-session.test.ts`
- `test/e2e/own-sessions.spec.ts` (новый)
