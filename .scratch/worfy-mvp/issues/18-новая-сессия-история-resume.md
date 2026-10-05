# 18 — Сессии из worfy: новая Сессия — новый Узел, история Проекта, Resume завершённой

Type: task
Status: claimed — 2026-10-05
Blocked by: 14
Source: [CONTEXT.md](../../../CONTEXT.md), термин «Сессия»; [spec.md](../spec.md), этап 3

## Что делаем

- «New session» в разделе «Sessions» sidebar и в контекстном меню Холста создаёт живой Узел
  Сессии в корне Проекта (движок из 07, тот же `SessionNode.tsx` из 14, теперь с полем ввода).
  Один разговор — один Узел: начать новый разговор значит создать новый Узел, старый остаётся.
- У Оркестратора «New conversation» в меню Узла: текущая Сессия уходит в историю, новая
  становится Оркестратором Проекта.
- История: `HistoryPopover.tsx` — все Сессии Проекта из реестра (тикет 13): заголовок, источник,
  время, ветка. «Show» кладёт Узел только для чтения. «Resume» продолжает Сессию в worfy
  (`resume: sessionId`) и делает Узел живым. `cwd` при Resume — записанный `cwd` Сессии (из
  реестра или транскрипта, тикет 13), а не корень Проекта: Сессия из worktree продолжается в том
  же worktree, иначе Claude Code не найдёт её транскрипт. Папки больше нет — Resume неактивен с
  подписью «Folder no longer exists».
- `src/main/agent/resume.ts` — правило: Resume только для завершённой Сессии. Сессия, у которой
  есть живой процесс в реестре (терминал, Claude desktop), не продолжается — кнопка неактивна с
  подписью «Still running in terminal». Иначе два процесса писали бы один транскрипт.
- Закрыть живой Узел (`agent.close`) можно только в `idle`; занятую — после «Interrupt».

## Готово, когда

- [x] «New session» создаёт новый живой Узел; две Сессии работают параллельно (fake-агент).
- [x] «New conversation» у Оркестратора: старая Сессия видна в истории, новая закреплена как Оркестратор.
- [x] Resume завершённой внешней Сессии делает её Узел живым, и новый ход дописывается в тот же транскрипт (fixture + fake-агент проверяет `resume` в опциях).
- [x] Resume Сессии с живым процессом недоступен, подпись объясняет почему.
- [x] Resume Сессии, начатой в `.claude/worktrees/07`, запускается с этим `cwd` (fake-агент записывает опции); Сессия из удалённого worktree — Resume неактивен.
- [ ] Ручной прогон: Сессия, начатая `claude` в терминале и закрытая, продолжается в worfy; снимок в «Итог».

## Тесты

- `test/unit/resume-rule.test.ts` — живой процесс, завершённая, неизвестная Сессия, `cwd` из записи, удалённая папка (новый).
- `test/e2e/new-session.spec.ts` — новая Сессия, история, Resume, запрет Resume (новый).
- Сначала падающий test: `resume-rule.test.ts` на Сессию с живым `pid`.

## Где в коде

- `src/renderer/canvas/nodes/SessionNode.tsx` (живой режим)
- `src/renderer/session/HistoryPopover.tsx`
- `src/renderer/shell/sidebar/SessionsSection.tsx` (кнопка «New session»)
- `src/main/agent/resume.ts`

## Итог

**Сделано.**

- «New session» — кнопка в заголовке раздела «Sessions» sidebar (`SessionsSection.tsx`). main
  ставит новый Узел вида `session` (340 × 220, место — `placeNewNode`, как у Оркестратора) и
  запускает в корне Проекта новую Сессию; Холст центрируется на Узле. Каждое нажатие — новый Узел
  и новая Сессия, старые остаются.
- Живой режим `SessionNode.tsx`: заголовок (из истории, иначе «New session»), статус Сессии,
  строка «worfy · <cwd>», последний ответ Сессии, поле ввода; кнопки Interrupt (во время хода),
  Close (только в `idle`, во время хода неактивна с подсказкой), Resume (у остановленной Сессии),
  Hide, Remove (неактивна, пока Сессия идёт). Сообщение остановленному Узлу сначала продолжает его
  Сессию. Двойной щелчок — Session view этой Сессии (`SessionView.tsx`: заголовок «Session»
  вместо «Orchestrator», стоимость «—»). Узел только для чтения из тикета 14 не изменился.
- Сессии Узлов в main — `src/main/agent/node-sessions.ts` (класс `NodeSessions`), канал
  `sessions.*` — `src/shared/ipc/sessions.ts` и `src/main/ipc/sessions.ts`, вид в renderer —
  `src/renderer/session/node-sessions.ts`. Как и Оркестратор, эти Сессии принадлежат приложению,
  а не окну: события идут во все окна, закрываются они вместе с приложением.
- История — `src/renderer/session/HistoryPopover.tsx` (кнопка «History» в разделе «Sessions»):
  все Сессии Проекта из транскриптов — заголовок, источник (terminal / desktop / worfy), время,
  ветка. При открытии история читается заново (`refreshClaudeHome` в `useClaudeHome.ts`), иначе
  Сессии, закончившиеся после запуска приложения, в ней не появлялись. «Show» кладёт Узел только
  для чтения (или ведёт к уже существующему), «Resume» — `sessions.resume`.
- Правило Resume — `src/main/agent/resume.ts` (`resumeVerdict`): отказ, если Сессию уже ведёт
  worfy («Already open in worfy»), если у неё живой процесс в реестре («Still running in terminal»,
  для Claude desktop — «Still running in Claude desktop»), если у Проекта нет её транскрипта
  («No transcript of this Session»), если записанной папки больше нет («Folder no longer exists»).
  Иначе `cwd` — записанный в транскрипте (`cwd` первой записи), а не корень Проекта. main
  применяет правило и при `sessions.resume`/`sessions.start`, а не только для подписи кнопки.
- Resume Узла только для чтения превращает его в живой на месте: тот же id `session:<id>`, то же
  место, размер не меньше живого. Иначе Resume ставит новый Узел.
- «New conversation» у Оркестратора — кнопка в заголовке его Узла и канал
  `orchestrator.newConversation`: текущая Сессия закрывается (её транскрипт остаётся в истории),
  `sessionId` и `costUsd` в `data` обнуляются, новая Сессия становится Оркестратором. Во время хода
  — отказ.
- `agent.close` во время хода отказывает («Interrupt it before closing»); закрытие вместе с окном
  или приложением не затронуто (оно идёт мимо обработчика). То же правило — `closeRefusal` в
  `resume.ts` — у `sessions.close` и «New conversation».
- В записи истории (`historySessionSchema`) добавлено поле `entrypoint` — из первой записи
  транскрипта, для колонки «источник».

**Сначала падающий test.** `test/unit/resume-rule.test.ts` (Сессия с живым `pid` и остальные
случаи правила) упал на импорте: «Failed to resolve import "../../src/shared/ipc/sessions"» —
модулей `sessions.ts` и `resume.ts` ещё не было; после реализации 9 из 9 зелёные.

**Неочевидные решения.**

- `data` живого Узла Сессии — только `{ origin: 'worfy', sessionId }`, `sessionId` появляется после
  первого `system/init` (ADR-0010: в Раскладке у Узлов Сессий только идентификаторы). Модель,
  `cwd`, состояние — в памяти main (вид Узла, `sessions.changed`) и в транскрипте. После
  перезапуска приложения Узел показывает «finished» и предлагает Resume; `cwd` берётся из
  транскрипта.
- Новая Сессия до первого сообщения не имеет SDK id (Claude Code сообщает его в `system/init`
  первого хода), поэтому в `data` нового Узла только `origin`. Опция SDK `sessionId` (задать id
  заранее) не использована: она требует правки `session.ts`, который параллельно меняет тикет 19.
- Сессии Узлов, как Оркестратор, принадлежат приложению, а не окну, — чтобы вид Узла пережил
  перезагрузку окна. Сессии `agent.start` (окна) не тронуты.
- Remove у живого Узла неактивна: иначе Сессия шла бы без Узла.

**Правки вне следа тикета** (без них «Готово, когда» не выполнить): новые `src/shared/ipc/sessions.ts`,
`src/main/ipc/sessions.ts`, `src/main/agent/node-sessions.ts`, `src/renderer/session/node-sessions.ts`;
`src/main/agent/orchestrator.ts`, `src/shared/ipc/orchestrator.ts`, `src/main/ipc/orchestrator.ts`,
`src/renderer/canvas/nodes/OrchestratorNode.tsx` («New conversation»); `src/main/ipc/agent.ts`
(отказ `agent.close` во время хода); `src/main/agent/app-orchestrators.ts` (экспорт `toEveryWindow`);
`src/renderer/claude-home/session-nodes.ts` (схема `data` живого Узла, операция «Show»);
`src/renderer/claude-home/useClaudeHome.ts` (`refreshClaudeHome`); `src/renderer/session/SessionView.tsx`;
`src/shared/ipc/claude-home.ts` и `src/main/claude-home/registry.ts` (поле `entrypoint`).

**Тесты.** `test/unit/resume-rule.test.ts` (правило); `test/contract/node-sessions.test.ts` —
New session, две Сессии параллельно, Resume Узла только для чтения в `cwd` worktree, отказы,
перезапуск, Close во время хода, `agent.close` во время хода, «New conversation», каналы
`sessions.*` (отказ на неверном типе и на id с `/`, вырезание лишних ключей входа и ответа);
`test/contract/claude-home-registry.test.ts` — `entrypoint`; `test/e2e/new-session.spec.ts` —
весь сценарий в собранном приложении на fake-агенте, в конце — проверка, что под
`WORFY_CLAUDE_HOME` worfy ничего не записал. Fake-агент отвечает `system/init` с тем
`session_id` и `cwd`, с которыми его запустили (`{{session}}` — это `resume`), поэтому совпадение
id и `cwd` Узла после хода подтверждает, что в опции ушли `resume` и записанный `cwd`. Два мутанта
(`cwd` корня вместо записанного; пропуск проверки живого процесса) — красные.

**Проверки.** `pnpm lint && pnpm typecheck && pnpm test` — код 0 (839 test-ов);
`gate.sh fast` — код 0, «[gate] зелено (fast)» (первый прогон — код 2: test
`limits.test.ts › is followed while watched` не дождался события файловой системы за 10 с; тикет
его не трогает, отдельно и при повторе он зелёный); `pnpm test:e2e` — код 0, 41 passed.
Первые два CI run-а PR красные на `new-session.spec.ts`: на меньшем экране runner-а заголовок
первого Узла уходил под toolbar, а Узел Оркестратора — за край Холста (Холст рисует только видимые
Узлы). Test теперь двигает Холст колесом, пока кнопка «New conversation» не окажется внутри
Холста, и шлёт щелчок Close самому элементу; локально зелёный при окне 800 × 600, 1024 × 640,
1280 × 720 и 1400 × 900.

**Не сделано / не проверено.**

- «New session» в контекстном меню Холста: на `origin/main` контекстного меню Холста нет — его
  заводит тикет 27 (`CanvasMenu.tsx`, PR #17 не влит). Сейчас «New session» только в sidebar;
  пункт меню — после 27.
- «Новый ход дописывается в тот же транскрипт»: fake-агент транскриптов не пишет; проверено, что
  Сессия продолжается под тем же id и в том же `cwd`, то есть настоящий Claude Code открыл бы тот
  же файл.
- не проверено: ручной прогон «Сессия, начатая `claude` в терминале и закрытая, продолжается в
  worfy» — настоящий `claude` пишет в `~/.claude`, а `~/.claude` в этой работе только для чтения;
  снимка нет. Пункт «Готово, когда» оставлен открытым.
- Двойной щелчок по остановленному живому Узлу открывает транскрипт в режиме только для
  чтения (`ExternalSessionPanel.tsx`) с подписью «started in terminal» — подпись для Сессии worfy
  неточна.

