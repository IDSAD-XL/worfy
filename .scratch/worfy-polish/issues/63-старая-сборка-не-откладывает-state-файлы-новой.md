# 63 — Старая сборка не откладывает state-файлы новой

Type: bug
Status: open
Blocked by: —
Source: решение владельца 2026-11-07, оценка идей PR #1580 (идеи 9 и 10). Строки перечитаны по main `14d18997e`.

## Что происходит

- На Mac владельца в `~/Library/Application Support/worfy/` лежат `limits.json.unreadable-2026-10-21T11-08-42-542Z`
  и `link/settings.json.unreadable-2026-10-21T11-08-42-605Z`, и та же пара с временем `2026-10-30T05-22-53`.
- Более старая сборка не смогла прочитать файлы, которые написала более новая, и отложила их. State-файлы читаются
  строгими zod-схемами: ключи, которых схема не знает, отбрасываются, а файл вне схемы переименовывается в
  `<name>.unreadable-<time>`, и сборка начинает с пустого состояния (`src/main/storage/json-file.ts:8-10`,
  `readJsonFile` — `:50`).
- Отложенные `link/settings.json` — версии 2 (`machines` с уровнем доступа каждой Linked machine, с PR #399
  2026-10-16). Сборка, которая знает только версию 1, такой файл не читает: схема — `discriminatedUnion` по `version`
  из версий 1 и 2 (`src/main/link/settings.ts:26`, `:33`, `:42`). Итог — настройки доступа Linked machine потеряны.
- Roll back (Settings → General → Updates, `docs/features/updates.md:149-158`,
  [ADR-0089](../../../docs/adr/0089-update-builds-main-in-own-clone.md)) запускает предыдущую копию на тех же файлах.
  Значит, это теперь повторяется на каждом откате, а не только при случайном запуске старой копии.
- Неизвестные ключи сохраняет только `getting-started.json`: его схема — `z.looseObject`
  (`src/main/getting-started/state.ts:38`, `docs/features/storage-and-diagnostics.md:78-80`). `limits.json` уже читает
  мягко одно новое поле — `source` (`src/shared/agent/limits.ts:42`, `.catch('sdk')`), но не неизвестные ключи и не
  чужие значения других полей.

## Что делаем

1. Старая сборка читает файл новой без потерь: неизвестные ключи и поля сохраняются при чтении и не пропадают при
   следующей записи. Файл не откладывается только потому, что в нём есть то, чего сборка не знает. Файл, который не
   разбирается как JSON, по-прежнему откладывается.
2. `version` новее, чем знает сборка, — не повод считать файл нечитаемым. Варианты для implementer-а — выбрать и
   обосновать в «Итог»: читать знакомую часть и не переписывать файл старой версией; или работать с настройками по
   умолчанию, не трогая файл; или другое правило. Неприемлемо: отложить файл или переписать его так, что новая сборка
   после возврата теряет свои данные.
3. Покрыть как минимум `link/settings.json` и `limits.json`. Остальные store поверх `readJsonFile` — пройти списком и
   записать в «Итог», какие правило получили, а какие нет и почему.
4. Обновить Feature page `docs/features/storage-and-diagnostics.md` (пункт «A read gives the parsed value») и её
   перевод `docs/features/ru/storage-and-diagnostics.md`.

Глубина review — `medium`. Не платформенный: правка в разборе JSON, без путей и процессов ОС.

## Готово, когда

- [ ] Test: файлы, записанные новой схемой (неизвестные ключи, новые поля, `version` новее известной), читает старая
      схема — ничего не потеряно и не отложено, следующая запись старой сборкой оставляет данные новой. Как минимум
      link settings и limits. До правки — красный.
- [ ] Старая сборка сохраняет неизвестные ключи и поля, а не откладывает файл; файл не-JSON откладывается, как раньше.
- [ ] Поведение при `version` новее известной выбрано и обосновано в «Итог».
- [ ] `docs/features/storage-and-diagnostics.md` и перевод говорят то, что делает код.
- [ ] Все unit и contract test-ы `src/main/storage/`, `src/main/link/`, `src/main/agent/limits.ts`, `pnpm typecheck`,
      `pnpm lint`, gate fast — exit 0.

## Где в коде

- `src/main/storage/json-file.ts:8-10`, `:50` — `readJsonFile` и откладывание файла.
- `src/main/link/settings.ts:26-42` — схемы версий 1 и 2.
- `src/shared/agent/limits.ts:42`, `:47` — `limitsStateSchema`; `src/main/agent/limits.ts:92` — чтение.
- `src/main/getting-started/state.ts:38` — единственная loose-схема.
- `docs/features/storage-and-diagnostics.md:78-80`, `docs/features/ru/storage-and-diagnostics.md`.
