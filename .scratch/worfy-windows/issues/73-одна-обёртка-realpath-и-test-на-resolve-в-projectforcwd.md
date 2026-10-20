# 73 — Одна обёртка realpath и test на `resolve()` в `projectForCwd`

Type: task
Status: open
Blocked by: —
Source: ревью PR #562 (Ticket [70](70-написание-пути-вне-среза-3.md)), 2026-10-20 — две находки low; мерж они не
держали (правило глубины ревью владельца 2026-10-12). Номер обещан Session на Windows-ПК. Строки — на main
`a035a9aa`.

Правка уже готова на ПК: ветка `worfy-windows/70-lows`, commit `670fc731` — test в canvas-tools на
`${repo}/../elsewhere`, `real-path.ts` экспортирует `realpathOnDisk`, его берёт `apply.ts`, новый
`test/unit/projects-real-path.test.ts`. #562 влит — PR можно открывать.

## Что происходит

1. **`resolve()` внутри `onDisk` не покрыт test-ом.** `src/main/mcp/canvas-server.ts:372` —
   `const onDisk = (path) => realpathOrSelf(resolve(path))`. Мутант без `resolve()` выжил: путь, которого нет на
   диске, `realpathOrSelf` возвращает как есть, и `..` в нём не сворачивается.
2. **Цепочка realpath повторена.** `src/main/harness/migrate/apply.ts:118` — своя `onDisk`:
   `realpathSync.native`, при ошибке — `realpathSync`, при второй ошибке бросает. Это та же цепочка, что
   `realpathOrSelf` (`src/main/projects/real-path.ts:13`), только строгая: без возврата пути как есть.
3. Вне diff #562: `src/main/link/caller.ts:32` (`real`) и `src/main/ipc/checks.ts:56` (`realOrSelf`) — свои обёртки
   `realpathSync.native` с другими правилами ошибок.

## Что делаем

1. Test: `projectForCwd` получает несуществующую строку `${repo}/../elsewhere` и не находит Project (без
   `resolve()` строка начиналась бы с корня `repo` и нашла бы его).
2. `src/main/projects/real-path.ts` экспортирует строгий вариант `realpathOnDisk` (native, затем обычный realpath,
   ошибка — наружу); `apply.ts` импортирует его вместо своей `onDisk`. Test на него —
   `test/unit/projects-real-path.test.ts`.

## Готово, когда

- [ ] Test на `${repo}/../elsewhere` в test-ах canvas-tools — красный на мутанте без `resolve()`
      (`canvas-server.ts:372`), зелёный на правке.
- [ ] `apply.ts` без своей цепочки realpath: импорт `realpathOnDisk` из `src/main/projects/real-path.ts`;
      `test/unit/projects-real-path.test.ts` проверяет порядок native → обычный и ошибку, когда путь не читается.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full на Mac перед мержем.

## Где в коде

- `src/main/mcp/canvas-server.ts:367-372` (`onDisk`), `projectForCwd`
- `src/main/harness/migrate/apply.ts:111-124` (`onDisk`)
- `src/main/projects/real-path.ts`
- `test/unit/projects-real-path.test.ts` (новый), test-ы canvas-tools

## Вне скоупа

- Обёртки `caller.ts:32` и `checks.ts:56` (пункт 3 «Что происходит»): у них свои правила ошибок; сводить их к
  `real-path.ts` — отдельное решение.

## Итог

Заполняется при закрытии.
