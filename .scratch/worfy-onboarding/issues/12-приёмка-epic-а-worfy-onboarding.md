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

2026-10-31: macOS-часть владелец прошёл и принял (решения владельца 2026-10-31, Q18). Windows-часть идёт
сейчас, с нынешним UI (раздел в боковой панели). Панель и подсветка — Ticket-ы 13 и 14 — принимаются
отдельно, не в этом Ticket-е.

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

### Windows-ПК владельца, 2026-10-31

**Проход.** Отдельная копия на свежей папке данных, запуск 02:20:54Z, без переменных `CLAUDE*`, `ANTHROPIC*`, `MCP_*`, `ELECTRON*`, stdout и stderr в файлы (о ticket-е 38 это ничего не говорит). Владелец прошёл First run, Getting started и demo до Done. Demo влил `e39ff7e Close ticket todo/01` в 02:26:55Z. Удаление завершено к 02:27:23Z: папки, Profile и записи Project-а нет. Проход длился около 6.5 минуты. Стоимость на последнем снимке $0.62, это не итоговая сумма.

**Ревью.** Reviewer не выдал строку вердикта: риск 1 spec-а наблюдался. Три находки `[low]`, две исправила Session Orchestrator-а, REJECTED не было.

**Тексты.** В сессии ПК владелец правок текстов не просил. Про шаг 5 ответил: «Да все норм, отработало как надо».

**Находки и решения.**
- Stop hook вернул exit 127 и задержал шаг 5: это worfy-windows 115, уже влит.
- Harness `773915d8`: факт, владелец сам нажал значок обновления в 04:22, отклонением не считается.
- Отдельного implementer-а не было: так устроен ship-ticket. Неверен текст шага 4, а не процесс; вопрос о формулировке идёт владельцу через Orchestrator-а.
- Шаг 1 отмечается за окном First run: наблюдение, по замыслу (`src/main/getting-started/progress.ts:38-39`).
- Тест «already done» в шаблоне demo: `[low]`, без ticket-а.
- Transcripts demo остаются после удаления: по замыслу (ADR-0005).

**gate full на ПК.** На `0eddc918` exit 2, красный только `test/e2e/getting-started.spec.ts:184`: тест не успевал за сообщением `info`, которое скрывается через 4 с. Исправлено #1121. Шаг также был красным на `two-windows.spec.ts:212`, `linked-browser.spec.ts:90`, `subagent-tree.spec.ts:312`: классифицированы как flaky (worfy-polish 47). Следующий gate full на `1b4009c5` (merge #1121): `getting-started.spec.ts:184` зелёный, шаг `test:e2e` красный только на `epic-frame.spec.ts:1104` (3394 ms при пределе 3000 ms, в одиночку 1300 ms; worfy-polish 47). #1120 закрыт решением Orchestrator-а без владельца — подтвердить.

Evidence на ПК, не в репозитории: `12-01-start.png`, `12-auto-042153…042655.png`, `onb12-stdout.log`, `onb12-stderr.log`, `onb12-watch.log`.

### macOS

Дописывается при закрытии Ticket-а.
