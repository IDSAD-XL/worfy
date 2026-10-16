# 19 — Переключатель «Keep this computer awake» неактивен, пока доступ к Project-ам выключен

Type: task
Status: claimed — 2026-10-16
Branch: worfy-link/19
Blocked by: —
Source: решение владельца 2026-10-12 («изменить») по пункту «решено без владельца» Ticket-а [14](14-машина-project-а-не-засыпает-статус-спит.md) (`:145-147`, долг ревью PR #167).

## Что происходит

В боковой панели, в секции Machines, под списком Linked machines стоят два переключателя
(`src/renderer/shell/sidebar/MachinesSection.tsx:244-245`):

- «Linked machines can work with my Projects» — доступ к Project-ам этой Machine;
- «Keep this computer awake while linked machines are connected» — не давать компьютеру уснуть.

Сон запрещается, только когда верны три условия сразу: доступ включён, переключатель «Keep awake»
включён и хотя бы одна Linked machine подключена (`src/main/link/keep-awake.ts:53-56`, `wanted()`).

- Сейчас переключатель «Keep awake» неактивен только когда нет ни одной Linked machine
  (`disabled={noMachine}`, `MachinesSection.tsx:245`). При выключенном доступе он остаётся активным и
  может показывать «включено», хотя сон при этом не запрещается: пользователь видит обещание,
  которое не выполняется.
- Ticket 14 записал это как решение без владельца; владелец решил изменить.

## Что делаем

1. Переключатель «Keep this computer awake…» неактивен (`disabled`), пока доступ выключен, — так же,
   как сейчас при отсутствии Linked machines. Сохранённое значение настройки `keepAwake` при этом
   не меняется: включат доступ — переключатель снова активен и показывает прежнее значение.
2. Что он показывает в неактивном состоянии — решить и записать в «Итог». Рекомендация: положение
   «выключено» (сон сейчас не запрещается), а не сохранённое значение; подсказка (`title`) говорит,
   почему он неактивен: «Turn on "Linked machines can work with my Projects" first».
3. Правило `wanted()` в main не меняется.

4. **Подсказка под переключателем доступа** (владелец решил 2026-10-13, ADR-0060): одна строка «Work
   already started from a Linked machine keeps running» — в разделе Machines боковой панели
   (`src/renderer/shell/sidebar/MachinesSection.tsx`), под переключателем «Linked machines can work
   with my Projects». Видна всегда, а не только после выключения.

**Вопрос владельцу — отвечен 2026-10-13: нет.** Строка-подсказка о том, что без включённого доступа
«Keep awake» не действует, не нужна: неактивный переключатель говорит то же самое.

## Готово, когда

- [x] Под переключателем доступа стоит строка «Work already started from a Linked machine keeps
      running»; test на её текст.
- [x] Доступ выключен, Linked machine есть: переключатель «Keep awake» неактивен, нажатие ничего не
      меняет, `setKeepAwake` не вызывается; подсказка называет причину.
- [x] Доступ включают: переключатель активен и показывает сохранённое значение `keepAwake`.
- [x] Доступ выключают при включённом «Keep awake»: сохранённое значение не сбрасывается (после
      включения доступа переключатель снова «включено»).
- [x] Нет Linked machines: оба переключателя неактивны, как раньше (уточнено в «Итог»: «как раньше» — без этой Machine).
- [x] Снимки секции в светлой и тёмной теме — доступ выключен и доступ включён — в
      `.scratch/worfy-link/evidence/`.
- [x] `docs/design/F-SPEC.md`: если секция Machines там описана — состояние переключателя добавлено.
- [x] Test краснеет на мутанте, который возвращает `disabled={noMachine}`.

## Где в коде

- `src/renderer/settings/MachinesSection.tsx` — оба переключателя (`:38-42`): с `worfy-ui` 05
  (PR #296) они в окне Settings → Machines, а не в боковой панели
  (`src/renderer/shell/sidebar/MachinesSection.tsx` переключателей больше не содержит).
- `src/renderer/settings/controls.tsx` — `SettingSwitch` без `title`: подсказка о причине неактивного
  переключателя требует этого свойства; `SettingRow` получает `disabled` (приглушённая строка).
- `src/renderer/settings/settings.css` — заметный вид неактивной строки и неактивного выключенного
  переключателя (круг доработки PR #397).
- `test/unit/machines-section.test.tsx` — test секции (завёл `worfy-ui` 05).
- `test/e2e/linked-sleep.spec.ts` и `test/e2e/linked-machines.spec.ts` — оба включают или проверяют
  «Keep awake» на свежей Machine с выключенным доступом.
- `docs/design/F-SPEC.md`.
- `.scratch/worfy-link/evidence/19-*.png` — снимки.

## Вне скоупа

- Правило запрета сна (`src/main/link/keep-awake.ts`) и Autopilot (`src/main/autopilot/power.ts`).
- Перенос переключателей в окно Settings — `worfy-ui` 05.

## Риски

- `src/renderer/shell/sidebar/MachinesSection.tsx` правит и открытый Ticket `worfy-ui` 05 (точка и
  переключатели Machines в Settings; он же заводит `test/unit/machines-section.test.tsx` и
  `src/renderer/settings/MachinesSection.tsx`). Эти два Ticket-а не идут параллельно: второй по
  порядку мержа делает rebase и переносит правило неактивного переключателя в новое место.

## Итог

**Сделано (ветка `worfy-link/19`).** Переключатели — в окне Settings → Machines
(`src/renderer/settings/MachinesSection.tsx`), а не в боковой панели: их перенёс `worfy-ui` 05 (PR #296).

- Под переключателем доступа — строка «Work already started from a Linked machine keeps running»
  (ADR-0060). Это `description` общего `SettingRow` — второй строкой, 12 px вторичным цветом. Видна
  всегда: и при выключенном, и при включённом доступе.
- «Keep this computer awake…» неактивен, пока доступ выключен (как и без этой Machine). Правило
  `wanted()` в `src/main/link/keep-awake.ts` не менялось. Сохранённое значение `keepAwake` секция не
  трогает: ни выключение доступа, ни нажатие на неактивный переключатель `link.setKeepAwake` не
  вызывают.
- **Что показывает неактивный переключатель — решено без владельца, подтвердить.** Выбрана
  рекомендация Ticket-а: положение «выключено» (сон сейчас не запрещается), а не сохранённое значение.
  Включат доступ — переключатель снова активен и показывает сохранённое значение (на свежей Machine —
  «включено»). Подсказка (`title`, её же screen reader читает как описание): «Turn on "Linked machines
  can work with my Projects" first». Без этой Machine (link service не запущен) подсказки нет:
  включение доступа там не помогло бы, неактивен и сам переключатель доступа.
- `SettingSwitch` (`src/renderer/settings/controls.tsx`) получил необязательное свойство `title`:
  без него подсказку некуда поставить.
- **Пункт «Нет Linked machines: оба неактивны, как раньше» — посылка неточна; прочтение «как
  раньше = без этой Machine» решено без владельца, подтвердить.** Ни раньше, ни теперь
  переключатели не зависят от числа Linked machines: `noMachine` — это «нет этой Machine»
  (`state.machine == null`, link service не запущен). Так и осталось: без этой Machine оба неактивны
  (test «without this Machine both switches are disabled…»). Доступ нужно уметь включить до первой
  связи, поэтому делать его неактивным без Linked machines нельзя.
- `docs/design/F-SPEC.md`: окна Settings и секции Machines там нет (`grep -i "settings\|keep awake"`
  — только Confirm dialog первого запуска и чипы Machine у Autopilot). Описывать нечего, раздел не
  заводился.

**Test-ы.**

- `test/unit/machines-section.test.tsx`: строка-подсказка в строке доступа при выключенном и
  включённом доступе, одна; доступ выключен, Linked machine есть — keep-awake неактивен, «выключено»,
  `title` с причиной, клик не вызывает main; доступ включили — активен и «включено»; выключили —
  снова неактивен, а `link.setKeepAwake` не вызывался; включили ещё раз — «включено»; без этой
  Machine — неактивен без подсказки. Старые test-ы секции, которые щёлкали keep-awake на свежем
  состоянии (доступ выключен), теперь начинают с включённого доступа.
- Мутант `disabled={noMachine}` у keep-awake (на копии, восстановлен, `cmp` совпал): красные 2 test-а
  из 19 — «access off, a Linked machine online…» и «access switched on…». Мутант, который заодно
  возвращает `checked={keepAwake}`, — те же 2 красных.
- e2e (`pnpm test:e2e test/e2e/linked-machines.spec.ts test/e2e/linked-sleep.spec.ts`, под замком
  `/tmp/worfy-e2e.lock`): 11 из 11 зелёные. `linked-machines.spec.ts` на свежей Machine проверяет
  неактивный keep-awake с `title`, строку-подсказку и активный keep-awake после включения доступа;
  `linked-sleep.spec.ts` перед выключением keep-awake сначала включает доступ.

**Круг доработки PR #397** (verifier: неактивный keep-awake на снимках не отличался от активного
выключенного переключателя доступа — был только `opacity: 0.5`).

- Неактивность теперь видна в обеих темах. `SettingRow` получил `disabled` и ставит `data-disabled`.
  Подпись и подсказка такой строки — цветом `--text-muted` (`settings.css`). Неактивный выключенный
  переключатель рисуется пунктирной рамкой без заливки дорожки, бегунок — плоский, цвета
  `--border-strong`, без тени, при полной непрозрачности: при `opacity: 0.5` пунктир в тёмной теме
  почти пропадал. Неактивный включённый переключатель (бывает только у доступа без этой Machine)
  остаётся прежним — `opacity: 0.5`.
- `cursor: not-allowed` не добавлен: в renderer его нет нигде, все элементы управления используют
  `cursor: default`, как в macOS.
- Test-ы: unit «the row of the disabled keep-awake switch is marked disabled…» — `data-disabled` у строки
  keep-awake при выключенном доступе, нет — при включённом, у обеих строк — без этой Machine. Мутанты на
  копиях, восстановлены с `cmp`: убрать `disabled` у строки keep-awake в `MachinesSection.tsx` — 1 красный
  из 20; убрать `data-disabled` в `SettingRow` — 1 красный из 20. e2e на свежей Machine сравнивает
  вычисленный стиль: у keep-awake рамка `dashed`, у доступа `solid`, цвет подписей разный. Мутант без
  нового CSS-правила — этот e2e красный («Expected: "dashed", Received: "solid"»).
- `linked-sleep.spec.ts`: после перезапуска проверяется `toBeEnabled()` до `aria-checked=false`.
- `linked-machines.spec.ts`: «щелчок по тексту подписи ничего не переключает» — теперь по подписи
  доступа (он активен), не по подписи неактивного keep-awake.
- e2e обоих spec-ов: 11 из 11 зелёные, снимки пересняты.

**Снимки** (Playwright, свежая Machine, окно Settings → Machines; пересняты в круге доработки):

- [доступ выключен, светлая](../evidence/19-access-off-light.png),
  [тёмная](../evidence/19-access-off-dark.png): под «Linked machines can work with my Projects» —
  вторичным текстом «Work already started from a Linked machine keeps running». Доступ: обычный
  выключенный переключатель — залитая серая дорожка, белый (в тёмной — тёмный) бегунок с тенью, подпись
  основным цветом. Keep-awake: подпись заметно светлее (в тёмной — темнее) подписи доступа,
  переключатель — пунктирный контур без заливки с плоским серым бегунком. Разница видна в обеих темах.
- [доступ включён, светлая](../evidence/19-access-on-light.png),
  [тёмная](../evidence/19-access-on-dark.png): оба переключателя включены (синие в светлой теме,
  салатовые в тёмной), строка-подсказка на месте.
- Подсказку `title` снимок страницы не показывает (это нативный tooltip); её проверяют unit- и
  e2e-test.
