# 63 — Windows: `workflow.changed` и `pipeline.changed` теряются, потому что main и окно пишут корень Project-а по-разному

Type: bug
Status: claimed 2026-10-18T20:10Z
Branch: worfy-windows/63
Blocked by: —
Source: ревью корректности Ticket-а 57 (ПК владельца, 2026-10-18): находка вне diff-а 57. Тот же
класс дефекта, что 49 и 57: `C:\…` против `C:/…`.

Приоритет — med: на Windows доска Pipeline и обновления workflow не приходят в окно, пока его не
перезагрузить.

## Что происходит (гипотеза, не проверена на Windows)

- **main шлёт корень после `resolve`.** `src/main/workflow/reader.ts:458` делает `resolve(options.root)`,
  на Windows это `C:\…`; дельта `workflow.changed` несёт этот `root`.
- **Окно ищет по строке из списка Project-ов.** `src/renderer/workflow/useWorkflow.ts:60` —
  `users.has(delta.root)`; список хранит корень так, как печатает git: `C:/…`. Строки не совпадают,
  дельта отбрасывается.
- **То же, вероятно, у `pipeline.changed`.** `src/main/ipc/pipeline.ts:59` открывает hub по
  `resolve(root)`; `src/renderer/pipeline/usePipeline.ts:32` — `users.has(snapshot.root)`.
- Reviewer 57 подозревает, что это и есть известный отказ test-а link-access «workflow.changed did not
  arrive» на ПК.

## Что делаем

1. Сначала воспроизвести на Windows: test, в котором окно подписано на `C:/…`, а main шлёт дельту по
   `C:\…`. Красный — гипотеза верна.
2. Один способ сравнения корня на обеих сторонах: либо main шлёт корень в том написании, в каком его
   прислало окно (как сделано для `claudeHome.changed` в 57), либо окно сравнивает через
   `sameProjectRoot` (`src/shared/paths.ts`, Ticket 49). Выбрать то, что сделал 57, чтобы был один
   приём.
3. Тот же test для `pipeline.changed`.

Пересечение: PR #501 (worfy-pipeline 06) меняет `StageHub.open/close` (`src/main/workflow/stages.ts`)
— брать пункт про `pipeline.changed` после его мержа.

## Критерии готовности

- [x] test на `platform: 'win32'` красный до правки и зелёный после — для обеих дельт.
- [x] Вердикт ПК: test link-access «workflow.changed» на Windows зелёный (или названа другая причина).

## Итог

Session на Windows-ПК, 2026-10-18. Windows 11 Pro 10.0.26200. Ветка `worfy-windows/63` от main `3770da60`,
затем merge main `9157c0a4` (Ticket 57 влит). Worktree `C:/Users/Alexey/worfy-wt/63`. Push не было, PR не
открыт: по брифу — только локальные commit-ы.

**Причина подтверждена.** Hub-ы держат Project под `path.resolve`, и всё, что они отдают, несёт этот корень:
модель и дельты workflow (`src/main/workflow/watch.ts:271`, `reader.ts:458`), снимки Stage-ей
(`src/main/workflow/stages.ts`, ключ hub-а). Handler-ы `workflow.open` и `pipeline.get` пересылали их окну как
есть. Окно ищет корень своей строкой (`src/renderer/workflow/useWorkflow.ts:60`,
`src/renderer/pipeline/usePipeline.ts:32`), а строка у него из списка Project-ов — `C:/…`. На Windows
`resolve` даёт `C:\…`, и окно выбрасывало каждое изменение до перезагрузки.

**Исправление** — тот же приём, что в 57: main по-прежнему держит Project под resolved корнем, но каждому
клиенту отвечает и шлёт изменения с корнем в том написании, в каком клиент его прислал. Окно не менялось.

- `src/main/ipc/workflow.ts`: handler-ы собирает `workflowHandlers({ hub, projects })`, как
  `pipelineHandlers`, — чтобы test мог дать hub-заглушку; default export — те же handler-ы над
  `workflowHub`. `workflow.changed` (`:36`) и ответ `workflow.open` (`:43`) несут корень клиента.
- `src/main/ipc/pipeline.ts`: `pipeline.changed` (`:59`) и ответ `pipeline.get` (`:66`) несут корень клиента.
  Ответ тоже: доска Pipeline-а ключуется по `snapshot.root` (`PipelineBoard.tsx:193`), иначе первый же
  `pipeline.changed` пересоздавал бы её.
- Linked machine идёт через те же handler-ы (`clientOf(event)`) и получает своё написание. У `pipeline.get`
  hub по-прежнему открыт под real path, который ответил `insideProjects`; сигнатура `insideProjects` не менялась.

**Test.** `test/contract/workflow-pipeline-window-root.test.tsx` (jsdom): настоящие handler-ы через
`registerIpc`, hub-заглушки, которые отвечают и шлют с `resolve(root)`, как настоящие; окно — `useWorkflow` и
`usePipeline` через мост. Корень окна `C:/p`: `resolve` пишет его иначе на любой системе, на этом ПК — `C:\p`.
Четыре test-а: окно получает `workflow.changed` и `pipeline.changed`; Linked machine (`link:machine/1`,
настоящая временная папка Project-а в другом написании) получает ответ и изменение со своим корнем.

**Прогоны** (каждый с `test/unit/no-rmsync.test.ts` и `test/unit/e2e-no-spawn-on-load.test.ts`, через
`node scripts/vitest-electron.mjs`):

- Красный на коде main: с `pipeline.ts` main и `workflow.ts` без перезаписи корня — exit 1, 4 из 67 упали:
  `expected [] to deeply equal [ { branch: 'demo/01', … } ]` (дельта workflow выброшена окном) и
  `expected null to be 'gh is unavailable'` (снимок Pipeline-а выброшен). Чистый `workflow.ts` main не
  экспортирует `workflowHandlers`, на нём test падает раньше, на `not a function`.
- Зелёный: exit 0, 67 из 67.
- Мутанты на результате merge, по одному, файл возвращён из копии байт в байт, `git diff --quiet -- src test` —
  0 после каждого: без корня в `workflow.changed`, без корня в ответе `workflow.open`, без корня в
  `pipeline.changed`, без корня в ответе `pipeline.get` — каждый exit 1, 2 test-а своей половины красные.
- Связанные файлы (link-access, workflow-*, pipeline*, harness-script-env, claude-home-registry,
  claude-home-window-root) на merge и на коде main `9157c0a4`: одни и те же 10 падений, новых нет,
  исправленных нет. 3 в `test/contract/link-access.test.ts`, 7 в `test/contract/claude-home-registry.test.ts`
  (watcher Claude home не присылает изменения за отведённое время).
- `pnpm lint`, `pnpm typecheck` — exit 0. Gate не запускался (по брифу).

**Вердикт ПК по link-access «workflow.changed did not arrive»: другая причина, не написание корня.** С
исправлением test падает так же. Корень там — `join(scratch, 'demo')`, уже в написании `resolve`, а сторона A
проверяет только имена каналов. Причина в stand-in-е `epic-status`: test пишет его shell-скриптом
`#!/bin/sh` (`test/contract/link-access.test.ts:116`), а на Windows `harnessScriptCommand` такой скрипт не
запускает (`src/main/workflow/profile.ts:202`, `NOT_NODE`). Модель Project-а — ошибка и до правки файла
Ticket-а, и после; `diffModels` разницы не находит, и дельты нет. Это вывод из кода и из того, что падение
не изменилось; отдельной проверки ошибки модели в этом test-е не было. Два других падения link-access —
терминал: PowerShell падает с «Ошибка 8009001d при загрузке управляемой оболочки», это окружение ПК.

**Вопросы ревьюеру.**

- Hub держит подписчика по id внутри Project-а. Если один клиент откроет один корень в двух написаниях,
  получит изменения только в последнем, а `close` любого из них снимет подписку. В 57 два написания — две
  подписки; здесь так не сделано, чтобы не ломать контракт 06 «закрыть можно любым написанием»
  (`test/contract/workflow-stages.test.ts`, describe «one computation per Project root»). Окно с одним списком
  Project-ов в такое не попадает.
- Ответ `workflow.open`/`pipeline.get` теперь тоже несёт корень клиента, а не resolved. Если где-то в окне
  ждали resolved корень в `model.root` или `snapshot.root`, это изменение поведения; таких мест я не нашёл.
