# 76 — Каждый watch chokidar в `src/main` закрывается так, что остаётся закрытым

Type: bug
Status: claimed 2026-10-20T07:22Z
Branch: worfy-windows/76
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

- [x] `closeForGood` — один, в `src/main/chokidar-close.ts`; его используют `workflow/watch.ts`,
      `cards/store.ts` и `claude-home/registry.ts`.
- [x] Unit test helper-а: обе части; mutant без каждой части — красный.
- [x] Source test: зелёный; mutant с голым `close()` в одном месте — красный.
- [x] Handles test Ticket-а 75 зелёный (не меньше 2 прогонов на ПК); test-ы, что трогают изменённые
      файлы, — exit 0.
- [x] `CI=true pnpm lint`, `CI=true pnpm typecheck` — exit 0.

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

**Что сделано.** `closeForGood` перенесён из `src/main/workflow/watch.ts` в
`src/main/chokidar-close.ts` (рядом с `watch-gone.ts` и `link-safe-watch.ts`) вместе с doc comment и
`shortcut:`. Его используют все места, где `src/main` закрывает chokidar: `workflow/watch.ts`
(`unwatch`, `remakeBranches`), `claude-home/registry.ts` (`close` watch-а Claude Home) и
`cards/store.ts`. В `cards/store.ts` map `watchers` держит и `LinkSafeWatch`, поэтому chokidar
кладётся туда как `{ close: () => closeForGood(watcher) }`: строки `forgetRemovedProjects` и
`CardStore.close()` (бывшие 317 и 328) не менялись и закрывают «любой» watch Cards, а для chokidar это
теперь helper. Копий нет. Commit-ы (после rebase на `df73ef5e`, голова #585): `81cc7d80` ticket,
`1031968c` claim, `1442da31` helper и места вызова + unit test helper-а, `78b4b055` source test.

**Test-ы.**
- `test/unit/chokidar-close.test.ts` — настоящий chokidar: после `closeForGood` вызов `add()` (как
  его делает `_remove` chokidar) не открывает fs.watch и `closed` остаётся `true`; `emit('error')` не
  бросает.
- `test/unit/chokidar-close-callers.test.ts` — source test на type checker TypeScript: каждый вызов
  `<x>.close()` в `src/main`, где тип `<x>` — `FSWatcher` chokidar (или union с ним). Разрешён ровно
  один — внутри `closeForGood`; то, что он находится, показывает, что поиск видит chokidar.
  `LinkSafeWatch`, fs.watch Node, file handle и `CardsWatch` — другие типы и не ловятся. Около 2 s.
  Это первая версия; review её расширил (ниже): в ней `cards/store.ts` защищён не был.
- Unit test уровня watcher-а в `test/unit/workflow-branches-gone.test.ts` оставлен (проверяет wiring);
  test поздних `add()` из `df73ef5e` остался там и краснеет без no-op `add` в helper-е.

**Красный-сначала по месту вызова — не дёшево, не сделан.**
- `cards/store.ts`: на Windows watch Cards — `LinkSafeWatch` (`paths.sep === '\\'`), chokidar там только
  на macOS и Linux, а там утечка 75 не воспроизводилась (Mac: 4 из 4 зелёных).
- `claude-home/registry.ts`: опыт на ПК. Обычный chokidar с `depth: 2`, закрытый на первом событии
  `all`, пока дочерний процесс удаляет папку, утёк на первом круге. Но через API registry так не
  закрыть: `onChange` приходит после debounce и асинхронной проверки транскриптов, и за 72 круга (12 и 60)
  (`rmdir /s /q` Claude Home, close на первом `onChange`, `debounceMs: 0`) ни один close не случился
  во время удаления (0 из 5 в отдельном прогоне) и утечки не было. Такой test без правки зелёный, в
  commit не вошёл. Механизм покрыт unit test-ом helper-а, место вызова — source test-ом.

**Mutant-ы** (копия файла, правка, прогон, восстановление; `git diff --quiet` = 0 после каждого на
закоммиченном дереве):
- helper без `watcher.add = () => watcher` → `chokidar-close.test.ts` и test поздних `add()` в
  `workflow-branches-gone.test.ts` красные (exit 1, 2 failed).
- helper без `watcher.on('error', …)` → `chokidar-close.test.ts` красный (exit 1).
- голый `close()` в `registry.ts`, в `cards/store.ts` (`{ close: () => watcher.close() }`) и в
  `workflow/watch.ts` (`unwatch`) → `chokidar-close-callers.test.ts` красный (exit 1), с адресом
  `src/main/workflow/watch.ts:321` в сообщении.

**Review на ПК (lens test-ов): три замечания, исправлены.**
- [med] Source test видел только прямой `<x>.close()`. Mutant review-а — `cards/store.ts` снова кладёт
  watcher в map как есть (`this.watchers.set(projectId, watcher)`, код до этого Ticket-а) — оставлял его
  зелёным, хотя голые close в `forgetRemovedProjects` и `CardStore.close()` вернулись. Теперь test
  ловит и выход chokidar watch-а как значения другого типа: где checker знает ожидаемый тип (аргумент,
  присваивание, переменная с типом, return, свойство object literal), он должен быть `FSWatcher`
  chokidar; исключения — аргумент `closeForGood` и место, что ждёт `void` (значение выброшено). Тот
  mutant — красный (exit 1). Test теперь идёт около 5 s. Утверждение выше про `cards/store.ts` относилось к первой версии test-а.
- [low] Ловятся и `watcher['close']`, и `const { close } = watcher` (а с ними `.close.call(…)`):
  mutant-ы в `registry.ts` с `await watcher['close']()` и с `const { close } = watcher; await
  close.call(watcher)` — красные (exit 1). Не ловится: `as` и `any`, там checker теряет тип.
- [low] Ожидания в `test/unit/chokidar-close.test.ts` умножены на `timeScale`: `waitFor` —
  `2000 * timeScale`, пауза после позднего `add()` — `200 * timeScale`.

**Проверка**

| Что | Команда | Результат |
| --- | --- | --- |
| новые unit test-ы | `node scripts/vitest-electron.mjs test/unit/chokidar-close.test.ts test/unit/chokidar-close-callers.test.ts` | exit 0, 3 passed |
| test-ы изменённых файлов (до rebase) | тот же runner: 8 unit (chokidar-close*, cards-watch, gate-state, notify, tickets-chokidar, tickets-watch, workflow-branches-gone) и 21 contract (bindings, card-*, cards-watch-links, claude-home-*, clients, harness-script-*, link-access, linked-shared-subscriptions, workflow-*); временные HOME и USERPROFILE | exit 0; 28 files passed, 1 skipped; 709 passed, 24 skipped |
| после rebase на `df73ef5e` | workflow-branches-gone, chokidar-close, chokidar-close-callers, cards-watch (unit) | exit 0, 33 passed |
| handles test Ticket-а 75 | `test/contract/workflow-branches-handles.test.ts` × 2 | exit 0 × 2, 42 s и 42 s |
| lint | `CI=true pnpm lint` | exit 0 |
| typecheck | `CI=true pnpm typecheck` | exit 0 |

Не сделано: прогон на Mac.
