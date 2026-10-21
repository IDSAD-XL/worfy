# 82 — `projects-connect.spec.ts` на Windows: диалог показывает стадию `harness`, а не `form`

Type: task
Status: open
Blocked by: 80
Source: проверка тикета 80 на ПК владельца (PR #667) и решение Session на Mac, 2026-10-21.

## Что происходит

На Windows падают три test-а `test/e2e/projects-connect.spec.ts`:

- `:73` «Add project connects a new repository…»;
- `:230` «the GitHub account: the active account with access by default…»;
- `:294` «the GitHub account: gh failing says why…».

Ошибка у всех одна: диалог подключения Project-а ждут на стадии `form`, а он на стадии `harness`
(`Expected: "form"`, `Received: "harness"`). Стадия `harness` значит: worfy считает, что Harness не
установлен (так же, как test `:172` вызывает её нарочно).

Падают одинаково и на ветке тикета 79 (до фикса тикета 80), и на ветке тикета 80. В обоих прогонах
watcher `gh.exe` видел 0 запусков настоящего gh. Значит, причина не в gh-stub-е.

Предположение, не проверено: поиск Harness (`src/main/harness/locate.ts`, `harnessHomes`) на Windows
не находит Harness песочницы test-а — путь, переменная окружения или формат пути отличаются от macOS.

## Что делаем

1. Найти, почему на Windows Harness песочницы не находится в этих test-ах.
2. Исправить код или песочницу так, чтобы три test-а проходили на Windows, не меняя их смысла на macOS.

## Готово, когда

- [ ] Названа причина стадии `harness` на Windows.
- [ ] `projects-connect.spec.ts` на Windows — зелёный, под watcher-ом `gh.exe` 0 запусков gh.
- [ ] Unit test на причину, если она в коде worfy (красный без фикса).
- [ ] `pnpm typecheck`, `pnpm lint` — exit 0.

## Вне скоупа

- Проверки first-run на Windows и stand-in-ы инструментов — тикет 81.
