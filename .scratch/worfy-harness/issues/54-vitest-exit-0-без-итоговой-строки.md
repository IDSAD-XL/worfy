# 54 — Прогон vitest с exit 0 без итоговой строки gate считает зелёным

Type: task
Status: done 2026-10-20T05:12Z
PR: #558
Branch: worfy-harness/54
Blocked by: —
Source: ревью PR [#517](https://github.com/IDSAD-XL/worfy/pull/517) (worfy-windows 65, harness-evals на
Windows), мутант T4: прогон, где worker vitest завис или Electron запустился как GUI, кончился с exit 0
без итоговой строки vitest. Не воспроизведено отдельно. Код перечитан по main `2af91b51`.

## Что происходит

- Unit и contract test-ы идут через `scripts/vitest-electron.mjs`: vitest под Node из Electron. Обёртка
  отдаёт код выхода vitest как есть (`process.exitCode = code`) и итоговую строку не проверяет.
- Gate (`harness/hooks/gate.mjs`) решает по коду выхода скрипта и по шаблонам `REAL_FAILURE` /
  `UNVERIFIABLE` в выводе. Проверки «vitest напечатал итог `Test Files … passed`» нет.
- Значит, прогон, который оборвался без итога, но с кодом 0 (Electron ушёл в GUI-режим без
  `ELECTRON_RUN_AS_NODE`, worker повис и процесс закрыли), даёт `[gate] зелено`. Это ложный зелёный —
  хуже красного.

## Что делаем

1. **Воспроизвести.** В копии в scratchpad: запустить `scripts/vitest-electron.mjs` так, чтобы Electron
   стартовал без `ELECTRON_RUN_AS_NODE` или worker завис, — записать код выхода и вывод в «Итог». Если
   exit 0 без итога не воспроизводится — «Итог» с замером, и Ticket закрывается без правки кода.
2. **Правка там, где дешевле и надёжнее:**
   - обёртка `vitest-electron.mjs`: код 0 без итоговой строки vitest (`Test Files`, `Tests`) → свой
     ненулевой код и одна строка stderr «vitest ended without its summary»; или
   - gate: для скриптов vitest итог без строки `Tests N passed` — «не проверено» (exit 3), а не зелёный.
   Выбор и причина — в «Итог». Gate — общий для проектов, поэтому правка в gate не должна ждать строку
   vitest у проектов, где test-ы идут другим раннером (шаблон берётся из профиля или из имени команды).

## Готово, когда

- [ ] «Итог»: воспроизведение (команда, код выхода, хвост вывода) или замер, что exit 0 без итога не
      бывает.
- [ ] Если правка: test (contract обёртки или test gate) — stand-in vitest, который выходит с 0 без
      итога, даёт ненулевой код / «не проверено»; обычный прогон с итогом — как раньше.
- [ ] Мутант красный: проверка итога убрана.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

## Тесты

- Сначала падающий: stand-in vitest «exit 0, без итога» — сейчас зелёный.

## Где в коде

- `scripts/vitest-electron.mjs`
- `harness/hooks/gate.mjs` (разбор вывода, `REAL_FAILURE`, `UNVERIFIABLE`)

## Вне скоупа

- Причины зависания worker-ов vitest на Windows — worfy-windows 14 и 66.

## Итог

PR #558, merge 5737fdb6.

- Воспроизведение: exit 0 без итоговой строки vitest на macOS не получен ни в одном из 11 сценариев
  (Electron 44, vitest 5.0.3, копия обёртки в отдельном проекте с зависшим test-ом): обычный прогон,
  Electron без `ELECTRON_RUN_AS_NODE`, SIGTERM/SIGINT/SIGKILL Electron, SIGTERM обёртки, SIGKILL/SIGTERM
  fork worker-а, `app.quit()`. Коды: 0 только с итогом; остальные 143, 130 или 1. Таблица — в описании PR.
- Правка всё равно сделана как дешёвая страховка (исходный отчёт был с Windows):
  `scripts/vitest-electron.mjs` построчно ищет в stdout итог vitest (`Test Files … (N)`, `Tests … (N)`);
  exit 0 без итога превращается в 1 с одной строкой в stderr. Не проверяются `--help`, `--version` и
  прогоны, где среди `--reporter` нет `default`, `verbose`, `dot`, `tree` (json для mutation-скриптов).
- Попутно: обёртка убирает `--`, если он стоит первым аргументом. Раньше `pnpm test -- <file>` терял
  фильтр и гонял весь набор (320 файлов). Теперь `pnpm test -- <file>` и `pnpm test <file>` одинаковы.
- Изменение поведения: stdout vitest теперь pipe, а не TTY; цвета остаются, но вместо перерисовки
  прогресса — построчный вывод.
- Test-ы: `test/contract/vitest-electron.test.ts` (stand-in vitest). На старой обёртке 4 из 22 красные;
  после правки зелёные. Мутанты (проверка итога снята; снятие `--` убрано) — красные.
- Gate full на Mac зелёный (очередь оркестратора 2026-10-20), после чего PR смержен.

