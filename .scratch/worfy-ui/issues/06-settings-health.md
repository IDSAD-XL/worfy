# 06 — Settings → Health: проверки First run в окне Settings

Type: task
Status: claimed — 2026-10-13
Blocked by: 02
Source: решение владельца 2026-10-09: 2 (раздел Health окна Settings — проверки First run; First run при первом запуске остаётся) ([spec.md](../spec.md), «Решения владельца», пункт 2; «Пересечения», worfy-windows 13 и 15); [ADR-0052](../../../docs/adr/0052-machines-and-linking.md), пункт 6 (каналы `firstRun.*` — `local`)

## Что происходит

- Проверки здоровья worfy — экран First run: `src/renderer/shell/FirstRun.tsx:190`, заголовок
  «First run» (`:263`), «Check again» (`:294`). Вид и правила — `docs/design/F-SPEC.md:98-116`:
  диалог поверх окна, строка проверки — chip статуса, имя, найденное, кнопки; под ней hint и
  команда с «Copy».
- Открывается он:
  - сам при старте, когда main просит (`askAtStartup`, `src/renderer/shell/first-run-store.ts:54`);
  - пунктом палитры «First-run checks», группа View (`src/renderer/palette/commands.ts:184-193`);
  - кнопками «First-run checks…» в подключении Project-а (`src/renderer/projects/ConnectProject.tsx:555`)
    и во входе в GitHub (`src/renderer/projects/GithubAccount.tsx:216`).
- State — zustand-store `useFirstRun` (`first-run-store.ts:17`): открыт ли экран, отчёт, идёт ли
  проверка, ошибка.
- Каналы — `firstRun.checks` (`src/shared/ipc/first-run.ts:80`), `firstRun.run` (`:88-89`),
  `firstRun.close` (`:105`), все `local`. `firstRun.close` пишет отметку `first-run.json`
  (`src/main/ipc/first-run.ts:7`, `:147`): по ней First run больше не открывается сам.
- Ticket-ы 13 и 15 worfy-windows (открыты) добавляют проверки в `src/main/first-run/checks.ts`.
  `src/renderer/shell/FirstRun.tsx` Ticket 13 правит, только если экран не рисует новую проверку
  (`.scratch/worfy-windows/issues/13-первый-запуск-на-windows.md:184-185`); группы проверок заданы
  списком `GROUPS` (`FirstRun.tsx:26`) и схемой `checkGroupSchema`
  (`src/shared/ipc/first-run.ts:38`).
- После Ticket-а 02 есть окно Settings и разделы по файлам `src/renderer/settings/*Section.tsx`.

## Что делаем

1. **Тело First run** — список проверок со статусами, hint-ами, командами, «Copy», действиями
   с подтверждением и «Check again» — выносится в `src/renderer/shell/FirstRunChecks.tsx` (новый).
   Диалог First run показывает его, как сейчас: при старте, по палитре и по кнопкам — поведение не
   меняется.
2. **Раздел Health** — `src/renderer/settings/HealthSection.tsx` (новый, `order` 20, `title`
   «Health») показывает тот же список. Открытие раздела запускает проверку (`firstRun.checks`);
   «Check again» — ещё раз; действия — те же, через `firstRun.run` с подтверждением.
3. **Закрытие Settings не пишет отметку** `first-run.json`: её пишет только закрытие диалога First
   run (`firstRun.close`).
4. Отчёт и ход проверки — общие с диалогом (`useFirstRun`): проверка, запущенная в одном месте,
   видна в другом.
5. Список `GROUPS` уходит вместе с телом в `FirstRunChecks.tsx`. Если к claim Ticket 13
   worfy-windows открыт и правит `FirstRun.tsx` — сверка по правилу spec-а («Пересечения»); влитый
   после этого Ticket 13 правит уже `FirstRunChecks.tsx`, об этом — запись в «Итог».

Решено в Ticket-е, подтверждено владельцем 2026-10-09: пункт палитры «First-run checks» по-прежнему открывает
диалог First run, а не Settings → Health.

**Не входит:** новые проверки (worfy-windows 13 и 15); изменение вида строк First run; отдельные
каналы для Health.

## Готово, когда

- [x] Unit `test/unit/settings-health.test.tsx` (новый): раздел показывает строки отчёта
  `firstRun.checks` (имя, статус, найденное); «Check again» зовёт `firstRun.checks` ещё раз; действие
  идёт через подтверждение и `firstRun.run`; закрытие Settings не зовёт `firstRun.close`.
- [x] e2e `test/e2e/settings-health.spec.ts` (новый): Settings → Health показывает те же проверки,
  что диалог First run (по именам строк); если отметки `first-run.json` не было, после закрытия
  Settings её в папке данных по-прежнему нет. Снимки `settings-health` в светлой и тёмной теме.
- [x] e2e `test/e2e/first-run.spec.ts` зелёный без правок: диалог First run не изменился.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `GATE_SCOPE=all` gate full локально —
  exit 0.
  Первая половина сделана: `pnpm lint && pnpm typecheck && pnpm test` — exit 0, gate fast — см. «Итог».
  не проверено: gate full — шаг Orchestrator-а перед мержем, после rebase на main с Ticket-ом 03
  (до него красный `test/e2e/settings.spec.ts:66-71`, см. «Итог», «Известный красный e2e»).

## Тесты

Сначала падающий test — unit «раздел Health показывает строки отчёта»: раздела нет. Вынос тела —
под защитой `test/e2e/first-run.spec.ts`, он не меняется. В «Итог» — как падал первый test.

## Где в коде

- `src/renderer/shell/FirstRun.tsx`
- `src/renderer/shell/FirstRunChecks.tsx` (новый)
- `src/renderer/settings/HealthSection.tsx` (новый)
- `test/unit/settings-health.test.tsx` (новый)
- `test/e2e/settings-health.spec.ts` (новый)

## Итог

Код готов, ветка `worfy-ui/06`. Закрывает Ticket Orchestrator после мержа.

**Что сделано.**

- `src/renderer/shell/FirstRunChecks.tsx` (новый) — тело First run: группы `GROUPS`, строки с chip-ом
  статуса, именем, найденным, hint-ом, командой и «Copy», кнопки действий, «Check again», chip
  итога, форма переноса старого Harness. Компонент `FirstRunChecks` отдаёт эти части функции
  `children` (`summary`, `list`, `message`, `checkAgain`, `running`, `migrating`), а раскладывает их
  тот, кто показывает: диалог и раздел выглядят по-разному, код один.
- `src/renderer/shell/FirstRun.tsx` — теперь только диалог вокруг этих частей. Разметка,
  `data-testid`, тексты и поведение те же; `test/e2e/first-run.spec.ts` зелёный без правок.
- `src/renderer/settings/HealthSection.tsx` (новый, `order` 20, `title` «Health») — те же части в
  окне Settings: сверху, не уезжая при прокрутке, строка-пояснение, chip итога, результат последнего
  действия и «Check again»; ниже группы со строками. `settings.css` не тронут: стили — inline, как у
  First run. Реестр разделов не правился: `sections.ts` нашёл файл сам.

**Правила, которых не было в «Что делаем», но без которых раздел ломает диалог.**

1. *Отчёт в store живёт, только пока его кто-то показывает.* `openFirstRun` проверяет заново, только
   если отчёта нет, а закрытие диалога отчёт стирает. Раздел Health уходит с экрана без этого
   закрытия, и оставленный им отчёт диалог потом показал бы без новой проверки. Поэтому
   `FirstRunChecks` стирает отчёт, когда его не показывают ни диалог, ни раздел; идущую проверку и
   идущее действие он сначала дожидается. Store (`first-run-store.ts`) не правился.
2. *Идущее действие — общее и переживает раздел.* Диалог не закрывается, пока действие идёт, а окно
   Settings закрыть можно, и раздел уходит при смене раздела. Действие (`firstRun.run`: установка
   plugin-а, загрузка моделей — минуты) хранится вне React, в `FirstRunChecks.tsx`: вернувшийся
   раздел показывает «Running…», кнопки неактивны, второе действие и проверка под первым не
   стартуют; диалог под окном Settings тоже заперт и не закрывается. main второе действие под первым
   отклоняет ошибкой «another action is running» (`src/main/first-run/actions.ts:118`); без общего
   состояния вернувшийся раздел показывал бы активные кнопки и эту ошибку вместо «Running…».
3. *Раздел сам просит проверку*: при появлении на экране и когда отчёта нет, а ничего не идёт
   (проверку, начатую для уже закрытого диалога, store отбрасывает). Проверку, которая не смогла
   пройти, раздел сам не повторяет — только по «Check again».
4. *Подтверждённый вход в GitHub* из Health открывает Terminal Node и закрывает окно Settings
   (`closeSettings`), а не First run: отметка не пишется.

**Файл вне исходного следа: `src/renderer/harness/MigrationForm.tsx`** (разрешено Orchestrator-ом
2026-10-13). Действие «Move…» строки «Old Harness in ~/.claude» открывает форму переноса. Её
подложка — portal в `body` со слоем 100, окно Settings — слой 110 (`SETTINGS_LAYER`): открытая из
Health, форма оказывалась под окном, и modal guard окна забирал у неё фокус. Правка — один
необязательный prop `layer?: number` (z-index подложки, по умолчанию прежние 100; остальным
вызывающим ничего не меняется). Health передаёт `SETTINGS_LAYER + 10` — от константы окна, не
числом. Отвергнутый вариант Б: по «Move…» закрывать окно Settings, рисовать форму из всегда
смонтированного `FirstRun.tsx` и после неё открывать Settings → Health заново — окно мигает, кода
больше, а `settings-window.ts:75` прямо предполагает, что диалог раздела рисуется выше окна.

Одного слоя мало: guard окна оставляет клавиши и фокус слою выше себя, только пока фокус в нём.
Поэтому форма над окном Settings (и только над ним — в First run всё как было) держит клавиатуру
сама: фокус входит в форму при открытии, возвращается в неё, когда форма перерисовалась после ответа
main, Tab и Shift+Tab ходят по кругу внутри формы, Esc закрывает форму, а не окно, фокус после
закрытия — на «Move…». Клавиши из формы до обработчика окна Settings не доходят (React передаёт их
по своему дереву, а не по DOM).

**Test-ы.**

- Сначала падающий test — unit, весь файл: `Error: src/renderer/settings/HealthSection.tsx is not
  among the sections`, 15 из 15 красные (раздела нет).
- `test/unit/settings-health.test.tsx` — 18 test-ов: раздел и его место после General, строки
  отчёта, «Check again», действия через `firstRun.run`, закрытие Settings без `firstRun.close`, общий
  с диалогом отчёт, проверка и действие, правила 1–4, слой и клавиатура формы переноса. main —
  поддельный preload bridge; настоящий Claude Code не запускается.
- `test/e2e/settings-health.spec.ts` — 2 test-а на собранном приложении в песочнице First run:
  те же 13 строк в Health и в диалоге; после закрытия Settings отметки `first-run.json` нет, после
  «Close» диалога — есть; «Move…» из Health открывает форму поверх окна, фокус в форме, Esc закрывает
  форму и оставляет окно.
- Mutation testing: 38 мутантов в `FirstRunChecks.tsx`, `HealthSection.tsx`, `FirstRun.tsx` и
  `MigrationForm.tsx`, все убиты unit-ом (в их числе «layer не передан из Health»). Два выживших
  первого прогона закрыты проверками: неактивный вид кнопок действий и то, что форма в First run
  фокус не забирает.
- Снимки: раздел — [светлая](../evidence/06-settings-health-light.png),
  [тёмная](../evidence/06-settings-health-dark.png); форма переноса над окном —
  [светлая](../evidence/06-settings-health-move-light.png),
  [тёмная](../evidence/06-settings-health-move-dark.png).

**Известный красный e2e до rebase.** `test/e2e/settings.spec.ts:66-71` на этой ветке красный: test
жмёт Tab один раз со строки General и ждёт фокус на «Close», что верно, только пока раздел один. Со
вторым разделом Tab попадает на строку Health (так окно и задумано). Этот test переписывает Ticket 03
— Tab по всем строкам разделов; после rebase на main с Ticket-ом 03 он должен стать зелёным без
правок файла. Файл в этом Ticket-е не правился. Вариант «одна остановка Tab на весь список разделов»
(roving tabindex) отвергнут Orchestrator-ом: поведение окна не меняем.

**Пересечение с worfy-windows 13 и 15.** На момент claim открытых PR, правящих `FirstRun.tsx`, не
было. `GROUPS` и строка проверки теперь в `src/renderer/shell/FirstRunChecks.tsx`: Ticket 13, если
экран не рисует его новую проверку, правит этот файл, а не `FirstRun.tsx`. Новые проверки и новые
группы из `src/main/first-run/checks.ts` попадают в Health без правок раздела.

**Вручную.**

- [ ] Вид раздела в запущенном приложении, путь к нему по ⌘, и строка Health с клавиатуры.
  не проверено: GUI-проверки в этой Wave — не implementer-а.
- [ ] Настоящее действие из Health (установка plugin-а, вход в GitHub) с настоящим диалогом macOS.
  не проверено: в test-ах диалог подменён в main, настоящий Claude Code не запускается.

**Долги (не блокируют).**

- В окне Settings столбец «найденное» узкий: панель 540 px против 720 px диалога, имя строки —
  190 px. Длинное найденное режется многоточием, целиком — в подсказке. Вид строк менять в этот
  Ticket не входило.
- `docs/design/F-SPEC.md`, раздел «First run», про Settings → Health не говорит; файл — в следе
  Ticket-а 12.
