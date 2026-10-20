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
4. **Где.** Вторая строка колонки Harness, справа от версии приложения: «v0.3.0+e61cb1fe  412 MB».
   Отдельный элемент toolbar не заводится.
5. **Настройка.** Новое поле `memoryIndicator` в app settings, по умолчанию `true`. Переключатель
   «Show worfy's memory in the toolbar» в Settings → General, под масштабом интерфейса. Меняется
   сразу во всех открытых окнах, без перезагрузки; хранится в `app-settings.json`. Файл старой
   версии без поля читается как `true`.

## Готово, когда

- [x] Unit: формат KB → «MB» / «GB» на границах (0, 1023 MB, 1024 MB, дробные GB) и сумма массива
      формы `getAppMetrics()` по типам; мусорное значение памяти считается нулём.
- [x] Contract: при выключенной настройке таймер не идёт и метрики не читаются; включение
      запускает его, выключение останавливает; без окон, открывших индикатор, таймер не идёт;
      `memory.close` и уничтоженное окно останавливают его.
- [x] Contract: `memoryIndicator` в `app-settings.json` — по умолчанию `true`, сохраняется, файл без
      поля читается как `true`.
- [x] Unit: переключатель в Settings → General пишет `memoryIndicator`; вид индикатора — число,
      единица и tooltip с разбивкой.
- [x] e2e: индикатор виден по умолчанию с числом и единицей; выключение в Settings прячет его в
      открытом окне без перезагрузки, включение возвращает.
- [x] Каждый новый test краснеет на названном mutant-е.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `gate.mjs fast` — exit 0 и «[gate] зелено».

## Где в коде

- `src/shared/memory.ts` (новый) — схема снимка, сумма метрик, формат, tooltip
- `src/shared/ipc/memory.ts` (новый) — каналы `memory.open`, `memory.close`, `memory.changed`
- `src/main/diagnostics/memory.ts` (новый) — `MemorySampler` и его связь с настройкой
- `src/main/ipc/memory.ts` (новый) — handler-ы
- `src/shared/settings/app-settings.ts`, `src/main/settings/store.ts` — поле `memoryIndicator`
- `src/renderer/memory/useAppMemory.ts`, `src/renderer/memory/AppMemory.tsx` (новые)
- `src/renderer/shell/toolbar/HarnessStatus.tsx` — вторая строка колонки
- `src/renderer/settings/PipelineSection.tsx` — колонка Harness без памяти (именованный импорт)
- `src/renderer/settings/GeneralSection.tsx` — переключатель
- `test/unit/memory.test.ts`, `test/unit/app-memory.test.tsx`, `test/contract/memory.test.ts`,
  `test/contract/memory-app.test.ts` (новые); `test/unit/settings-pipeline.test.tsx`
- `test/contract/app-settings.test.ts`, `test/unit/shell.test.tsx`, `test/unit/machines-section.test.tsx`,
  `test/unit/interface-scale.test.tsx`, `test/unit/sidebar-section.test.tsx`,
  `test/unit/pipeline-board.test.tsx` — литералы настроек с новым полем
- `test/unit/harness-status.test.tsx`, `test/unit/settings-sessions.test.tsx`, `test/unit/use-app-settings.test.tsx`
- `test/e2e/memory.spec.ts` (новый), `test/e2e/toolbar.spec.ts`, `test/e2e/settings.spec.ts` (порядок Tab в General)

## Вне скоупа

- Память дочерних процессов терминалов и Session-ов (claude CLI) — владелец решил их не считать.
- История и график памяти, предупреждение о росте.

## Итог

Ветка `worfy-ui/20-ram`, база — main `e74014a9`.

**Место — вторая строка колонки Harness, после версии приложения** (`HarnessStatus.tsx`, слот
`memory`; сама цифра — `src/renderer/memory/AppMemory.tsx`). Почему здесь:
- цифра описывает само запущенное приложение, как и версия рядом с ней;
- toolbar не получает нового элемента и новой колонки. Ширина колонки — по более длинной из двух
  строк; вторая строка вырастает на 7 моноширинных символов и зазор;
- шрифт моноширинный, ширина не меньше 7 символов («1023 MB», «12.5 GB»): смена числа каждые 5 с не
  двигает соседей;
- высота toolbar не меняется: строка одна, `nowrap`. e2e `memory.spec.ts` проверяет это при
  минимальном окне 800×520, `toolbar.spec.ts` — что при 1280 px все элементы целиком в окне.

Отдельный элемент toolbar справа от Limits отвергнут: он добавлял бы около 60 px ширины всегда.
При 800 px toolbar и до этого тикета не помещается целиком (уступает только заголовок), и новый
элемент сдвинул бы Limits влево ещё сильнее.

**Main** — `src/main/diagnostics/memory.ts`, `MemorySampler`. Таймер на 5 с существует, только пока
выполнены оба условия: настройка `memoryIndicator` включена (`followMemorySetting` слушает
`changed` store-а настроек) и хотя бы одно окно открыло цифру (`memory.open`) и не закрыло её
(`memory.close`, уничтожение окна). Первое открытие сразу снимает метрики, без ожидания 5 с.
Ошибка `getAppMetrics()` — одно предупреждение в лог до первого успешного чтения, таймер идёт дальше.
Выключение настройки забывает последний снимок: `memory.open` отвечает `null`.

**Окно** — `useAppMemory(enabled)`: открывает цифру, пока настройка включена, и закрывает её
(`memory.close`) при выключении или размонтировании. Настройка общая для Machine и приходит в
каждое окно через `appSettings.changed`, поэтому переключатель действует во всех окнах сразу.
До первого ответа `appSettings.get` окно держит значения по умолчанию (включено) и может на миг
открыть цифру; main при выключенной настройке ничего не снимает.

**Mutant-ы** — каждый краснеет на своём test-е (скрипт в scratchpad, исходник восстанавливался
из копии):
- `formatMemory` переходит на GB только с 1025 MB, renderer-ы считаются как other, NaN и
  отрицательные размеры складываются — `test/unit/memory.test.ts`;
- sampler не смотрит на настройку, не следит за её изменением, не снимает метрики при старте,
  `memory.close` ничего не делает, `destroyed` слушается при каждом открытии —
  `test/contract/memory.test.ts`;
- store теряет `memoryIndicator` из изменения, файл без поля читается как выключено —
  `test/contract/app-settings.test.ts`;
- окно не закрывает цифру, цифра не смотрит на настройку, переключатель пишет старое значение, нет
  tooltip-а, цифры нет во второй строке — `test/unit/app-memory.test.tsx`;
- e2e: цифра не смотрит на настройку — `test/e2e/memory.spec.ts`.

**Удалено и изменено:** у `HarnessStatusView` вторая строка теперь — `div` `app-line`, внутри него
`app-version`; раньше `app-version` был прямым потомком колонки. В Settings → General между slider-ом
масштаба и Close встал ещё один элемент, принимающий фокус по Tab.

**Review PR #575, раунд 1** (2 med, 4 low), исправлено одним раундом:
- Колонку Harness показывает ещё Settings → Pipeline, когда Harness слишком старый для редактора
  (`PipelineSection.tsx`, тот же webContents). Её `memory.close` снимал подписку окна, и цифра в
  toolbar замирала. Теперь:
  - память рисует только элемент toolbar: default export `HarnessStatusItem` передаёт `memory`, а
    Pipeline импортирует `HarnessStatus` без неё;
  - main считает открытия по окну и снимает подписку, когда счётчик доходит до нуля.
- Mutant `patch.memoryIndicator ?? true` выживал. Теперь test проверяет, что изменение масштаба не
  включает выключенную память обратно.
- Добавлены test-ы:
  - связка `appMemory()` с настройкой и `will-quit` (`test/contract/memory-app.test.ts`);
  - интервал 5 с, закреплённый литералом;
  - поздний ответ `memory.open` после свежего `memory.changed`;
  - «Not saved» у переключателя;
  - элемент toolbar показывает цифру, а Pipeline — нет.
- Mutant-ы этого раунда, каждый красный на своём test-е:
  - второе открытие в окне не считается;
  - закрытие сразу снимает подписку окна;
  - Pipeline показывает память;
  - элемент toolbar без памяти;
  - изменение другой настройки включает память;
  - `appMemory()` без `followMemorySetting`;
  - интервал 60 с;
  - нет проверки `changed` у ответа `memory.open`;
  - отказ main у переключателя молчит.

