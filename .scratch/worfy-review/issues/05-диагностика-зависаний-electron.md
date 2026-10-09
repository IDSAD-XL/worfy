# 05 — Диагностика зависаний и падений worfy: запись о падении процесса и стек при таймауте шага по CDP

Type: task
Status: open
Blocked by: —
Source: решение владельца 2026-10-09 («Хорошие идеи, сохрани их и добавь в планы к имплементации»), пункт «диагностика зависаний» из таблицы; [исследование](../../../docs/research/2026-10-09-ponytail-pstack-thermos.md), раздел о pstack: Unix-утилита `pstack` печатает стеки потоков процесса, на macOS её нет, ближайшая замена — `sample`; [spec.md](../spec.md)

## Что происходит

- **Падение renderer или дочернего процесса не оставляет следа.** В `src/main/index.ts` нет
  обработчиков `render-process-gone` и `child-process-gone` и нет `crashReporter`. Electron шлёт эти
  события, когда процесс окна или вспомогательный процесс (GPU, utility) завершился аварийно. Сейчас
  окно просто становится пустым.
- **Лога-файла у main process нет.** Main process пишет через `console.warn` и `console.error`
  (например, `src/main/index.ts:34`, `:48`, `src/main/startup-failure.ts:117`). Stable copy (копия
  `worfy.app` вне репозитория, на которой идёт Autopilot) запускается через `open -a`, и её
  stdout/stderr никто не читает. Запись о падении должна лечь в файл в папке данных (`dataRoot()`,
  `src/main/storage/paths.ts`).
- **Зависание при управлении по CDP не диагностируется.** Orchestrator управляет Stable copy через
  CDP (Chrome DevTools Protocol): запуск с `--remote-debugging-port=9351`, затем `Runtime.evaluate`.
  Выход — по точному pid. Этот порядок записан в личной памяти владельца, вне репозитория; в
  репозитории есть только раздел «Stable copy» в `README.md`. Когда шаг не отвечает, сейчас остаётся
  одно — убить процесс. Что он делал, неизвестно.
- **На macOS есть `sample`** (`/usr/bin/sample`). `sample <pid> 3 -file <файл>` три секунды снимает
  стеки всех потоков процесса без остановки. JS-кадров в нём нет, только нативные. Этого хватает,
  чтобы отличить ожидание I/O от занятого цикла.

## Что сделать

Ticket можно разделить на два независимых PR. Части не делят файлы.

**Часть А — код worfy.**
1. Новый модуль `src/main/diagnostics/process-gone.ts`: подписка на `app` события
   `render-process-gone` и `child-process-gone`. Каждое событие — одна JSON-строка в
   `<dataRoot()>/logs/process-gone.jsonl`: время, вид процесса, `reason`, `exitCode`, для окна — его
   URL. Запись дописывается в конец файла. Ошибка записи не роняет worfy, а уходит в `console.error`.
2. Подключение в `src/main/index.ts` рядом с другими `inStep(…)`.
3. Перезапуск окна после падения не делаем: только запись.

**Часть Б — снимок стека при таймауте.**
1. Новый скрипт `scripts/hang-sample.mjs <pid> [секунды]`. `<pid>` — main process Stable copy (тот
   точный pid, что получен при запуске). `Runtime.evaluate` исполняется не в нём, а в процессе
   renderer (`worfy-stable Helper (Renderer)`), дочернем процессе main. Поэтому скрипт снимает стеки
   main process и всех его дочерних процессов (`pgrep -P <pid>`): renderer, GPU, utility.
   - Проверяет, что pid и каждый дочерний процесс принадлежат `worfy-stable.app` (путь из
     `ps -o comm=` лежит внутри бандла).
   - Для каждого процесса запускает `sample <pid> <секунды> -file <файл>`, все параллельно, и печатает
     пути к файлам. Файлы — в `<data root>/logs/hang-<время>-<pid>.txt`; имя процесса — в первой
     строке файла `sample`.
   - Код выхода — 0, если все `sample` вернули 0; иначе первый ненулевой код.
2. В `README.md`, раздел «Stable copy», — абзац: при таймауте шага по CDP запустить скрипт на pid
   main process и приложить файлы как evidence (доказательство в отчёте), потом завершить процесс.
3. Шаг владельца, не в PR: дописать тот же шаг в личную заметку о CDP Autopilot.

Не проверенные альтернативы — для «Итог», если `sample` не хватит: `spindump <pid>` (нужен sudo);
`lldb -p <pid>` и `thread backtrace all` (останавливает процесс); `process.report.writeReport()` или
`--report-on-signal` у Node (даёт JS-стек, но требует флага при запуске).

## Готово, когда

- [ ] Часть А. Unit `test/unit/process-gone.test.ts`: поддельный `app` шлёт `render-process-gone` и
  `child-process-gone` → в файле по строке с нужными полями; ошибка записи → `console.error`, без
  исключения. Сначала test красный: модуля нет.
- [ ] Часть А. Ручная проверка на собранном приложении. `process.crash()` из DevTools не сработает:
  у окна `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`
  (`src/main/window.ts:84-86`), `process` в renderer нет. Renderer роняется командой CDP `Page.crash`
  (запуск с `--remote-debugging-port`) или вызовом `webContents.forcefullyCrashRenderer()` из main →
  в `process-gone.jsonl` есть строка. Способ и вывод — в «Итог».
- [ ] Часть Б. Ручной прогон `node scripts/hang-sample.mjs <pid main process>` на запущенной Stable
  copy → файлы с потоками main process и дочерних процессов, среди них файл renderer-а; на чужом pid —
  отказ с ненулевым кодом. Вывод и коды — в «Итог».
- [ ] `gate.sh fast` — код 0 и строка `[gate] зелено (fast)`.

## Где в коде

- `src/main/index.ts`
- `src/main/diagnostics/process-gone.ts` — новый
- `test/unit/process-gone.test.ts` — новый
- `scripts/hang-sample.mjs` — новый
- `README.md` — раздел «Stable copy»

## Вне скоупа

- `crashReporter` с отправкой отчётов на сервер.
- Зависание main process самого по себе (без CDP): нужен watchdog, это отдельный Ticket.
- Перезапуск упавшего окна.

## Риски

- **`sample` без JS-стека.** Если причина в JS-цикле renderer-а, файл процесса renderer покажет
  только кадры V8. Файл main process этот цикл не покажет вовсе: `Runtime.evaluate` идёт в процессе
  renderer. Для JS-стека нужен `--report-on-signal`, а это смена флагов запуска.
- **Права macOS.** `sample` чужого процесса того же пользователя обычно разрешён; на подписанном
  приложении с hardened runtime может потребоваться sudo. Stable copy подписана ad-hoc — проверить.
- **Открытый вопрос:** лог `process-gone.jsonl` растёт без предела. Обрезать по размеру или оставить
  как есть, пока событий единицы. Решает исполнитель, итог — в «Итог».
