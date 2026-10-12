# 19 — Переключатель «Keep this computer awake» неактивен, пока доступ к Project-ам выключен

Type: task
Status: open
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

- [ ] Под переключателем доступа стоит строка «Work already started from a Linked machine keeps
      running»; test на её текст.
- [ ] Доступ выключен, Linked machine есть: переключатель «Keep awake» неактивен, нажатие ничего не
      меняет, `setKeepAwake` не вызывается; подсказка называет причину.
- [ ] Доступ включают: переключатель активен и показывает сохранённое значение `keepAwake`.
- [ ] Доступ выключают при включённом «Keep awake»: сохранённое значение не сбрасывается (после
      включения доступа переключатель снова «включено»).
- [ ] Нет Linked machines: оба переключателя неактивны, как раньше.
- [ ] Снимки секции в светлой и тёмной теме — доступ выключен и доступ включён — в
      `.scratch/worfy-link/evidence/`.
- [ ] `docs/design/F-SPEC.md`: если секция Machines там описана — состояние переключателя добавлено.
- [ ] Test краснеет на мутанте, который возвращает `disabled={noMachine}`.

## Где в коде

- `src/renderer/shell/sidebar/MachinesSection.tsx` — переключатели (`:244-245`), `SectionSwitch` (`:113-135`).
- `test/unit/` — test секции Machines: на main `a995a59` отдельного test-а секции нет (`grep
  link-keep-awake-switch test` пуст); новый файл или тот, что заводит `worfy-ui` 05.
- `test/e2e/linked-sleep.spec.ts` — если e2e проверяет переключатель.
- `docs/design/F-SPEC.md`.

## Вне скоупа

- Правило запрета сна (`src/main/link/keep-awake.ts`) и Autopilot (`src/main/autopilot/power.ts`).
- Перенос переключателей в окно Settings — `worfy-ui` 05.

## Риски

- `src/renderer/shell/sidebar/MachinesSection.tsx` правит и открытый Ticket `worfy-ui` 05 (точка и
  переключатели Machines в Settings; он же заводит `test/unit/machines-section.test.tsx` и
  `src/renderer/settings/MachinesSection.tsx`). Эти два Ticket-а не идут параллельно: второй по
  порядку мержа делает rebase и переносит правило неактивного переключателя в новое место.

## Итог
