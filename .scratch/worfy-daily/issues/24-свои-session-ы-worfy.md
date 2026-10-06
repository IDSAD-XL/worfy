# 24 — Свои Session-ы worfy: один Node до первого хода и верные подписи

Type: task
Status: done — 2026-10-06, [PR #67](https://github.com/IDSAD-XL/worfy/pull/67)
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

- [x] До и после первого хода «New session» на Canvas ровно один Node этой Session: e2e, fake-агент пишет запись реестра раньше `system/init`.
- [x] Добавление нового Project-а даёт один Node Orchestrator-а, без read-only дубля: тот же e2e.
- [x] Sidebar подписывает Session worfy «worfy» и её именем на Node-е; Session из реестра с `entrypoint: "sdk-ts"`, которую worfy не запускал, — не «worfy»; Session терминала — «terminal», Claude desktop — «desktop». Unit-test правила и e2e строк sidebar.
- [x] Session worfy, которая ждёт разрешения, в sidebar показана с тем же состоянием, что на её Node-е, а не «live»: e2e с fake-сценарием запроса разрешения.
- [x] В Session view обычной Session ответы подписаны «claude», у Orchestrator-а — «orch»: e2e.
- [x] Снимки sidebar и Session view в светлой и тёмной теме сверены с F-SPEC.

## Тесты

- `test/e2e/own-sessions.spec.ts` (новый) — один Node до и после первого хода, Orchestrator нового Project-а, подписи sidebar и Session view.
- `test/unit/session-nodes.test.tsx` — правило подписи; запись реестра с id своей Session не даёт внешнего Node-а.
- `test/contract/agent-session.test.ts` — id новой Session известен до `system/init` (по выбранному варианту).
- Сначала падающий test: e2e до первого хода находит два Node-а одной Session.

## Где в коде

Выбран вариант (а); `src/main/claude-home/registry.ts` (вариант (б)) не правился.

- `src/main/agent/session.ts`
- `src/main/agent/fake-query.ts`
- `src/main/agent/options.ts`
- `src/renderer/claude-home/session-nodes.ts`
- `src/renderer/shell/sidebar/SessionsSection.tsx`
- `src/renderer/session/SessionView.tsx`
- `test/unit/session-nodes.test.tsx`
- `test/unit/agent-options.test.ts`
- `test/contract/agent-session.test.ts`
- `test/e2e/own-sessions.spec.ts` (новый)
- Расширение следа (разрешено Orchestrator-ом):
  - `src/main/agent/app-registry.ts` — `sessionId` запроса доходит до `sessionOptions`; флаг `WORFY_AGENT_REGISTRY` для fake-агента.
  - `src/renderer/canvas/nodes/SessionNode.tsx` — имя живого Session Node-а берётся из общего `worfySessionTitle`, тем же, что у sidebar.
  - `test/unit/agent-query-factory.test.ts` — три новых test-а: `sessionId` новой Session доходит до SDK, с `resume` не передаётся, запись реестра fake-агентом только по флагу.
  - `test/contract/orchestrator.test.ts:167`, `:255` и `test/e2e/agent.spec.ts:43` — assertion-ы, закреплявшие временный id `pending-…` и событие `renamed` у новой Session.

## Итог

**Выбор пункта 1 — вариант (а): worfy сам задаёт id новой Session.** Session без `resume`
получает uuid в конструкторе (`src/main/agent/session.ts`) и передаёт его Claude Code опцией SDK
`sessionId`. SDK 0.3.289 превращает её в `--session-id=<id>` (`sdk.mjs`:
`if(this.options.sessionId)B.push("--session-id=" + …)`, в исходнике — шаблонная строка). Claude Code пишет этот id в
`~/.claude/sessions/<pid>.json` при старте, и worfy уже знает запись как свою: `agent.list` отдаёт
тот же id, `worfySessionIds` его содержит, read-only Node не создаётся. Временного `pending-…` и
события `renamed` у новой Session больше нет. Вариант (б) отвергнут: SDK не отдаёт pid процесса
Claude Code, искать свою запись реестра не по чему.

**Где `sessionId` не передаётся.** Проверено по строкам бинарника Claude Code из
`@anthropic-ai/claude-agent-sdk-darwin-arm64@0.3.289` (только чтение, настоящий Claude Code не
запускался):

- `--session-id` вместе с `--resume` или `--continue` — ошибка «--session-id can only be used with
  --continue or --resume if --fork-session is also specified». worfy `continue` и `forkSession`
  не использует. При Resume, при перезапуске worfy (Orchestrator продолжает сохранённую Session) и
  при перезапуске Session после падения, когда id Session в SDK уже известен, передаётся только `resume`.
  Это держат два барьера: Session не задаёт `sessionId` при `resume`, и `sessionOptions`
  (`src/main/agent/options.ts`) отбрасывает `sessionId`, если есть `resume`.
- Id, у которого уже есть транскрипт, Claude Code отвергает: «Session ID <id> is already in use».
  Поэтому, если процесс Claude Code умер до первого хода (id Session в SDK ещё не известен), следующий
  процесс получает новый uuid, а Session переименовывается в него событием `renamed`. Это
  единственный оставшийся случай `renamed` у Session без `resume`.
- Невалидный uuid Claude Code отвергает («Invalid session ID. Must be a valid UUID»): id — `randomUUID()`.

ADR-0010 (в данных Node-а только id Session и стоимость) не затронут: Orchestrator и Session Node
по-прежнему сохраняют id в Layout по `system/init`. Меняется только то, когда id узнаёт main, и
отдельный ADR не заведён (бриф Wave: «ADR не нужен»).

**Кто держался за `renamed` и `pending-…`** (src, grep): `src/renderer/session/store.ts` (переносит
журнал событий со старого id на новый — без переименования журнал сразу под одним id),
`src/main/notify.ts` (переносит заголовок уведомления — то же), `src/main/agent/orchestrator.ts`
и `src/main/agent/node-sessions.ts` (id в Layout пишут по `init`, не по `renamed`),
`src/main/agent/node-sessions.ts:240` (`starting-<nodeId>` — id вида до появления Session, не
связан), `src/main/mcp/canvas-server.ts` (id для правок Card берёт из `init`),
`src/main/autopilot/run.ts` (берёт Session по id из вида Orchestrator-а; id теперь не меняется).
Ни один не держался только на `renamed` новой Session.

**fake-агент и реестр.** fake-агент берёт id из `resume`, иначе из `sessionId`, иначе свой. С
флагом окружения `WORFY_AGENT_REGISTRY=1` (только при `WORFY_AGENT=fake`) он, как Claude Code,
сразу при старте пишет запись `<WORFY_CLAUDE_HOME>/sessions/<n>.json` с `entrypoint: "sdk-ts"` и
удаляет её, когда запрос закрыт или закончился. Без флага ничего не пишет: прочие e2e сверяют,
что worfy не пишет во временный `WORFY_CLAUDE_HOME`. В собранном приложении и при настоящем
агенте эта ветка недостижима: `queryFactoryFromEnv` без `WORFY_AGENT=fake` возвращает настоящий
SDK, а `registryHome` есть только у fake-агента (ADR-0005: worfy не пишет в Claude home).

**Подписи.** Правило — `sessionRow` в `src/renderer/claude-home/session-nodes.ts`. Session, чей id
есть в `worfySessionIds` (Node-ы и виды main: Orchestrator и Session Node-ы этого Project-а), —
«worfy», с именем её Node-а («Orchestrator»; у Session Node-а — `worfySessionTitle`, та же
функция, что рисует заголовок Node-а) и состоянием из вида main (`STATE_CHIPS`, как на Node-е).
Остальные — «desktop» для `claude-desktop`, иначе «terminal», `sdk-ts` не исключение. В Session
view «orch» — только у Orchestrator-а, у остальных — «claude».

**Проверка.** Красный e2e до правки `session.ts`: на Canvas 4 Node-а вместо 2 (дубли Orchestrator-а
и New session), у нового Project-а 2 вместо 1. Мутанты (подписи «orch», состояние из реестра в
sidebar, снятие проверки флага, `sessionId` при `resume`, без нового id после падения, без строки в
`app-registry.ts`) краснеют каждый в своём test-е.

Снимки (fake-агент, `launchApp`), сверены с F-SPEC — компактные строки, прямоугольные chip-ы с
подписью, моноширинные id:
[sidebar, светлая](../evidence/24-sidebar-light.png) · [тёмная](../evidence/24-sidebar-dark.png);
[ожидание разрешения, светлая](../evidence/24-sidebar-permission-light.png) · [тёмная](../evidence/24-sidebar-permission-dark.png);
[Session view обычной Session, светлая](../evidence/24-session-view-light.png) · [тёмная](../evidence/24-session-view-dark.png);
[Session view Orchestrator-а, светлая](../evidence/24-orchestrator-view-light.png) · [тёмная](../evidence/24-orchestrator-view-dark.png).
Наблюдение: chip «needs permission» широкий, и имя «Orchestrator» в строке sidebar обрезается до
«Orc…» многоточием, как любое длинное имя строки.

Не проверено: настоящий Claude Code с `--session-id` (запись в `~/.claude` брифом запрещена) —
что он пишет переданный id в реестр до `system/init`, сделан вывод по строкам бинарника и тексту
тикета; ручной запуск собранного приложения — за владельцем.

Ревью — комментарий VERIFIED в [PR #67](https://github.com/IDSAD-XL/worfy/pull/67):
`sessionId` не уходит вместе с `resume` ни на одном пути старта, процесс, умерший до первого хода,
получает новый uuid. Перед мержем — rebase на `main` и `GATE_SCOPE=all gate full`, код 0.
