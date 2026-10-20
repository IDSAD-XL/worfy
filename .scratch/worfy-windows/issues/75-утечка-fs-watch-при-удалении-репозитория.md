# 75 — Утечка handle-а fs.watch, когда другой процесс удаляет репозиторий Project-а

Type: bug
Status: claimed 2026-10-20T06:19Z
Branch: worfy-windows/75
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
  старта, вокруг цикла из N удалений и пересозданий; удаление — из дочернего процесса. Test — в своём
  файле (`test/contract/workflow-branches-handles.test.ts`) и останавливается на первом круге с
  утечкой: vitest запускает каждый test-файл в своём процессе, так что утёкший handle не крутится под
  другими test-ами. Сценарий в дочернем процессе не сделан: дочерний процесс не загрузит
  `watch.ts` без сборки TS.
- Mac прогоняет красный test на macOS: течёт ли FSEvents так же. Доля красных прогонов — по каждой
  системе в «Итог».

## Готово, когда

- [x] Красный test (commit без правки): на ПК красный 5 из 5 прогонов; время прогона названо.
- [x] Тот же test на Mac: доля красных прогонов записана (macOS может не течь — тогда test там зелёный
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
- Другие обычные `close()` chokidar, которые могут так же открыть watch заново после close:
  `src/main/cards/store.ts:317`, `src/main/cards/store.ts:328`, `src/main/claude-home/registry.ts:926`.
  Здесь не менялись; кандидаты на отдельный ticket с тем же `closeForGood`.

## Итог

**Причина (подтверждена на ПК).** Утечку даёт сам chokidar 5.0.0: закрытый watcher открывает watch
заново. Listener файла (`handler.js:378`) делает `await stat(file)`; если файл уже удалён и между
событием и ответом stat worfy закрыл watcher, catch вызывает `_remove`, а тот — `this.add(directory,
item, true)` (`index.js:723`, ветка «единственный файл удалён»). `add()` ставит `closed = false` и
идёт вверх до ближайшей живой папки: `refs/heads` → `refs` → `.git`. Этот fs.watch на `repo/.git`
уже никто не закрывает: worfy свой `close()` уже вызвал. Диагностика: обёртка над `watch` из
chokidar в одноразовом test-файле (не в commit) записывала каждый `add()` после `close()` со stack
и каждый closer fs.watch, который так и не вызвали. Во всех трёх прогонах с утечкой: `close` второго
branches watch-а (того, что сделан заново после `git worktree remove`), через 0–2 ms —
`ADD-AFTER-CLOSE` из `_remove` (`index.js:723` ← `handler.js:378`), потом второй круг `add()`
(`index.js:376`) на `refs` и `.git`, и незакрытый closer на `repo/.git`. Watch закрывали уже
после `ready`, так что «close во время настройки» из первого диагноза — не причина. Строка
`handler.js:594-596` из описания выше тоже не причина: `closed` там уже снова `false`.

**Правка — вариант (d)** (`src/main/workflow/watch.ts`, commit `f2790d72`). Все chokidar watch-и
`WorkflowWatcher` закрываются через `closeForGood`: сначала `watcher.add = () => watcher`, потом
`close()`. Поздний `add()` ничего не открывает, `closed` остаётся `true`, и обходы, ещё идущие в
этот момент, останавливаются на своих проверках `closed`. Второе: `close()` снимает все listener-ы,
а обход, начатый до close, при удалении папки получает EPERM от `realpath` и делает `emit('error')`
без listener-а — EventEmitter бросает, и это стало unhandled rejection (vitest exit 1 при зелёном
test, 2 из 7 прогонов с первой половиной правки). Поэтому после `close()` вешается пустой listener
`error`. Комментарий `shortcut:` в коде: правка закрывает только повторный `add()`; при обновлении
chokidar проверить, не открывает ли он watch после close другим путём.

**Почему не другие варианты.**
- (a) не закрывать до `ready`: watch с утечкой был закрыт уже после своего `ready` (в логе
  `ready=true` у каждого `close`), так что ожидание `ready` ничего не меняет.
- (b) debounce/coalesce пересоздания: уменьшает число close, но не убирает гонку `stat` против
  `close` — listener файла может получить событие в любой момент до close; вероятность меньше, но
  не ноль, а детерминированного признака нет.
- (c) свои fs.watch вместо chokidar для веток: много нового кода (отсутствующие `packed-refs` и
  `worktrees`, подъём к ближайшей живой папке, фильтр `ignored`) ради того, что закрывает одна
  строка.
- (d), другой путь: `ignored`, который после close отвечает «игнорировать всё»: публичный API, но `add()` всё
  равно ставит `closed = false`, и обход, прошедший проверку `ignored` до close, после этого открывает
  watch. Гонка остаётся.
- pnpm patch chokidar и правка `node_modules` — запрещены постановкой задачи.

**Доля красных прогонов** (`test/contract/workflow-branches-handles.test.ts`, 16 кругов):
- ПК до правки: красный 5 из 5 (утечка на кругах 7, 6, 1, 2, 1; 5–21 s на прогон).
- ПК после правки: зелёный 7 из 7, exit 0, 42–45 s на прогон.
- Mac до правки: зелёный 4 из 4 (около 29 s), FSEvents. После правки на Mac — не прогнан.
- Mutant (удалена только строка `watcher.add = () => watcher`): красный 2 из 2, утечка на кругах
  2 и 1; файл восстановлен из копии, `cmp` совпал.

**Проверка**

| Что | Команда | Результат |
| --- | --- | --- |
| test утечки, ПК, после правки | `node scripts/vitest-electron.mjs test/contract/workflow-branches-handles.test.ts` × 7 | exit 0 × 7, 1 passed, 42–45 s |
| mutant без `add`-no-op | тот же файл × 2 | exit 1 × 2 |
| остальные test-ы watch.ts | `node scripts/vitest-electron.mjs` unit: workflow-branches-gone, notify, tickets-chokidar, tickets-watch; contract: workflow-branches-gone, harness-script-env, harness-script-wiring, workflow-profile, workflow-reader, workflow-stages, workflow-watch-links, workflow-watch-retry | exit 0; 11 files passed, 1 skipped (по платформе); 293 passed, 23 skipped |
| lint | `CI=true pnpm lint` | exit 0 |
| typecheck | `CI=true pnpm typecheck` | exit 0 |

**Review на ПК: три замечания к test-ам, исправлены.**
- [med] Пустой listener `error` после close покрыт детерминированно: unit test в
  `test/unit/workflow-branches-gone.test.ts` (stand-in снимает listener-ы при close, как chokidar,
  и шлёт `error` каждому закрытому watch-у). Mutant без этой строки — красный (exit 1), с ней — exit 0.
- [med] Лимит времени handles test-а теперь `ROUNDS * 6_000 * timeScale`: множитель вынесен из
  `vitest.config.ts` в `test/time-scale.ts` и общий для config и test-а (на Windows 288 s).
  Повтор: exit 0 × 3, 41–46 s; mutant без `watcher.add = () => watcher` — exit 1 (утечка на круге 1).
- [low] В каждом круге до close() test требует `fsWatches() > before`: без открытых watch-ей test
  больше не проходит впустую. Ограничение: это счёт всех fs.watch Project-а (и watch Tickets root),
  а не одного watch-а веток.

Не сделано в этом шаге: прогон на Mac после правки; пункт про
`test/contract/workflow-branches-gone.test.ts` с удалением из дочернего процесса (10 из 10).
