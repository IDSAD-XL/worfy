# 98 — e2e: путь Windows вставляется в JSON fixture без экранирования и сравнивается с `/`

Type: task
Status: open
Blocked by: —
Source: направление Session на Mac 2026-10-22, пересчёт красных e2e [Ticket-а 14](14-gate-full-на-windows.md);
замер на ПК 2026-10-22, main `d06d2c2d`, масштаб экрана 150 %.

## Что происходит

Три test-а красные на Windows-ПК. Причина того же рода, что у группы 5 Ticket-а 14 (test ждёт путь в POSIX-виде,
PR #751), но эти места в группу не входили:

- `test/e2e/subagent-tree.spec.ts:224` («a terminal Session with three Subagents…»), проверка `:254`:

  ```
  Locator:  locator('[data-testid="subagent-node"][data-subagent-id="a3000000000000286"]').getByTestId('subagent-kind')
  Expected: "implementer · claude-sonnet-5"
  Received: "implementer"
  ```

- `test/e2e/subagent-tree.spec.ts:440` («a Session that runs a workflow script…»), проверка `:478`:

  ```
  Locator: locator('[data-testid="subagent-node"][data-node-id$="toolu_01S12WORKFLOW1XXXXXXXXX"]')
  Expected: "running"
  Error: element(s) not found
  ```

- `test/e2e/linked-system-actions.spec.ts:175` («in a window of A on a Project of B: "+" picks…»), проверка `:278`:
  `expect(copy.startsWith(`${join(bSetup.dataDir, BETA, 'attachments')}/`)).toBe(true)` — `Expected: true`,
  `Received: false`; следующая строка ждёт `endsWith('/notes-of-a.txt')`.

Вероятная причина — прочитана по коду, запуском не подтверждена:

- `subagent-tree`: `fixture()` (`:84`) и `linesOf()` (`:447-451`, замена — `:449`) заменяют `/Users/test/projects/…` в строках
  JSONL на `projectPath` как есть. На Windows в нём `\`, и строка JSON получает `"cwd":"C:\Users\…"` — неверную
  escape-последовательность. Такие записи читатель транскрипта, вероятно, пропускает: модель subagent-а и Node
  workflow-а не появляются. Та же правка уже есть в `binding` (группа 5: путь в JSON экранированным).
- `linked-system-actions`: ожидание собирает путь копии через `/`, а приложение на Windows отвечает путём с `\`.

## Воспроизведение (ПК, 2026-10-22)

```
pnpm build && pnpm exec playwright test test/e2e/subagent-tree.spec.ts --grep-invert @packaged
pnpm build && pnpm exec playwright test test/e2e/linked-system-actions.spec.ts --grep-invert @packaged
```

Все три красные в полном прогоне `pnpm test:e2e` и при повторе своего файла одного (2 из 2 — стойко).
`subagent-tree.spec.ts`: 2 красных из 6, `linked-system-actions.spec.ts`: 1 из 1.

## Что делаем

1. `subagent-tree`: подставлять путь в JSON экранированным, как `binding` (`repoInJson`, `binding.spec.ts:140`).
2. `linked-system-actions`: сравнивать путь копии через `path.join` / `path.sep`, как группа 5.
3. Найти другие e2e, которые подставляют путь в fixture JSON или ждут путь с `/`
   (`git grep -n "replaceAll('/Users/test" test/e2e`), и записать в «Итог», что найдено и что исправлено.

## Готово, когда

- [ ] На ПК оба spec-а из «Воспроизведения» — код 0.
- [ ] На Mac оба spec-а — код 0.

## Где в коде

- `test/e2e/subagent-tree.spec.ts`
- `test/e2e/linked-system-actions.spec.ts`

## Итог
