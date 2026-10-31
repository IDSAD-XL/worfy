# 12 — Приёмка Epic-а worfy-update с владельцем: Mac и Windows-ПК

Type: task
Status: open
Blocked by: 01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 13
Source: «Готово, когда» Epic-а worfy-update ([spec.md](../spec.md)); решения владельца 2026-10-31, пункты 1–11; [ADR-0089](../../../docs/adr/0089-update-builds-main-in-own-clone.md); [ADR-0056](../../../docs/adr/0056-windows-checks-and-two-sessions.md), пункт 2 (платформенная часть — на Windows-ПК владельца)

## Что происходит

- К claim Ticket-ы 01–11 влиты. Их test-ы не ходили на настоящий GitHub и не меняли настоящую Stable copy
  (соглашения spec-а): API — заглушка, сборка — подменная команда, копия — во временной папке.
- Настоящий Update требует, чтобы на `main` был commit новее Stable copy с зелёным `ci-ok`, который меняет
  приложение. Первую копию с Update ставит `pnpm install:stable`, следующий влитый PR с кодом и есть
  Available update.
- Сборка в clone занимает 2–3 GB и минуты; первая — дольше (clone и все зависимости).
- Приёмка — не в Autopilot: её ведёт владелец вместе с Orchestrator-ом. Autopilot над worfy во время
  приёмки остановлен.

## Что делаем

1. Stable copy из `origin/main` с влитыми 01–11 (`pnpm install:stable`) на Mac и на ПК, Harness обновлён
   из неё.
2. Дождаться следующего влитого PR с кодом и зелёного `ci-ok` на `main` (или влить маленький PR приёмки).
3. **Mac** — владелец проходит пункты ниже, Orchestrator ведёт записи и снимки в `../evidence/12-*.png`.
4. **Windows-ПК владельца** — те же пункты; вердикт gate full на ПК на коммите приёмки.
5. Найденный дефект — новый Ticket Epic-а, номер дописывается в `Blocked by` этого.
6. Риски 1 и 3 spec-а: записать время первой и повторной сборки и место `update/` на обеих машинах.
7. Отмечает пункты «Готово, когда» в `spec.md` со ссылкой на «Итог».

Не входит: новые функции.

## Готово, когда

**Mac.**

- [ ] (вручную) При старте Stable copy: точка на version chip-е, Settings → Health — красная строка
      «worfy version»; без сети (Wi-Fi выключен) — ни ошибок, ни toast-ов.
- [ ] (вручную) «Update automatically» включено: сборка идёт в фоне (подсказка «Building…»), потом toast
      «worfy <version> ready · Restart now · Later». В `~/Library/Application Support/worfy/update/` —
      `repo/` и `build.log`.
- [ ] (вручную) Session в ходе — в toast-е «Restart when idle»; после нажатия и конца хода worfy
      перезапустился сам.
- [ ] (вручную) После перезапуска: новая версия в chip-е, toast «worfy updated to…», Harness новой копии
      поставлен без диалога (`claude plugin list`), новая Session видит его.
- [ ] (вручную) `~/Applications/worfy-stable.previous` есть; Settings → General → Updates «Roll back to
      previous version» — подтверждение, перезапуск, прежняя версия; автоматический Update молчит;
      «Check now» снова показывает новую.
- [ ] (вручную) «What's new» — заголовки PR между двумя версиями.
- [ ] (вручную) Сбой сборки (например, `pnpm` убран из `PATH` запуска): «Update failed · Show log»,
      строка Health называет `pnpm`, Stable copy работает прежняя.
- [ ] (вручную) Отстаёт только Harness (поставить Harness старше руками): акцентная кнопка Harness с
      точкой, toast «Harness out of date», «Update Harness» с диалогом согласия.
- [ ] (вручную) dev-сборка (`pnpm dev`): нет точки, нет блока «Updates», нет команды «Update worfy».

**Windows-ПК владельца.**

- [ ] (вручную) Те же пункты: сборка в `%APPDATA%\worfy\update\`, замена `%LOCALAPPDATA%\worfy-stable`,
      `worfy-stable.previous` рядом, откат, Harness после Update.
- [ ] gate full на ПК на коммите приёмки — код 0 и строка `[gate] green (full)`.

**Записи.**

- [ ] «Итог»: на каждой машине — время первой и повторной сборки, размер `update/`, что владелец попросил
      поменять в текстах.
- [ ] Пункты «Готово, когда» Epic-а отмечены в `spec.md`.

## Тесты

- Новых test-ов нет: проверки — вручную и gate full. Найденный дефект получает test в своём Ticket-е.

## Где в коде

- `.scratch/worfy-update/spec.md` — отметки «Готово, когда»
- `.scratch/worfy-update/evidence/` (новая) — снимки

## Итог

Заполняется при закрытии.
