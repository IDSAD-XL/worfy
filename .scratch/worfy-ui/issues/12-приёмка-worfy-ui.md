# 12 — Приёмка Epic-а worfy-ui по «Готово, когда»

Type: task
Status: blocked — в Ticket-е шаги владельца: ручные проверки ускорителей меню на Stable copy и просмотр снимков; Autopilot его не берёт. Orchestrator ставит `open`, когда 01–11 влиты и владелец за Mac-ом
Blocked by: 01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 13
Source: «Готово, когда» Epic-а worfy-ui ([spec.md](../spec.md), «Цель»; подтверждено владельцем 2026-10-09); решения владельца 2026-10-09, 1–9 ([spec.md](../spec.md), «Решения владельца»); [ADR-0056](../../../docs/adr/0056-windows-checks-and-two-sessions.md) (проверка на Windows-ПК); [roadmap.md](../../../docs/roadmap.md), раздел «worfy-ui — интерфейс и настройки»

## Что происходит

- К claim Ticket-ы 01–11 влиты, у каждого свои test-ы и снимки. Целиком, на одной сборке, Epic
  никто не проверял.
- Ускорители меню Playwright не нажимает: e2e зовут пункты меню по id через `clickMenuItem`
  (`test/e2e/menu.ts` Ticket-а 02).
  Cmd/Ctrl+,, ⌥⌘= / ⌥⌘− / ⌥⌘0, Cmd/Ctrl+B и Cmd/Ctrl+/ проверяет только человек (spec, риск 1).
- Снимки в двух темах снимает `snapshotThemes` (`test/e2e/snapshots.ts:36`) на окне `launchApp`
  (`test/e2e/helpers.ts:120`) с временной папкой данных.
- В `docs/design/F-SPEC.md` разделов окна Settings, секций боковой панели, Select и окна Keyboard
  shortcuts нет: Ticket-ы 02–11 описали вид у себя (spec, «Соглашения»).
- Stable copy ставит `pnpm install:stable` (`scripts/install-stable.sh`); пересобирается она вне
  прогона Autopilot.
- worfy на Windows-ПК владельца появляется с приёмкой Epic-а worfy-windows. `Blocked by` держит
  только Ticket-ы своего Epic-а, поэтому ожидание Windows — в Status.

## Что делаем

1. **Сквозной e2e** — `test/e2e/worfy-ui-acceptance.spec.ts` (новый): один сценарий на `launchApp`
   с временной папкой данных — Settings (`clickMenuItem`), масштаб 120 %, свернуть Sessions, режим
   фокуса с боковой панелью, спрятать её в режиме фокуса, палитра с группами, Select модели,
   ползунок effort, окно Keyboard shortcuts; перезапуск над той же папкой — масштаб, свёрнутость и
   видимость панели на месте. Каждый шаг — снимок в светлой и тёмной теме; копии — в
   `../evidence/12-*.png`, их список и замечания владельца — `../evidence/12-приёмка.md`. Снимки — только
   с окон `launchApp`: живую Stable copy и окно владельца не снимать.
2. **F-SPEC** — разделы «Settings», «Sidebar sections», «Select» и «Keyboard shortcuts» в
   `docs/design/F-SPEC.md` по «Итог» Ticket-ов 02–11 и снимкам пункта 1. Язык F-SPEC — английский,
   как у соседних разделов. В правило «цвет статуса — с подписью или иконкой» (`F-SPEC.md:40`)
   вносится исключение для точки Machines (Ticket 05, по просьбе владельца).
3. **Шаги владельца** — на Stable copy с влитыми 01–11 (`pnpm install:stable`, вне прогона
   Autopilot); пункты «Готово, когда» ниже.
4. Найденный дефект — новый Ticket Epic-а, его номер дописывается в `Blocked by` этого.
5. Mac пройден, а Epic worfy-windows ещё не принят — Ticket снова `blocked` с причиной «ждёт Epic
   worfy-windows». После его приёмки — проверки на Windows-ПК.
6. В `.scratch/worfy-ui/spec.md` отмечаются пункты «Готово, когда» Epic-а со ссылкой на «Итог» этого
   Ticket-а.

**Не входит:** новые функции.

## Готово, когда

**Mac.**

- [ ] e2e `test/e2e/worfy-ui-acceptance.spec.ts` зелёный в `GATE_SCOPE=all gate.sh full`; снимки —
  в `../evidence/12-*.png`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `GATE_SCOPE=all` gate full — строка
  `[gate]` и код выхода в «Итог».
- [ ] Разделы F-SPEC написаны.
- [ ] (вручную, владелец) Stable copy: ⌘, открывает Settings на Canvas, в Session, в режиме фокуса,
  в поле ввода Session и при фокусе в Terminal Node. Как проверить: окно worfy.
- [ ] (вручную, владелец) ⌥⌘= / ⌥⌘− / ⌥⌘0 меняют масштаб везде (если в системных настройках macOS
  включено «Use keyboard shortcuts to zoom», ⌥⌘= и ⌥⌘− забирает системная лупа — spec, риск 11); ⌘= /
  ⌘− на Canvas масштабируют только Canvas; масштаб переживает перезапуск Stable copy; кнопки окна —
  по центру toolbar на 80 % и 150 %. Как проверить: окно worfy.
- [ ] (вручную, владелец) ⌘B прячет и показывает боковую панель в обычном виде и в режиме фокуса,
  каждый вид помнит своё; ⌘/ и «?» открывают окно Keyboard shortcuts. Как проверить: окно worfy.
- [ ] (вручную, владелец) пульсация точки Machines при связанной Linked machine заметна и не
  отвлекает; с «Reduce motion» в системных настройках macOS — точка без пульсации. Как проверить:
  окно worfy.
- [ ] Владелец посмотрел снимки `../evidence/12-*.png` и его замечания записаны в
  `../evidence/12-приёмка.md` и в «Итог».

**Windows: после приёмки Epic-а worfy-windows.**

- [ ] (вручную) Windows-ПК: Ctrl+, Ctrl+Alt+= / Ctrl+Alt+- / Ctrl+Alt+0, Ctrl+B, Ctrl+/ работают;
  подписи в окне Keyboard shortcuts и в меню — с Ctrl.
- [ ] (вручную) Windows-ПК: внутри Terminal Node Ctrl+B и Ctrl+/ уходят в оболочку, вне Terminal —
  прячут панель и открывают окно сочетаний (решение владельца, spec, риск 5); в поле ввода Session
  AltGr-символы раскладки печатаются (spec, риск 4).
- [ ] Windows-ПК: gate full — строка вердикта и код выхода в «Итог».

## Тесты

Сквозной e2e пишется без «сначала падающего test-а»: к claim всё, что он проверяет, уже влито. Если
он падает — дефект одного из Ticket-ов 01–11, новый Ticket (пункт 4 «Что делаем»).

## Где в коде

- `test/e2e/worfy-ui-acceptance.spec.ts` (новый)
- `docs/design/F-SPEC.md`
- `.scratch/worfy-ui/spec.md`
- `.scratch/worfy-ui/evidence/12-приёмка.md` (новый)

## Итог

Заполняется при закрытии.
