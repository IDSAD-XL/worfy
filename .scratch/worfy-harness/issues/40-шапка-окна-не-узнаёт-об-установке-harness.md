# 40 — Toolbar окна не узнаёт об установке Harness с экрана First run: «Harness not installed» до перезагрузки окна

Type: task
Status: done 2026-10-20T07:33Z
PR: #563
Branch: worfy-harness/40
Blocked by:
Source: приёмка E3 (приёмка Epic-а worfy-harness), пункт 5 — прогон под вторым, новым пользователем macOS 2026-10-14 (Ticket [26](26-приёмка-e3.md)); [отчёт прогона](../evidence/26-пункт-5-отчёт-2026-10-14.md), находка 3 «Шапка окна противоречит экрану First run».

## Что происходит

Harness — plugin Claude Code с именем `worfy`: правила и скрипты workflow. worfy ставит его из своей
сборки. Установлен ли он, окно показывает в двух местах:

- элемент toolbar (полоса вверху окна; в отчёте она названа «шапка»): «Harness not installed» с
  кнопкой «Install» или «Harness <версия>»;
- строка «Harness plugin» экрана First run (диалог с проверками машины, открывается сам при первом
  запуске): «not installed» с кнопкой «Install» или версия.

### Что видел прогон (2026-10-14, сборка main `ba8a58c`)

- До установки: строка «Harness plugin» красная, «not installed»; сводка экрана — «1 failed · 3
  warnings». Что показывал toolbar до установки, в отчёте не записано. По коду он показывал
  «Harness not installed» и «Install»: состояние `not-installed` даёт этот текст и эту кнопку
  (`src/renderer/shell/toolbar/HarnessStatus.tsx:70-73`).
- Установка сделана с экрана First run (отчёт, находка 3; шаг 8 инструкции — «Install», затем
  «Confirm»). После всех шагов экрана — Harness, qmd, модели qmd — сводка «Everything is ready»,
  все 13 строк зелёные, строка «Harness plugin» с версией `0.2.0+ba8a58cb`. Что показывала сводка
  сразу после установки одного Harness, в отчёте не записано.
- Toolbar при этом показывает «Harness not installed» и «Install». Так на снимках и до
  подключения Project-а, и после него. Точного времени в отчёте нет.
- После перезапуска приложения toolbar показывает «Harness 0.2.0+ba8a58cb».

Итог для человека: одно окно говорит «установлен» и «не установлен» сразу. Кнопка «Install» в
toolbar зовёт к действию, которое уже сделано.

### Что подтверждено в коде (main `ff61b06f`)

Отчёт читал собранный `app.asar`. Все три его утверждения по исходникам верны. Код сборки прогона и
код этого разбора один и тот же: `git diff --stat ba8a58cb ff61b06f -- src harness test package.json`
пуст.

1. **Элемент toolbar читает состояние один раз.** Это компонент `HarnessStatus`
   (`src/renderer/shell/toolbar/HarnessStatus.tsx:107`). Состояние он держит у себя в `useState`.
   Канал `harness.state` он вызывает один раз, когда появляется в окне (`:121-131`, effect с пустым
   списком зависимостей).
2. **Обновляет он его только своей кнопкой.** Новое состояние приходит ему только как ответ на его
   собственный вызов `harness.install` (`:133-142`). Подписки на события в компоненте нет.
3. **События об изменении нет.** В контракте `harness` два канала-вызова и ни одного события:
   `harness.state` (`src/shared/ipc/harness.ts:63`) и `harness.install` (`:70-75`). Поиск
   `eventChannel(` по `src/shared/ipc` не находит события про Harness. Поиск `changed`, `subscribe`,
   `emit(` по `src/main/harness/`, `src/main/ipc/harness.ts` и `src/main/ipc/harness-migration.ts`
   находит только слово «changed» в комментариях и текстах ошибок переноса.

Уточнение к словам отчёта «до перезапуска»: хватает перезагрузки окна. Элемент живёт вместе с
toolbar и не создаётся заново при смене Project-а: `AppShell` и `Toolbar` рисуются без `key` от
Project-а (`src/renderer/main.tsx:59`, `src/renderer/shell/AppShell.tsx:39-45`), а элементы
toolbar — с `key` по имени файла (`src/renderer/shell/Toolbar.tsx:95-99`). e2e
test-ы элемента сами перезагружают окно, чтобы он перечитал состояние с диска
(`test/e2e/harness-install.spec.ts:213`, `:294`).

Где кончается установка с экрана First run:

- экран зовёт `firstRun.run` (`src/renderer/shell/FirstRun.tsx:219`);
- main: `src/main/ipc/first-run.ts:184-193` → `FirstRunActions.installHarness`
  (`src/main/first-run/actions.ts:151-168`) → `appInstaller().install`
  (`src/main/ipc/first-run.ts:134`);
- установщик кончает работу строкой `return { outcome: 'done', status: await this.status() }`
  (`src/main/harness/install.ts:327`);
- ответ возвращается только экрану First run: он кладёт новый отчёт в свой store
  (`src/renderer/shell/FirstRun.tsx:225`). Элементу toolbar никто ничего не сообщает.

Обе кнопки зовут один и тот же установщик — `appInstaller()` (`src/main/ipc/harness.ts:19-32`):
toolbar через `harness.install` (`:53`), First run через `src/main/ipc/first-run.ts:134`.
Экземпляров `HarnessInstaller` в main два, но `install` зовут только у `appInstaller()`. Значит, в
main есть одно место, через которое проходит любая установка, — вызов `appInstaller().install`.
Обработчик `harness.install` (`src/main/ipc/harness.ts:53`) таким местом не служит: установка с
экрана First run через него не проходит, она зовёт `appInstaller().install` напрямую
(`src/main/ipc/first-run.ts:134`).

Кто ещё читает то же состояние:

- строка First run — `appInstaller().status()` (`src/main/ipc/first-run.ts:101`, текст строки —
  `src/main/first-run/checks.ts:274-290`). Проверки идут заново при каждом открытии экрана
  (`src/renderer/shell/first-run-store.ts:38-47`) и после каждого действия. Не устаревает;
- диалог «Add project» — `harness: () => appInstaller().status()` (`src/main/ipc/projects.ts:146`),
  текст отказа — `harnessBlocker` (`src/main/projects/connect.ts:224-236`). Читается в main при
  каждом запросе черновика. Не устаревает;
- форма переноса старого Harness — каналы `harnessMigration.plan` и `harnessMigration.apply` читают
  состояние plugin-а через свой, второй экземпляр `HarnessInstaller`
  (`src/main/ipc/harness-migration.ts:39-49`, вызовы `:93`, `:99`). Он создаётся на каждый запрос и
  зовёт только `status()`. Не устаревает; установку не запускает.

Устаревает только копия в элементе toolbar.

### Сосед того же рода: найден чтением кода, в прогоне не наблюдался

Тот же компонент держит второй флаг — показывать ли кнопку «Move old Harness…» (перенос старого
Harness из `~/.claude`). Флаг читается каналом `harnessMigration.offer` один раз (`:114-119`) и
перечитывается только после формы, открытой самим элементом (`:149-153`). Экран First run открывает
ту же форму (`src/renderer/shell/FirstRun.tsx:302-310`) и после переноса запускает заново только
свои проверки. По коду кнопка «Move old Harness…» в toolbar после переноса с экрана First run
останется до перезагрузки окна. В прогоне старого Harness не было (строка «Old Harness in ~/.claude
(none)»), поэтому этого никто не видел.

### Что воспроизведено и что осталось догадкой

- В песочнице не воспроизводилось: нужен запуск приложения, а этот разбор приложение не запускал.
  Проверка, которая падает сегодня, описана в «Тесты».
- Догадок нет: причина видна в коде целиком.

## Что делаем

Правило: у состояния Harness один источник — установщик в main, и каждое окно узнаёт о перемене без
перезагрузки.

Варианты:

1. **Событие `harness.changed` из main** (предпочтительно).
   - Новый канал-событие в `src/shared/ipc/harness.ts`: полезная нагрузка — `harnessStatusSchema`,
     доступ `local`, как у двух соседних каналов (это состояние машины, на которой открыто окно).
   - main шлёт его во все окна после каждого ответа `done`. У установщика таких ответа четыре
     (`src/main/harness/install.ts:299`, `:305`, `:325`, `:327`). Два первых приходят до диалога:
     не прочитался список plugin-ов или план, в состоянии ошибка. Третий — шаг упал после согласия.
     Четвёртый — установка прошла. После `declined` и `nothing-to-do` событие не шлётся. Шлёт из
     одного места — обёртки вокруг вызова `install` рядом с `appInstaller()`
     (`src/main/ipc/harness.ts`), а не из обработчика `harness.install`: так кнопка toolbar, кнопка
     First run и будущие места покрыты разом. Образец рассылки во все окна —
     `src/main/ipc/app-settings.ts:11`.
   - `HarnessStatus` подписывается на событие и заменяет своё состояние.
   - Почему этот: место одно; второе окно тоже обновляется; открытый Ticket worfy-ui/06 (раздел
     Settings → Health с теми же проверками First run) добавляет третье место с кнопкой установки, и
     ему ничего дописывать не придётся.
2. **Повторное чтение в renderer.** Экран First run после `firstRun.run` с действием
   `harness-install` просит элемент toolbar вызвать `harness.state` ещё раз (общий store). IPC не
   меняется. Минусы: каждое место, которое запускает установку, должно об этом помнить; другое окно
   остаётся со старым состоянием.

Сверх выбранного варианта:

3. Кнопка «Move old Harness…» подчиняется тому же правилу: после переноса с ответом `done` элемент
   toolbar перечитывает `harnessMigration.offer`, откуда бы ни открыли форму. Как именно — тем же
   событием или отдельным — решить при работе и записать в «Итог».
4. Комментарии в начале `src/shared/ipc/harness.ts` и `HarnessStatus.tsx` — по новому поведению.
   Комментарий `src/shared/ipc/harness.ts:4-6` неверен уже сегодня: он говорит, что экран First run
   берёт те же два канала, а экран зовёт `firstRun.run` (`src/renderer/shell/FirstRun.tsx:219`).
   Исправить заодно.

Не делаем опрос `harness.state` по таймеру: каждое чтение запускает `claude plugin list`, когда папка
plugin-а на месте (`src/main/harness/install.ts:267-276`).

## Готово, когда

- [ ] e2e, `test/e2e/first-run.spec.ts`, первый test: после «Install» в строке «Harness plugin» и
      «Confirm» элемент toolbar (`data-testid="harness-status"`) показывает `Harness <версия сборки>`
      и не показывает кнопку `harness-action` — без перезагрузки окна. **Сегодня эта проверка
      падает:** текст остаётся «Harness not installed», кнопка «Install» остаётся.
- [ ] Установка с экрана First run, которая упала на шаге (`claude plugin install` подменён и
      отвечает ошибкой): toolbar показывает `Harness error: install` и «Retry» без перезагрузки.
- [ ] «Cancel» в диалоге установки: состояние toolbar прежнее, событие не шлётся.
- [ ] Обратное направление не сломано: установка кнопкой toolbar по-прежнему меняет элемент
      (`test/e2e/harness-install.spec.ts:137`), а экран First run, открытый после неё, показывает
      «Harness plugin» зелёной.
- [ ] «Move old Harness…»: после переноса из формы, открытой с экрана First run, кнопка в toolbar
      исчезает без перезагрузки окна.
- [ ] Два окна: установка в одном меняет элемент toolbar в другом (вариант 1). Команды «New
      Window» в приложении нет; второе окно в e2e открывает помощник `openSecondWindow`
      (`test/e2e/helpers.ts:229`).
- [ ] Новый канал — `local`. Test `test/unit/link-access.test.ts:98-100` уже требует это от любого
      канала с именем `harness.*`.
- [ ] Каждое новое правило — test, красный на мутанте: «событие не шлётся», «событие шлётся только
      окну, которое просило установку», «элемент не слушает событие», «событие шлётся и после
      Cancel».
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit code 0; gate full (полный локальный прогон
      проверок, с e2e) на Mac зелёный.

## Тесты

Сначала падающий test. В `test/e2e/first-run.spec.ts` после проверок строки (`:166-171`) добавить
проверку элемента toolbar: `harness-text` равен `Harness ${bundledHarness()}`, `harness-action` нет.
На main она красная: элемент прочитал `not-installed` при открытии окна и больше не спрашивал. В
«Итог» — как она падала.

- `test/e2e/first-run.spec.ts` — проверка элемента toolbar после «Install» и «Confirm» в строке
  «Harness plugin»; случай с упавшим шагом; случай «Cancel».
- `test/e2e/harness-install.spec.ts` — прежние случаи зелёные. Два вызова `window.reload()` (`:213`,
  `:294`) остаются: там состояние меняет сам test на диске, мимо приложения.
- `test/unit/harness-status.test.tsx` — сегодня покрыт только `HarnessStatusView`, то есть вид по
  готовому состоянию (`:26-76`). Добавить test-ы самого `HarnessStatus` с подменённым IPC: начальное
  состояние из `harness.state`; после события — новый текст; событие во время собственной установки
  не возвращает старый текст.
- Contract test для main (`test/contract/harness-install.test.ts` или новый файл рядом): после
  `install` с ответом `done` событие ушло во все окна с тем же состоянием, что вернул вызов; после
  `declined` и `nothing-to-do` — не ушло.
- Перенос: `test/unit/harness-migration-form.test.tsx` или e2e `test/e2e/harness-migrate.spec.ts` —
  кнопка в toolbar после переноса из формы First run.

## Где в коде

- `src/shared/ipc/harness.ts` — контракт: два вызова (`:63`, `:70-75`), события нет.
- `src/main/ipc/harness.ts` — `appInstaller()` (`:19-32`), обработчики (`:52-53`).
- `src/main/harness/install.ts` — `HarnessInstaller`: `status()` (`:268`), `install()` (`:283`), конец
  установки (`:327`).
- `src/main/ipc/first-run.ts` — First run зовёт тот же установщик (`:101`, `:134`, `:184-193`).
- `src/main/first-run/actions.ts` — `installHarness` (`:151-168`).
- `src/main/ipc/app-settings.ts` — образец события во все окна (`:11`); `src/main/broadcast.ts` —
  `toEveryWindow`.
- `src/renderer/shell/toolbar/HarnessStatus.tsx` — элемент toolbar (`:107-158`).
- `src/renderer/shell/FirstRun.tsx` — вызов действия (`:219-225`), форма переноса (`:302-310`).
- `src/renderer/shell/first-run-store.ts` — store экрана First run.
- `src/main/ipc/harness-migration.ts` — `harnessMigration.offer` (`:86-89`).
- `test/e2e/first-run.spec.ts`, `test/e2e/harness-install.spec.ts`,
  `test/unit/harness-status.test.tsx`, `test/contract/harness-install.test.ts`,
  `test/unit/link-access.test.ts`.

## Вне скоупа

- Перемены, сделанные мимо приложения: `claude plugin uninstall` или `disable` в Terminal-е,
  пересборка Stable copy — установленной копии worfy, в которой работает владелец
  (`pnpm install:stable`). Окно узнаёт о них при следующем чтении; слежения за `~/.claude` этот
  Ticket не добавляет.
- Строки и вид экрана First run; раздел Settings → Health — Ticket worfy-ui/06.
- Тексты подсказок элемента toolbar — их правит Ticket worfy-windows/46 (убирает имя скрипта
  `gate.sh` из текстов и Profile-ов).
- Остальные находки прогона 2026-10-14 — свои Ticket-ы.

## Риски

- Событие может прийти, пока элемент ждёт ответа на собственную установку (`busy`). Элемент
  показывает состояние, которое пришло последним, и текст «Installing Harness…» не сменяется
  старым. Test — в «Тесты».
- `HarnessStatus.tsx` и `FirstRun.tsx` правят два незакрытых Ticket-а: worfy-ui/06 (open) выносит
  тело First run в `FirstRunChecks.tsx`; worfy-windows/46 (blocked) меняет тексты в
  `HarnessStatus.tsx`. Перед claim сверить открытые PR.
- Канал `local`: клиент Linked machine (другая машина, связанная с этой) такие события отбрасывает,
  как `appSettings.changed` (`src/main/ipc/app-settings.ts:3-4`). Это верно: Harness ставится на той
  машине, где открыто окно.
- Новая проверка — e2e. Job `check` в CI гоняет `pnpm lint`, `pnpm typecheck` и `pnpm test`; e2e в
  нём нет (`.github/workflows/ci.yml:24-58`, команды — `:43-49`). e2e идут в gate full на Mac.
  Красный e2e CI не покажет.

## Итог

PR #563, merge 7fb1626a. Mac gate full зелёный (с `GH_TOKEN` снятым и настоящим HOME), Windows run по
harness-changed, harness-status, shell и focus-mode — зелёный.

- Два новых события, доступ `local`, рассылка во все окна (`toEveryWindow`, как `appSettings.changed`):
  `harness.changed` — после каждой установки с ответом `done`, в том числе с экрана первого запуска
  (`firstRun.run`); `harnessMigration.changed` — после переноса с ответом `done`, с новым предложением.
- `HarnessStatus` подписан на оба события. Во время своей установки держит «Installing Harness…» до
  своего ответа; событие, пришедшее раньше первого ответа `harness.state`, побеждает старый ответ
  (guard-ы `heard`). Если моста preload нет или в нём нет событий, подписка ловит ошибку и пишет
  `console.error` вместо падения toolbar — так же, как `useLimits`, `useTerminalAi`, `CardNode`.
- Test-ы: новый `test/contract/harness-changed.test.ts` (два окна, до правки 7 из 12 красные), unit
  `harness-status.test.tsx` (+10, включая мост без событий и без моста), e2e в `first-run.spec.ts` и
  `harness-migrate.spec.ts`. Восемь мутантов — все красные.
- Первый gate full был красным: 44 unit-test-а в 8 файлах монтируют shell или toolbar с неполным мостом,
  и новая подписка бросала исключение. Исправлено в раунде правок (try/catch выше). Урок: подписка в
  renderer — прогнать test-ы shell и toolbar, а не только файлы рядом с правкой.
- Попутно найдено: test checks handler в `github-prs.test.ts` красный под временным HOME и печатает
  настоящий token, если задан `GH_TOKEN`. Не связан с этим PR — Ticket 56.
