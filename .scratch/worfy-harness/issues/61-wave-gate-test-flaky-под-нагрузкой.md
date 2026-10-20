# 61 — `wave-gate.test.sh` красный внутри полного `pnpm test`; сообщение harness-scripts прячет строку FAIL

Type: bug
Status: claimed 2026-10-20T20:55Z
Blocked by: —
Source: gate full очереди Mac 2026-10-20 — слово Session-оркестратора «Worfy продолжение». Gate #596:
`passed 164, failed 1`; раньше в gate #594: `passed 156, failed 1`. Отдельно файл зелёный (157/0,
harness-scripts 46/46).

## Что происходит

- `harness/bin/tests/wave-gate.test.sh` (запускается из `test/contract/harness-scripts.test.ts`) под нагрузкой
  полного прогона даёт один FAIL. Какой — неизвестно: сообщение vitest (`harness-scripts.test.ts` около `:100`)
  показывает только последние 40 строк вывода, и последней там стоит намеренная `line 411: Killed` случая resume.
- В файле есть паузы, которые задают порядок (`sleep 3` около `:536`, `sleep 2` около `:579`, `sleep 1|2` после
  `until_ok` около `:623-659`), и окна опроса по 3 s.

## Что делаем

1. `harness-scripts.test.ts`: при красном shell test-е сообщение содержит строки FAIL (с ограничением), потом хвост.
2. Найти проверку `wave-gate.test.sh`, зависящую от времени, и воспроизвести красный без нагрузки (принудительная
   задержка stub-а), как в ticket 57.
3. Заменить паузы-«порядки» ожиданием событий или файлов, сохранив смысл проверок; перечислить все паузы файла
   с решением в «Итог».

## Готово, когда

- [ ] Сообщение harness-scripts при красном shell test-е показывает строку FAIL (мутант с намеренным FAIL).
- [ ] Принудительная задержка даёт красный на старом test-е и зелёный на новом.
- [ ] `wave-gate.test.sh` 10 прогонов подряд — exit 0; `plugin-neutral.test.sh`, lint, typecheck — exit 0.

## Где в коде

- `harness/bin/tests/wave-gate.test.sh`, `harness/bin/wave-gate`.
- `test/contract/harness-scripts.test.ts`.

## Риски

- Платформенный PR (test-ы в `harness/bin`): после Mac gate нужен Windows verdict.

## Итог

Заполняется при закрытии.
