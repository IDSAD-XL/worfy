# 61 — `wave-gate.test.sh` красный внутри полного `pnpm test`; сообщение harness-scripts прячет строку FAIL

Type: bug
Status: done 2026-10-21T01:21Z
PR: #638
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

PR [#638](https://github.com/IDSAD-XL/worfy/pull/638), merge cd6d4f30. Gate full Mac: шаг test-ов красный один раз на
`test/unit/install-stable.test.ts` («refuses while a program of the copy is running», вне diff; гонка fork/exec — правка
оркестратора, PR #646), повтор шага зелёный (7356/0). Windows verdict (check/windows) на 1e92d444 зелёный (wave-gate
отдельно 294 s). Платформенный PR. Ревью: один круг (тесты, корректность; medium) — PASS, high/med нет.

- **Какая проверка падала — не записано** ни в одном красном прогоне. Воспроизводят ту же картину `passed 164, failed 1`
  без нагрузки две: «locked screen: ioreg polled while it waits» (ей нужно было ещё 2 вызова ioreg внутри `sleep 2`;
  stub ioreg с задержкой 0,8 s даёт ровно 164/1) и «pid race» (вторая проверка стартует на 4 s позже). Задержка ioreg
  2,5 s даёт 4 FAIL (heartbeat, случаи lockfor): `spawnSync` ioreg в wave-gate держит цикл событий. Дефекта в
  `harness/bin/wave-gate` нет.
- **Правка `wave-gate.test.sh`:** проверки ждут событие с пределом и именованным FAIL вместо фиксированных пауз: счёт
  вызовов ioreg; pid race — файл `$GATE_DIR/hold` вместо `$GATE_DIR/sleep`; heartbeat — смена mtime; lockfor — пока stub
  ioreg не ответил Yes; тихие периоды — от строки «waiting for the e2e lock». Паузы, где ничего не должно случиться, не
  дают ложный красный и остались.
- **Правка `harness-scripts.test.ts`:** сообщение красного shell test-а — сначала все строки `FAIL ` (не больше 30), потом
  последние 20 строк; без строк FAIL — последние 40, как раньше. При merge с #626 (5 shell-файлов параллельно) отчёт
  встроен в `failure()` бегуна #626.
- **Проверки:** файл 10 прогонов подряд — 165/0; новые test-ы зелёные под всеми тремя задержками; ревьюер тестов — 7
  мутантов wave-gate (живой замок взят, нет опроса экрана, ответ опроса игнорируется, обе проверки pid race идут, нет
  heartbeat, медленный опрос ioreg) — все пойманы именованным FAIL. После merge с main: harness-scripts 54/54 (99 s).
- **Остался low (не сделан):** случай живого замка (`wave-gate.test.sh` около `:549`) не проверяет, что напечатана строка
  «waiting for the e2e lock»; молчаливое ожидание поймает только соседний случай.
- **Риск:** с #626 wave-gate идёт рядом с 4 файлами; отдельно 70–92 s на Mac при пределе 120 s.
