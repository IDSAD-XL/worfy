# 63 — Windows: `workflow.changed` и `pipeline.changed` теряются, потому что main и окно пишут корень Project-а по-разному

Type: bug
Status: open
Blocked by: —
Source: ревью корректности Ticket-а 57 (ПК владельца, 2026-10-18): находка вне diff-а 57. Тот же
класс дефекта, что 49 и 57: `C:\…` против `C:/…`.

Приоритет — med: на Windows доска Pipeline и обновления workflow не приходят в окно, пока его не
перезагрузить.

## Что происходит (гипотеза, не проверена на Windows)

- **main шлёт корень после `resolve`.** `src/main/workflow/reader.ts:458` делает `resolve(options.root)`,
  на Windows это `C:\…`; дельта `workflow.changed` несёт этот `root`.
- **Окно ищет по строке из списка Project-ов.** `src/renderer/workflow/useWorkflow.ts:60` —
  `users.has(delta.root)`; список хранит корень так, как печатает git: `C:/…`. Строки не совпадают,
  дельта отбрасывается.
- **То же, вероятно, у `pipeline.changed`.** `src/main/ipc/pipeline.ts:59` открывает hub по
  `resolve(root)`; `src/renderer/pipeline/usePipeline.ts:32` — `users.has(snapshot.root)`.
- Reviewer 57 подозревает, что это и есть известный отказ test-а link-access «workflow.changed did not
  arrive» на ПК.

## Что делаем

1. Сначала воспроизвести на Windows: test, в котором окно подписано на `C:/…`, а main шлёт дельту по
   `C:\…`. Красный — гипотеза верна.
2. Один способ сравнения корня на обеих сторонах: либо main шлёт корень в том написании, в каком его
   прислало окно (как сделано для `claudeHome.changed` в 57), либо окно сравнивает через
   `sameProjectRoot` (`src/shared/paths.ts`, Ticket 49). Выбрать то, что сделал 57, чтобы был один
   приём.
3. Тот же test для `pipeline.changed`.

Пересечение: PR #501 (worfy-pipeline 06) меняет `StageHub.open/close` (`src/main/workflow/stages.ts`)
— брать пункт про `pipeline.changed` после его мержа.

## Критерии готовности

- [ ] test на `platform: 'win32'` красный до правки и зелёный после — для обеих дельт.
- [ ] Вердикт ПК: test link-access «workflow.changed» на Windows зелёный (или названа другая причина).
