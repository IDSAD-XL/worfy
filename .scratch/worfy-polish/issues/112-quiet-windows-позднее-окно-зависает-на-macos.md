# 112 — quiet-windows: e2e test позднего окна зависает на macOS runner-е

Type: bug
Status: done 2026-11-16T02:52Z
PR: #1893
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

## Root cause (найдена 2026-11-16)

Hypothesis про AppKit или GPU не подтвердилась: main стоял в модальном окне ошибки самого Electron. Во всех трёх
красных попытках (run 43118125388 — попытка и retry, run 42919374356 — первая попытка) в stderr main, который
Playwright приложил к ошибке в `trace.zip`, одна и та же строка:

```
[worfy] uncaught exception in main (uncaughtException): TypeError: Object has been destroyed
    at BrowserWindow.visibilityChanged (node:electron/js2c/browser_init:1:18097)
```

Цепочка: `first.destroy()` показанного окна на macOS иногда шлёт событие `hide` уже уничтоженному окну. Electron
сам вешает на `show`/`hide`/`minimize`/`maximize`/`restore` слушатель `visibilityChanged`
(`lib/browser/api/browser-window.ts` Electron v44, строки 73–84), он зовёт `this.isVisible()` и бросает
«Object has been destroyed». На uncaught exception main Electron показывает модальное окно «A JavaScript error
occurred in the main process» (`src/main/diagnostics/uncaught-stderr.ts:1-10`), и оно держит поток main, пока его
не закроют. Поэтому не сработал и 30-секундный timer внутри `app.evaluate`. Код worfy главное окно через
`destroy()` не закрывает: путь есть только в test-е.

Исправление — в test-е: первое окно остаётся открытым. На время одного `app.emit('second-instance')`
`BrowserWindow.getAllWindows` возвращает пустой список, и обработчик worfy (`src/main/index.ts:127-137`) открывает
следующее окно тем же `createMainWindow`, как после закрытия последнего окна. Ожидание показа смотрит только на
новое окно.

## Готово, когда

- [ ] Test проходит без пути с `destroy()`, или root cause найдена и исправлена.
  - evidence: gate pass · `gate fast` exit 0 (lint, typecheck, pnpm test 18422 passed); the e2e run itself is the macos-e2e CI job · mac - · 28c6fb214c36c28f2d42420e7a33765634e46184
  - evidence: ci-check pass · macos-e2e 2/2 on PR #1893: the later-window test passed without destroy(), 2.2 s, no retry · mac - · 2cb2713776a699b88730ca3ec5ae5aaf39264061
- [ ] Запись quarantine `test/quarantine/quiet-windows-later-window-quiet.json` удалена, test снова объявлен через `test(...)`.
  - evidence: commit pass · test(e2e): open quiet-windows later window beside the first instead of destroying it (worfy-polish 112) — quarantine entry deleted, test declared with test() · - - · 28c6fb214c36c28f2d42420e7a33765634e46184
- [ ] CI e2e на macOS зелёный.
  - evidence: ci-check pass · CI green on PR #1893 (ci-ok; macos-e2e 2/2 ran quiet-windows.spec, the later-window test passed on its first attempt in 2.2 s) · mac - · 2cb2713776a699b88730ca3ec5ae5aaf39264061

## Trail

- `test/e2e/quiet-windows.spec.ts`
- `src/main/window.ts`
- `src/main/index.ts`
- `test/quarantine/quiet-windows-later-window-quiet.json`
