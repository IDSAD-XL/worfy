# 11 — Feature page Update: `docs/features/updates.md` и перевод

Type: task
Status: done 2026-10-31T12:14Z
PR: #1132
Branch: worfy-update/11
Blocked by: 01, 02, 03, 04, 05, 06, 07, 08, 09, 10
Source: [spec.md](../spec.md), «Решено без владельца», Р14, «Риски», пункт 2 (откат руками); [ADR-0088](../../../docs/adr/0088-feature-pages-in-english.md) (английская страница, русский перевод с отметкой commit-а)

## Что происходит

- Feature page-и лежат в `docs/features/` по-английски, переводы — в `docs/features/ru/` (ADR-0088), список —
  `docs/features/README.md`. Шаблон раздела и проверки — `.scratch/worfy-feature-docs/spec.md`, «Шаблон
  раздела», «Проверки»; скрипт — `scripts/check-feature-docs.mjs`.
- К claim поведение Update собрано Ticket-ами 01–10; страницы о нём нет. `docs/features/harness.md`
  описывает кнопку Harness в toolbar без акцента и без Update, `docs/features/app-shell.md` — Settings без
  блока «Updates».

## Что делаем

1. `docs/features/updates.md` (новый) по шаблону раздела: что такое Update и Available update (термины
   CONTEXT.md), где видно, «Update automatically», «Restart when idle», откат (и руками, когда новая копия
   не стартует: переименовать `worfy-stable.previous`), сбой сборки, What's new, что не входит (подпись и
   Releases — E4, ADR-0089). Реализация — файлы `src/main/update/`, `scripts/install-stable.mjs`.
2. `docs/features/ru/updates.md` (новый) — перевод с отметкой commit-а английской версии.
3. Строка в `docs/features/README.md` и `docs/features/ru/README.md`; ссылка на страницу из
   `harness.md` (Harness после Update) и `app-shell.md` (Settings → General → Updates).

## Готово, когда

- [ ] `node scripts/check-feature-docs.mjs` — exit 0.
- [ ] Каждый путь и `file:line` страницы существует на `main` в момент PR.
- [ ] Тексты интерфейса на странице совпадают с кодом (`grep` каждой строки в `src/renderer/`).
- [ ] `pnpm lint` — exit 0; `ci-ok` зелёный.

## Тесты

- Новых test-ов нет: проверка — `scripts/check-feature-docs.mjs` и lint путей.

## Где в коде

- `docs/features/updates.md` (новый)
- `docs/features/ru/updates.md` (новый)
- `docs/features/README.md`, `docs/features/ru/README.md`
- `docs/features/app-shell.md`, `docs/features/harness.md`

Только читать: `.scratch/worfy-feature-docs/spec.md`, `src/main/update/`, `src/renderer/update/`.

## Итог

- `docs/features/updates.md` — одна Feature Update по шаблону раздела: где Update включён, проверка и условия Available
  update, где видно (version chip, toast-ы, Settings → General → Updates, Health «worfy version», Command palette «Update
  worfy»), «Update automatically», сборка и её сбой с «Show log», «Restart now» / «Restart when idle», Harness после
  Update и «Harness out of date», откат из приложения и руками (переименовать `worfy-stable.previous` и его `.json`,
  или `install-stable.mjs --rollback` из clone), What's new, Windows, Linked machine; что не входит (Releases, подпись,
  нотаризация — E4, ADR-0089). Реализация — `src/main/update/`, `scripts/install-stable.mjs`, renderer, test-ы.
- `docs/features/ru/updates.md` — перевод, `same-pr`.
- Индексы `docs/features/README.md` и `ru/README.md` — строка Updates. `harness.md`: ссылки на Updates, акцент и точка у
  «Update Harness»; `ru/harness.md` заодно догнал отставание от worfy-update 05 (два абзаца про Harness после Update),
  поэтому `same-pr` в нём верен. `app-shell.md` (+ ru): «Update worfy» в группе Action и блок Updates в General.
- Каждая строка интерфейса в кавычках на странице найдена `grep` в `src/renderer/` или `src/main/` (диалог отката, строки
  Health, отказы перезапуска); составные тексты («worfy was not updated to …», «Last checked …») сверены с шаблонами в
  коде. `node scripts/check-feature-docs.mjs` — exit 0.
- Оговорку о Windows `--wait-pid` на страницу не писал: по коду ожидание главного pid и последующая проверка процессов
  копии одинаковы на macOS и Windows; на странице — общий случай «процесс старой копии ещё работает → отказ, старая копия
  стартует снова».
- Ревью утверждений: круг 1 REJECTED (2 med: toast ожидания появляется только после кнопки «Restart when idle»
  toast-а «ready»; более новый commit во время сборки встаёт в очередь только при «Update automatically»; 2 low),
  круг 2 VERIFIED. По ходу дописан перевод двух абзацев worfy-update 05 в `ru/harness.md`.
- Находка вне страницы — Ticket 13: после падения новой копии и отката руками `settleLastRestart`
  (`src/main/update/restart.ts:104`) показывает успех Update и снимает `rolledBackFrom`.
- Low (не Ticket): `docs/features/storage-and-diagnostics.md` — в таблице папки данных нет папки `update`;
  `docs/features/concepts.md` — нет Update и Available update.
- Вопрос владельцу: диалог отката (`src/main/ipc/update.ts:349`) обещает «Its Harness is installed too», но более
  новый установленный Harness не понижается (`src/main/update/harness-after-update.ts:99`; страница пишет это
  условие верно). Править текст диалога или понижать Harness — решает владелец. Ответ: владелец 2026-10-31: править текст, Harness не понижать — PR #1142.
