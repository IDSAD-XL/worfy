# 76 — Каждый watch chokidar в `src/main` закрывается так, что остаётся закрытым

Type: bug
Status: open
Branch: —
Blocked by: —
Source: Ticket [75](75-утечка-fs-watch-при-удалении-репозитория.md), раздел «Вне скоупа», и решение Mac
2026-10-20. Ветка стоит на голове PR #585 (`5b2a0339`, Ticket 75): PR этого Ticket-а — stacked на #585.
Строки — на `5b2a0339`.

## Что происходит

Ticket 75 нашёл, что chokidar 5.0.0 открывает watch заново после `close()`: listener файла
(`handler.js:378`) после неудачного `stat` удалённого файла вызывает `_remove`, тот — `this.add(...)`
(`index.js:723`), а `add()` ставит `closed = false` и смотрит ближайшую живую папку. Этот fs.watch
никто больше не закрывает; на Windows, когда папку удалил другой процесс, он шлёт события без конца
и занимает ядро процессора до выхода worfy. Обход 75 — `closeForGood` в
`src/main/workflow/watch.ts`: перед `close()` метод `add` становится no-op, после `close()` вешается
пустой listener `error` (иначе поздний EPERM от `realpath` — unhandled rejection).

Остальные watch-и chokidar в `src/main` закрываются обычным `close()` и так же могут открыться заново:

- `src/main/cards/store.ts:317` — `forgetRemovedProjects`: Project ушёл из списка, его watch Cards
  закрывается (`Promise.resolve(watcher.close())`).
- `src/main/cards/store.ts:328` — `CardStore.close()`: все watch-и Cards.
- `src/main/claude-home/registry.ts:926` — `close` watch-а папки Claude Home (`await watcher.close()`).

В `cards/store.ts` map `watchers` держит и chokidar, и `LinkSafeWatch` (Windows): обе строки
закрывают «любой» watch Cards, а chokidar там — только при `paths.sep === '/'`.

## Что делаем

Решение Mac (2026-10-20):
- `closeForGood` уходит из `src/main/workflow/watch.ts` в ОДИН общий helper рядом с другими helper-ами
  watch-ей (`src/main/watch-gone.ts`, `src/main/link-safe-watch.ts`): `src/main/chokidar-close.ts`. Doc
  comment и `shortcut:` переходят с ним. Все четыре места используют его; копий нет.
- Test-ы:
  - unit test самого helper-а на настоящем chokidar: поздний `add()` после close ничего не открывает
    и `closed` остаётся `true`; поздний `error` не бросает.
  - красный-сначала по месту вызова, где это дёшево (сценарий удаления как в 75); если не дёшево —
    почему, в «Итог».
  - source test: в `src/main` ни один chokidar `FSWatcher` не закрывается голым `.close()`, только через
    helper. Не ловит `LinkSafeWatch` (обычный fs.watch) и другие `.close()`. Красный на mutant-е,
    который возвращает голый close в одно место.
- `pnpm patch` chokidar и правка `node_modules` — нет.

## Готово, когда

- [ ] `closeForGood` — один, в `src/main/chokidar-close.ts`; его используют `workflow/watch.ts`,
      `cards/store.ts` и `claude-home/registry.ts`.
- [ ] Unit test helper-а: обе части; mutant без каждой части — красный.
- [ ] Source test: зелёный; mutant с голым `close()` в одном месте — красный.
- [ ] Handles test Ticket-а 75 зелёный (не меньше 2 прогонов на ПК); test-ы, что трогают изменённые
      файлы, — exit 0.
- [ ] `CI=true pnpm lint`, `CI=true pnpm typecheck` — exit 0.

## Тесты

- Unit: новый test helper-а; `test/unit/workflow-branches-gone.test.ts`, `test/unit/cards-watch.test.ts`.
- Source test: новый, в `test/unit/`.
- Contract: `test/contract/workflow-branches-handles.test.ts`, test-ы `claude-home-*`, `cards-*`, `card-*`.

## Где в коде

- `src/main/workflow/watch.ts` (`closeForGood`, `unwatch`, `remakeBranches`)
- `src/main/cards/store.ts` (`watchProject`, `forgetRemovedProjects`, `close`)
- `src/main/claude-home/registry.ts` (`watch`)
- новый `src/main/chokidar-close.ts`

## Вне скоупа

- `pnpm patch` chokidar и issue в chokidar (без согласия владельца).
- `LinkSafeWatch` и `watchWithNode` (обычный fs.watch Node): их закрытие chokidar не касается.

## Итог

Заполняется при закрытии.
