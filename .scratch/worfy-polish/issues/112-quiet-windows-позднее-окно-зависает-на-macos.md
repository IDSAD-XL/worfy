# 112 — quiet-windows: e2e test позднего окна зависает на macOS runner-е

Type: bug
Status: open
Blocked by: none
Source: бриф Orchestrator-а 2026-11-12, красный macos-e2e в CI run-е PR #1811.

## Что происходит

E2e test `test/e2e/quiet-windows.spec.ts` «a window worfy opens later is quiet too: shown inactive, transparent, and
the mouse goes through it» — flaky test на macOS runner-е CI. Он проверяет, что окно, которое worfy открывает позже,
тоже «тихое» (quiet windows: показано без фокуса, прозрачное, пропускает мышь). Для этого test оборачивает методы окна
в main, уничтожает первое окно и ждёт следующее.

- PR #1811, run 43118125388, job macos-e2e 1/2: test упал дважды (и сама попытка, и retry).
- Run 42919374356: упал один раз, на retry прошёл (FLAKY).

Ошибка в обоих run-ах одна: «wrapping the window methods and destroying the first window: no answer from main within
60 s».

## Что известно

- Не сработал даже собственный 30-секундный timer main-а внутри `app.evaluate`. Значит, стоит сам поток main, а не
  только ответ в Playwright.
- Hypothesis, не доказана: `first.destroy()` прозрачного окна, которое игнорирует мышь, блокируется внутри AppKit или
  GPU на macOS runner-е. Доказать может только native `sample <pid>` процесса main в момент зависания.
- #1606 (608d7ce04) только разделил шаг на два вызова main и поставил каждому time limit. Причину он не нашёл, поэтому
  зависание осталось; quarantine той записи истекла 2026-11-12.

## Предлагаемое исправление

Предмет test-а — позднее окно, а не уничтожение первого. Открыть второе окно, не уничтожая первое: через тот же код,
который создаёт окна (`createMainWindow`), вызванный через test hook. Тогда путь `destroy()` из test-а уходит совсем.

Если же причину найти (например, через `sample <pid>` на runner-е), исправить её в коде main.

## Готово, когда

- Test проходит без пути с `destroy()`, или root cause найдена и исправлена.
- Запись quarantine `test/quarantine/quiet-windows-later-window-quiet.json` удалена, test снова объявлен через `test(...)`.
- CI e2e на macOS зелёный.

## Trail

- `test/e2e/quiet-windows.spec.ts`
- `src/main/window.ts`
- `src/main/index.ts`
- `test/quarantine/quiet-windows-later-window-quiet.json`
