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
  - evidence: test-run pass · `pnpm test test/unit/state-files-newer-build.test.ts` exit 0 (exit 1 before the fix on 42372355b, 3 of 5 red) · mac - · 4d221fc8a467ffd657d85084ed76f6d88479c0d4
- [ ] Старая сборка сохраняет неизвестные ключи и поля, а не откладывает файл; файл не-JSON откладывается, как раньше.
  - evidence: test-run pass · `pnpm test test/unit/state-files-newer-build.test.ts test/unit/limits.test.ts test/contract/limits.test.ts test/unit/link-settings-tailscale.test.ts` exit 0 · mac - · 4d221fc8a467ffd657d85084ed76f6d88479c0d4
- [ ] Поведение при `version` новее известной выбрано и обосновано в «Итог».
  - evidence: commit pass · Keep a newer build's state files readable by an older one · - - · 4d221fc8a467ffd657d85084ed76f6d88479c0d4
- [ ] `docs/features/storage-and-diagnostics.md` и перевод говорят то, что делает код.
  - evidence: commit pass · Keep a newer build's state files readable by an older one · - - · 4d221fc8a467ffd657d85084ed76f6d88479c0d4
- [ ] Все unit и contract test-ы `src/main/storage/`, `src/main/link/`, `src/main/agent/limits.ts`, `pnpm typecheck`,
      `pnpm lint`, gate fast — exit 0.
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 · mac - · 4d221fc8a467ffd657d85084ed76f6d88479c0d4
  - evidence: gate pass · `gate fast` exit 0 · mac - · 4d221fc8a467ffd657d85084ed76f6d88479c0d4

## Где в коде

- `src/main/storage/json-file.ts:8-10`, `:50` — `readJsonFile` и откладывание файла.
- `src/main/link/settings.ts:26-42` — схемы версий 1 и 2.
- `src/shared/agent/limits.ts:42`, `:47` — `limitsStateSchema`; `src/main/agent/limits.ts:92` — чтение.
- `src/main/getting-started/state.ts:38` — единственная loose-схема.
- `docs/features/storage-and-diagnostics.md:78-80`, `docs/features/ru/storage-and-diagnostics.md`.

## Итог

**Красный test до правки.** `test/unit/state-files-newer-build.test.ts` на `origin/main` 42372355b: 3 из 5 красные —
`link/settings.json` версии 2 с незнакомым ключом теряет его при следующей записи; версия 3 откладывается в
`settings.json.unreadable-<time>`; `limits.json` теряет ключ верхнего уровня, ключ окна и незнакомый `source`. Два test-а
«файл не-JSON откладывается» зелёные до и после правки — правило для них не менялось.

**Что сделано.**
- `src/main/link/settings.ts` — схемы версий 1 и 2 стали `z.looseObject`. Ключи, которых сборка не знает, хранятся в
  объекте настроек и пишутся обратно при каждой записи (и при переписывании версии 1 в версию 2). Схема чтения принимает
  ещё файл любой целой `version` больше 2 и разбирает его в `{ version: 'newer' }`, а не в «нечитаемый файл».
- `src/main/agent/limits.ts` — `limits.json` читается и пишется схемой `limitsFileSchema`: та же
  `limitsStateSchema`, но loose на верхнем уровне и у каждого окна. Общая `limitsStateSchema` в
  `src/shared/agent/limits.ts` осталась строгой: ею IPC отдаёт Limits в renderer, и contract test
  «unknown keys are dropped» канала `limits.open` остаётся в силе — чужие ключи до renderer не доходят.
- `src/shared/agent/limits.ts` — `mergeLimits` возвращает `{ ...state, windows }`, а не `{ windows }`, поэтому ключи
  верхнего уровня переживают обновление. Окно, которое сборка заменяет своим новым значением, теряет незнакомые ключи
  старого значения: они описывали старое значение. `source` теперь `z.string()` вместо
  `z.enum([...]).catch('sdk')`: незнакомый источник остаётся как записан, а не переписывается в `sdk` при следующей
  записи. Для логики этой сборки он пассивный, как и раньше: `limits-usage.ts:218` сравнивает только с `usage`.
  `LimitWindow.source` и раньше был `z.string()`.
- Комментарий в начале `src/main/storage/json-file.ts`, Feature page `docs/features/storage-and-diagnostics.md` (пункт
  «A read gives the parsed value») и перевод `docs/features/ru/storage-and-diagnostics.md`.
- Test-ы, которые фиксировали старое правило, переписаны на новое: `test/unit/limits.test.ts` (незнакомый `source`
  остаётся как записан) и `test/contract/limits.test.ts` (ключи вне схемы `limits.json` сохраняются; нечитаемый файл
  по-прежнему откладывается).

**`version` новее известной — выбор: значения по умолчанию, файл не трогаем.** Для `link/settings.json` старая сборка
работает с настройками по умолчанию (доступ выключен, `machines` пуст, `keepAwake` включён, `tailscale` выключен),
файл не откладывает и не пишет никогда, пока работает. Изменение, сделанное в этой сборке, действует до выхода из
worfy, объявляется подписчикам (`changed`) и не сохраняется; в лог идёт предупреждение. Почему не «читать знакомую
часть»: это файл прав доступа Linked machine. Новая версия может добавить правило, которое сужает то, что говорят
знакомые поля (например, доступ только к части Project-ов или новый уровень), и старая сборка, читая только знакомое,
дала бы больше доступа, чем дала новая. Выключенный доступ — безопасная сторона, тот же выбор, что у файла, который
не читается. Цена: на время отката Linked machine-ы не работают с Project-ами этой Machine, пока владелец не включит
доступ заново в этой сборке (и это не сохранится). Новая сборка после возврата находит свой файл без изменений. У
`limits.json` поля `version` нет, правило к нему не относится.

**Остальные store поверх `readJsonFile`.** Правило получили только `link/settings.json` и `limits.json`;
`getting-started.json` уже был loose. Остальные отбрасывают незнакомые ключи и откладывают файл чужой формы, как раньше:
- `app-settings.json` (`src/main/settings/store.ts`) — самый заметный кандидат: новая настройка новой сборки теряется
  при первой записи старой. Схема вложенная, с `default` и `transform` на многих уровнях; loose на каждом уровне и
  проверка каждого пути записи — отдельный ticket.
- `terminal-ai.json` (`src/main/terminal-ai/settings.ts`) — то же, меньше по объёму; отдельный ticket.
- `link/linked.json` (`src/main/link/store.ts`) и `link/machine.json` (`src/main/link/identity.ts`) — `version: 1`.
  Версии 2 пока нет; когда она появится, старая сборка отложит файл и потеряет список Linked machine-ов или
  идентичность Machine. Правило «новее известной — не откладывать, не писать» стоит ввести вместе с версией 2.
- Файлы Project-а: `layout.json` и камеры (`src/main/layout/store.ts`, `viewports.ts`), `bindings`, корзина
  (`trash.ts`), `projects.json` и настройки Project-а (`src/main/projects/`), данные Card (`src/main/cards/data.ts`),
  `session-settings`, Browser profiles, скрытые subagent-ы. Не тронуты: у каждого свой путь записи (Layout пишется
  целиком из состояния renderer), и потерь от отката по ним не наблюдали. Каждый — отдельное решение.
- Записи обновления (`src/main/update/state.ts`, `restart.ts`, `harness-after-update.ts`) — их пишет и читает сам
  процесс обновления и отката; не тронуты.

**Проверки.** `pnpm lint && pnpm typecheck && pnpm test` в worktree — exit 0 (681 файл, 15841 test passed, 127
skipped); в этот прогон входят все unit и contract test-ы `src/main/storage/`, `src/main/link/`, Limits и Getting
started.
