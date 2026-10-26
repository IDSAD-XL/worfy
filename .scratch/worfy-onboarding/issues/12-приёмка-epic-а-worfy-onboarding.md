# 12 — Приёмка Epic-а worfy-onboarding с владельцем: новый пользователь macOS и Windows-ПК

Type: task
Status: open
Blocked by: 01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11
Source: «Готово, когда» Epic-а worfy-onboarding ([spec.md](../spec.md)); решения владельца 2026-10-26, пункты 1–8; [ADR-0056](../../../docs/adr/0056-windows-checks-and-two-sessions.md), пункт 2 (платформенная часть — на Windows-ПК владельца)

## Что происходит

- К claim Ticket-ы 01–11 влиты, у каждого свои test-ы. Ход Ticket-а demo с настоящими агентами test-ы
  не проверяли: в e2e Stage-ы двигает test, агенты — fake (соглашения spec-а, «Без токенов в
  test-ах»).
- Новый пользователь — это свежая папка данных worfy и Claude Code с входом, но без Project-ов в worfy.
  Папку данных задаёт `WORFY_DATA_DIR` (`src/main/storage/paths.ts:35`); на macOS проще всего — новый
  пользователь ОС, на нём же видно, что demo встаёт в его домашнюю папку.
- Проход demo тратит токены владельца (пункт 5) — по одному проходу на машину, в режиме «Sonnet — a
  bit cheaper», если владелец не скажет иначе.
- Приёмка — не в Autopilot: её ведёт владелец вместе с Orchestrator-ом.

## Что делаем

1. Stable copy из `origin/main` с влитыми 01–11 (`pnpm install:stable`), Harness обновлён из неё.
2. **macOS, новый пользователь ОС** — владелец проходит пять пунктов «Готово, когда» Epic-а, Orchestrator
   ведёт записи и снимки в `../evidence/12-*.png`.
3. **macOS, существующий пользователь** (папка данных владельца с Project-ами) — уведомление и его
   «Not now».
4. **Windows-ПК владельца** — те же пункты 1, 2, 4, 5 на свежей папке данных; вердикт gate full на ПК.
5. Найденный дефект — новый Ticket Epic-а, номер дописывается в `Blocked by` этого.
6. Риск 1 spec-а: записать, нашло ли ревью проблему на каждой машине (REJECTED или запасной путь).
7. Отмечает пункты «Готово, когда» в `spec.md` со ссылкой на «Итог».

Не входит: новые функции.

## Готово, когда

**macOS, новый пользователь ОС.**

- [ ] (вручную) First run открылся сам: «Welcome to worfy», три понятия, «Next» — проверки, «Start
      Getting started» — раздел первым в боковой панели, шаг 1 отмечен (проверки без `fail`).
- [ ] (вручную) «Create demo project» — `~/worfy-demo`, Project в боковой панели, Canvas с Epic `todo`
      и Ticket-ом 01; шаг 2 отмечен. Переключатель стоит на «Sonnet — a bit cheaper».
- [ ] (вручную) «Open the Orchestrator» — готовый вопрос, отправлен, ответ пришёл; шаг 3 отмечен.
- [ ] (вручную) «Ship the ticket» — исполнитель работает в worktree, Pipeline показывает Stage-ы,
      подсказки каждого Stage-а пришли один раз; ревью — REJECTED и круг доработки, или «This time
      the review found nothing» и пример; шаги 4–6 отмечены; Status Ticket-а `done`, merge в `main`
      demo (`git -C ~/worfy-demo log --oneline -3`).
- [ ] (вручную) Экран Done: «Connect your own project» открывает «Add project»; «Remove the demo
      project» — подтверждение, после него нет папки, Project-а в списке и Profile-а
      (`ls ~/.claude/worfy-harness/projects` без `worfy-demo`).
- [ ] (вручную) «Skip» скрывает раздел, Command palette «Getting started» возвращает его.
- [ ] (вручную) Нигде нет модального окна, кроме существующего First run и подтверждения удаления.

**macOS, существующий пользователь.**

- [ ] (вручную) Обновление на папке данных с Project-ами: раздел не открылся сам; уведомление в углу
      «New: Getting started…»; «Not now» — после перезапуска его нет.

**Linked machine.**

- [ ] (вручную) dev-сборка и Stable copy связаны (worfy-link), доступ включён: Project-а demo нет в
      боковой панели второй копии.

**Windows-ПК владельца.**

- [ ] (вручную) Свежая папка данных: First run → Getting started → demo в `C:\Users\<имя>\worfy-demo`
      (не в `%TEMP%`) → проход до Done → удаление, папки нет.
- [ ] gate full на ПК на коммите приёмки — код 0 и строка `[gate] green (full)`.

**Записи.**

- [ ] «Итог»: на каждой машине — нашло ли ревью проблему, сколько длился проход, что владелец попросил
      поменять в текстах.
- [ ] Пункты «Готово, когда» Epic-а отмечены в `spec.md`.

## Тесты

- Новых test-ов нет: проверки — вручную и gate full. Найденный дефект получает test в своём Ticket-е.

## Где в коде

- `.scratch/worfy-onboarding/spec.md` — отметки «Готово, когда»
- `.scratch/worfy-onboarding/evidence/` (новая) — снимки

## Итог

Заполняется при закрытии.
