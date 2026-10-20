# 75 — Утечка handle-а fs.watch, когда другой процесс удаляет репозиторий Project-а

Type: bug
Status: open
Blocked by: —
Source: Ticket [62](62-остатки-ревью-2026-10-18-вечер.md), пункт «#493, удаление в том же процессе» (PR #584),
2026-10-20. Test, переписанный по этому пункту, нашёл дефект; решение Mac — отдельный Ticket с обходом в
`src/main/workflow/watch.ts`. Строки — на main `b1ff7661`.

## Что происходит

watch веток (`watchBranches` в `src/main/workflow/watch.ts`) — chokidar 5.0.0 на `.git/refs/heads`,
`.git/packed-refs` и `.git/worktrees`. Когда папка под ним уходит, watch закрывается и делается заново на
тех же путях (worfy-windows 37). Contract test `test/contract/workflow-branches-gone.test.ts` удалял папки
в процессе самого test-а (`execFileSync`, `removeTestTree`): event loop стоял всё удаление, и случай
«другой процесс ещё удаляет `.git`, а новый watch уже настраивается» не прогонялся.

С удалением из дочернего процесса (`git worktree remove`, затем `cmd /c rmdir /s /q` репозитория) на
Windows-ПК test красный не всегда: 2 из 4 прогонов, потом 1 из 4, потом 1 из 10. В красном прогоне
процесс тратит 1172–1781 ms процессорного времени в секунду, и так до конца процесса — все следующие
test-ы файла тоже красные.

Диагноз (обёртка над `fs.watch`, которая пишет каждое открытие и закрытие; в репозиторий не вошла):
третий watch веток открывает `fs.watch` на `repo/.git`, затем на `repo/.git/worktrees`. Событие с полным
путём `.git\worktrees` через 2 ms закрывает этот watch; `close()` chokidar закрывает только `worktrees`.
handle на `repo/.git` не закрывает никто — ни `close()` того watch, ни `WorkflowWatcher.close()`. Он шлёт
около 180 000–270 000 событий в секунду до выхода процесса. В приложении это Project, чей репозиторий
удалил другой процесс (Explorer, `rmdir /s /q`, `git worktree remove`): ядро процессора занято до выхода
worfy.

Что НЕ подтверждено:
- Место в chokidar. Подозрение — `node_modules/chokidar/handler.js:594-596` (`_addToNodeFs`:
  `closer = await this._handleDir(...); if (this.fsw.closed) return;` теряет closer уже созданного
  handle-а) и `index.js:780` (`_addPathCloser` не смотрит `closed`). Но в log `.git` открыт раньше
  `worktrees`, а этот путь так не объясняет.
- Отдельный скрипт только с chokidar (чистый Node v24.21.0; закрытие через k ms, через n тиков, во время
  `rmdir /s /q` в другом процессе, закрытие и пересоздание на событии с полным путём, как в worfy) утечку
  не повторил: 0 открытых `FSEventWrap` после всех `close()`. Не пробовались: Node из Electron, настоящий
  git-репозиторий с удалённым до того worktree, функция `ignored` worfy, два пересоздания до удаления
  репозитория.

## Что делаем

Решение Mac (2026-10-20):
- Обход в своём коде — `src/main/workflow/watch.ts`. Например, смотреть родителя `.git`, или держать
  свой handle и закрывать его самим. `pnpm patch` chokidar — нет. Issue в chokidar — только с согласия
  владельца.
- Если обход окажется невозможным — сначала отчёт с причиной, потом другой путь.
- Сначала красный детерминированный test, отдельным commit-ом без правки: число handle-ов
  `FSEventWrap` (`process.getActiveResourcesInfo()`) после `WorkflowWatcher.close()` вернулось к числу до
  старта, вокруг цикла из N удалений и пересозданий. Сценарий — в дочернем процессе, который test
  запускает и проверяет: так утёкший handle не крутится в процессе test-ов.
- Mac прогоняет красный test на macOS: течёт ли FSEvents так же. Доля красных прогонов — по каждой
  системе в «Итог».

## Готово, когда

- [ ] Красный test (commit без правки): на ПК красный 5 из 5 прогонов; время прогона названо.
- [ ] Тот же test на Mac: доля красных прогонов записана (macOS может не течь — тогда test там зелёный
      и до правки, это нормально; skip не годится).
- [ ] Правка в `src/main/workflow/watch.ts`: test зелёный 5 из 5 на ПК и на Mac; mutant без правки — красный.
- [ ] `test/contract/workflow-branches-gone.test.ts`: удаление из дочернего процесса, «не больше N строк
      log и CPU < 300 ms» — зелёный 10 из 10 на ПК.
- [ ] Mac: `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full — exit 0 и строка
      `[gate] зелено (full)`. ПК: test-файлы PR — exit 0 (needs-mac-gate).

## Тесты

- Contract: `test/contract/workflow-branches-gone.test.ts` и новый test handle-ов рядом с ним.
- Unit: `test/unit/workflow-branches-gone.test.ts` (stand-in chokidar) — если меняется порядок закрытия
  и пересоздания.

## Где в коде

- `src/main/workflow/watch.ts` (`watchBranches`, `remakeBranches`, `unwatch`)
- `test/contract/workflow-branches-gone.test.ts`, новый файл test-а рядом
- `test/unit/workflow-branches-gone.test.ts`

## Вне скоупа

- `pnpm patch` chokidar и issue в chokidar (без согласия владельца).
- watch Tickets root (`link-safe-watch.ts`): в диагнозе его handle закрывался.

## Итог

Заполняется при закрытии.
