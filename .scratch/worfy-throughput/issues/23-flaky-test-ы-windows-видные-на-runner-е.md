# 23 — Flaky test-ы Windows, которые краснеют на GitHub runner-е: `claude-home-registry`, `link-access`, `workflow-reader`, `workflow-branches-handles`

Type: task
Status: open
Blocked by: 20
Source: [spec.md](../spec.md), раздел «Решения владельца 2026-10-28: процесс», предложение 1 и правка
`worfy-polish` 41; разбор run-ов «Windows tests» с
2026-10-18 (156 run-ов, 41 красный); run 39918292362 (полный run на main 2026-10-23, единственный красный —
`workflow-branches-handles`).

## Что происходит

- `test/contract/claude-home-registry.test.ts` — «watching the Claude home» и «claudeHome IPC channels»: 7
  test-ов красные в 3 run-ах («no matching change yet», пустой список событий) — время watcher-а на Windows.
- `test/contract/link-access.test.ts` — «read-only access» и «switching access off»: 3 run-а, вывод PowerShell
  приходит не в том порядке (ConPTY).
- `test/contract/workflow-reader.test.ts` — 682 Ticket-а за 597 ms при границе на Windows (`:1647`, `:1682`).
- `test/contract/workflow-branches-handles.test.ts:49`, `:94` — `cmd.exe /d /c rmdir /s /q`: «being used by
  another process».
- Два последних сейчас в `worfy-polish` 41 (нужен ПК); на runner-е они видны тоже, поэтому переходят сюда.

Правка 2026-10-28 (решение 0 spec-а, «Переходим на CI раннеры»): Windows job `full` входит в `ci-ok` каждого PR (Ticket 35), поэтому
эти flaky test-ы теперь краснят merge любого PR, а не только платформенного.

## Что делаем

1. Для каждого файла — 3 run-а `windows-tests.yml` в режиме `files` на ветке с меткой карантина, снятой на этот
   файл (`WORFY_QUARANTINE=run`): сколько раз красный.
2. Причина и правка причины: ожидание события watcher-а по условию, а не по часам; порядок вывода — ждать
   маркер, а не позицию; предел времени `workflow-reader` — мерить время своей работы (CPU), а не стены, если
   test проверяет скорость кода; `rmdir` — найти, кто держит handle, и дождаться его закрытия в коде.
3. Снять записи карантина починенных test-ов. Timeout-ы и пороги test-ов не поднимать.

Нужен ПК: нет — проверка на Windows-runner-е, режим `files` (dispatch). Трогает Harness: нет. Вердикт Windows:
runner `full` — run на PR (после Ticket-а 24 — автоматический, до него — dispatch Orchestrator-а).

## Готово, когда

- [ ] «Итог»: на каждый test — красных до правки, причина, правка, ссылки на run-ы.
- [ ] После правки — 3 run-а `files` на четыре файла подряд зелёные; ссылки и коды — в «Итог».
- [ ] Записей карантина этого Ticket-а не осталось; timeout-ы и пороги не изменены.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` на Mac — exit 0; вердикт Windows — runner `full` на head; условие
      merge — `ci-ok` (Ticket 35; до него — gate full Orchestrator-а).

Run-ы: около 6–8 run-ов `files` и один `full`. Денег они не стоят: репозиторий публичный с 2026-10-27, и
GitHub-hosted runner-ы для него бесплатны. Dispatch по-прежнему запускает Session Orchestrator-а на Mac (правило
Profile-а), не implementer.

## Где в коде

- `test/contract/claude-home-registry.test.ts`, `test/contract/link-access.test.ts`,
  `test/contract/workflow-reader.test.ts`, `test/contract/workflow-branches-handles.test.ts`
- `test/quarantine/` — их записи
- `src/main/claude-home/registry.ts`, `src/main/link-*` — по найденной причине (дописать при claim)

## Вне скоупа

- `test/contract/terminal.test.ts` на ПК — `worfy-polish` 41.
- `image-protocol.test.ts` (`RUNNER~1`) — чинится отдельно.

## Итог
