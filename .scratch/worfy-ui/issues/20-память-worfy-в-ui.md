# 20 — Память worfy в toolbar и переключатель в Settings

Type: feature
Status: claimed 2026-10-20T01:19Z
Branch: worfy-ui/20-ram
Blocked by: —
Source: просьба владельца 2026-10-20: «найди место в юайке где можно вывести отображение занимаемой
оперативной памяти ворфи. Ну и в настройках возможность включить/выключить это.» Решения о том, что
мерить, как часто и в каком формате, — бриф оркестратора того же дня. Код перечитан по main `e74014a9`.

## Что происходит

- worfy нигде не показывает, сколько оперативной памяти он занимает. Узнать это можно только в
  Activity Monitor, где процессы Electron (main, renderer-ы, GPU, utility) идут отдельными строками.
- В toolbar справа стоят Limits (`toolbar/LimitsMeter.tsx`, order 100) и колонка Harness
  (`toolbar/HarnessStatus.tsx`, order 500): строка Harness сверху, версия приложения снизу
  (worfy-ui 18, PR #543). Дальше — поле «Search or run… ⌘K».
- Toolbar тесный: при минимальной ширине окна (800 px, `MIN_SIZE`) его элементы уже не помещаются
  целиком. Уступает место только заголовок с именем Project-а.
- Настройки Machine — `app-settings.json` (`src/main/settings/store.ts`), общие для всех окон; каждое
  изменение доходит до всех окон событием `appSettings.changed`. Отображение (масштаб интерфейса)
  настраивается в Settings → General.
- i18n в приложении нет: строки UI написаны по-английски прямо в компонентах (`docs/design/BRIEF.md`).

## Что делаем

1. **Что мерим.** Сумма `memory.workingSetSize` (KB) по всем процессам Electron приложения —
   main, renderer-ы, GPU, utility — из `app.getAppMetrics()`. Дочерние процессы терминалов
   (claude CLI под node-pty) не считаются. Tooltip говорит это прямо: «Memory used by worfy's own
   processes (not counting terminal sessions)», и даёт разбивку по типам: main / windows / GPU /
   other.
2. **Как часто.** Main снимает метрики раз в 5 секунд и только пока хотя бы одно окно показывает
   индикатор (окно открыло канал `memory.open` и не закрыло его `memory.close` и не уничтожено). При
   выключенной настройке таймер не идёт вовсе. Новое значение уходит в окна событием
   `memory.changed`, как Limits (`limits.open` / `limits.changed`). Все каналы — `local`: память —
   своей Machine, Linked machine её не видит.
3. **Формат.** «412 MB» меньше 1024 MB, «1.3 GB» от 1024 MB. Моноширинный шрифт и минимальная
   ширина в 7 символов: смена числа не сдвигает соседние элементы toolbar.
4. **Где.** Вторая строка колонки Harness, справа от версии приложения: «v0.3.0+e61cb1fe · 412 MB».
   Отдельный элемент toolbar не заводится.
5. **Настройка.** Новое поле `memoryIndicator` в app settings, по умолчанию `true`. Переключатель
   «Show worfy's memory in the toolbar» в Settings → General, под масштабом интерфейса. Меняется
   сразу во всех открытых окнах, без перезагрузки; хранится в `app-settings.json`. Файл старой
   версии без поля читается как `true`.

## Готово, когда

- [ ] Unit: формат KB → «MB» / «GB» на границах (0, 1023 MB, 1024 MB, дробные GB) и сумма массива
      формы `getAppMetrics()` по типам; мусорное значение памяти считается нулём.
- [ ] Contract: при выключенной настройке таймер не идёт и метрики не читаются; включение
      запускает его, выключение останавливает; без окон, открывших индикатор, таймер не идёт;
      `memory.close` и уничтоженное окно останавливают его.
- [ ] Contract: `memoryIndicator` в `app-settings.json` — по умолчанию `true`, сохраняется, файл без
      поля читается как `true`.
- [ ] Unit: переключатель в Settings → General пишет `memoryIndicator`; вид индикатора — число,
      единица и tooltip с разбивкой.
- [ ] e2e: индикатор виден по умолчанию с числом и единицей; выключение в Settings прячет его в
      открытом окне без перезагрузки, включение возвращает.
- [ ] Каждый новый test краснеет на названном mutant-е.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `gate.mjs fast` — exit 0 и «[gate] зелено».

## Где в коде

- `src/shared/memory.ts` (новый) — схема снимка, сумма метрик, формат, tooltip
- `src/shared/ipc/memory.ts` (новый) — каналы `memory.open`, `memory.close`, `memory.changed`
- `src/main/diagnostics/memory.ts` (новый) — `MemorySampler` и его связь с настройкой
- `src/main/ipc/memory.ts` (новый) — handler-ы
- `src/shared/settings/app-settings.ts`, `src/main/settings/store.ts` — поле `memoryIndicator`
- `src/renderer/memory/useAppMemory.ts`, `src/renderer/memory/AppMemory.tsx` (новые)
- `src/renderer/shell/toolbar/HarnessStatus.tsx` — вторая строка колонки
- `src/renderer/settings/GeneralSection.tsx` — переключатель
- `test/unit/memory.test.ts`, `test/unit/app-memory.test.tsx`, `test/contract/memory.test.ts` (новые)
- `test/contract/app-settings.test.ts`, `test/unit/shell.test.tsx`, `test/unit/machines-section.test.tsx`,
  `test/unit/interface-scale.test.tsx`, `test/unit/sidebar-section.test.tsx`,
  `test/unit/pipeline-board.test.tsx` — литералы настроек с новым полем
- `test/e2e/memory.spec.ts` (новый), `test/e2e/toolbar.spec.ts`

## Вне скоупа

- Память дочерних процессов терминалов и Session-ов (claude CLI) — владелец решил их не считать.
- История и график памяти, предупреждение о росте.

## Итог
