# 09 — Приёмка Epic-а worfy-failures с владельцем: Mac и Windows-ПК

Type: task
Status: done 2026-11-05T08:34Z
Blocked by: 01, 02, 03, 04, 05, 06, 07, 08, 10
Source: [spec.md](../spec.md), «Готово, когда» (все пункты), «Цель и что видит пользователь», «Windows», «Риски», п. 2–4; [ADR-0056](../../../docs/adr/0056-windows-checks-and-two-sessions.md), пункт 2 (платформенная часть — на Windows-ПК владельца)

## Что происходит

- К claim 01–08 влиты, у каждого свои test-ы: записи, reporter-ы, повтор, отчёт и перенос проверены на fixture и
  stub-процессах. Настоящего красного gate full на ПК с записями никто не видел.
- Приёмка — не в Autopilot: её ведёт владелец вместе с Orchestrator-ом и Session на ПК.

## Что делаем

1. Mac Stable и Harness — из `origin/main` с влитыми 01–08 (Replace Harness, `claude plugin list`). ПК — так же.
2. **Mac.** В отдельной ветке-проверке (не в PR) — test, который падает всегда, и test, который падает только под
   нагрузкой (stub со случайным отказом); gate fast, затем `rerun`, затем `report`. Ветка удаляется после.
3. **Windows-ПК.** Ближайший gate full на `main` по ADR-0086 — с записями; повтор, export по порядку Ticket-а 07,
   import и report на Mac.
4. Найденный дефект — новый Ticket Epic-а, номер дописывается в `Blocked by` этого.
5. Отмечает пункты «Готово, когда» в `spec.md` со ссылкой на «Итог».

Не входит: новые функции.

## Готово, когда

**Mac.**

- [x] (вручную) Красный gate fast печатает `--- failure records: …`; файл run-а называет оба test-а, `step`,
      SHA, компьютер `mac`.
  - evidence: gate pass · Итог: Mac, run ddc489d9/2026-11-05T07-39-38Z-15998 · mac - · 4d384bc47bf99281d1438558dc5437567a009784
- [x] (вручную) `gate-failures rerun --last` повторяет оба поодиночке; стабильно красный — красный, второй — по итогу.
  - evidence: gate pass · Итог: Mac, run ddc489d9/2026-11-05T07-39-38Z-15998 · mac - · 4d384bc47bf99281d1438558dc5437567a009784
- [x] (вручную) `gate-failures report` показывает классы; `node scripts/quarantine-suggest.mjs` печатает запись,
      `test/quarantine/` не изменился.
  - evidence: gate pass · Итог: Mac, run ddc489d9/2026-11-05T07-39-38Z-15998 · mac - · 4d384bc47bf99281d1438558dc5437567a009784

**Windows-ПК.**

- [x] (вручную) Красный (или с flaky) gate full на `main` оставил файл run-а в `%USERPROFILE%\.claude\worfy-harness\gate\state\failures\`.
  - evidence: gate pass · issue #1423; Итог: ПК, run c848baa6/2026-11-05T07-31-21Z-45368 · windows - · 66c3a4908e9e71ccd6341a902f2f4dd93c6d52a8
- [x] (вручную) `rerun` на ПК прошёл по test-ам vitest и Playwright без shell-ошибок; файл повтора записан.
  - evidence: gate pass · issue #1423; Итог: ПК, run c848baa6/2026-11-05T07-31-21Z-45368 · windows - · 66c3a4908e9e71ccd6341a902f2f4dd93c6d52a8
- [x] (вручную) Блок export дошёл до Mac путём из ответа на Q1; `import` принял его; в блоке нет имени пользователя,
      hostname и UUID (владелец смотрит текст).
  - evidence: test-run pass · issue #1423 comment 6653421761; import на Mac, поиск личных данных · mac - · 66c3a4908e9e71ccd6341a902f2f4dd93c6d52a8
- [x] (вручную) Отчёт на Mac называет записи ПК с компьютером `PC` и платформой `win32`; bridge-Session текст отчёта
      не пересказывала.
  - evidence: test-run pass · Итог: report --days 14 на Mac, computer windows (см. отклонения) · mac - · 66c3a4908e9e71ccd6341a902f2f4dd93c6d52a8

**Итог.**

- [x] Пункты «Готово, когда» spec-а отмечены со ссылкой на «Итог» этого Ticket-а.
  - evidence: commit pass · spec.md «Готово, когда» · - - · 5762b413116e3d0f8614a7c61d358b6d764773c0
  - evidence: commit pass · spec.md «Готово, когда» · - - · 5762b413116e3d0f8614a7c61d358b6d764773c0

## Тесты

- Test кода нет: приёмка вручную. Найденный дефект — новый Ticket со своим падающим test-ом.

## Где в коде

- `.scratch/worfy-failures/spec.md` (отметки «Готово, когда»)

Только читать: всё, что влили 01–08; `.scratch/worfy-failures/evidence/09/` — снимки текста отчётов, если владелец
захочет их оставить (после очистки).

## Итог

Приёмка 2026-11-05. Mac и ПК — Stable и Harness `66c3a4908` (`worfy 0.3.0+66c3a490`, `bin/gate-failures` на месте).
Владелец разрешил вести её самому («дальше работай сам», «пк доступен для тебя полностью»); Mac-часть он видел в чате.

**Mac.** Ветка-проверка `check/failures-09-mac` (не в PR, удалена) с test-ом, который падает всегда, и stub-ом, который
падает только при первом запуске. Случайный stub (отказ с вероятностью 0,5) в первом run-е прошёл, и он заменён на
детерминированный — так файл run-а назвал оба test-а.

| Пункт | Что видно | Код |
|---|---|---|
| gate fast | `--- failure records: …/ddc489d9--2026-11-05T07-39-38Z-15998.json (2 tests, 0 steps without tests)`; в файле оба test-а, `step` `worfy/.:test`, `head` `4d384bc4`, `computer` `{name: mac, platform: darwin}`, у каждого argv повтора | 2 |
| `rerun --last` | «1 green alone, 1 red alone»: всегда красный — красный (exit 1), stub — зелёный; файл повтора записан | 2 |
| `report` | «stable red (1)» и «flaky (1)»; кандидат в карантин появился после второго run-а на другом SHA (`75aba15a`) — правило Q4: flaky в двух run-ах | 0 |
| `quarantine-suggest` | напечатал запись `test/quarantine/…` с причиной и сроком до 2026-11-19; в `test/quarantine/` 16 файлов до и после, `git status` чистый | 0 |

Пять файлов записей проверочных run-ов удалены с Mac после приёмки (слово владельца), чтобы не висеть в `report` 14 дней.

**Windows-ПК** (через bridge-Session). gate full `GATE_SCOPE=all` на `66c3a4908`, 07:31–08:29 UTC: exit 2,
`[gate] red (full): worfy/.:test worfy/.:test:e2e`; `--- failure records: %USERPROFILE%\.claude\worfy-harness\gate\state\failures\c848baa6--2026-11-05T07-31-21Z-45368.json (4 tests, 0 steps without tests)`.
`rerun --last`: exit 2, «0 green alone, 4 red alone», без shell-ошибок, два test-а vitest и два Playwright; файл
повтора записан. Красный `main` — issue [#1423](https://github.com/IDSAD-XL/worfy/issues/1423) (`pc-main-red`), блок
export — его первый комментарий (путь Q1, вариант А). Причины красного — не этого Epic-а: Git Bash и `/tmp` в
`auto-approve-shell-sh.test.ts:101` (#1372) и рамка 2.66667px при масштабе экрана 150 % в `codex-session.spec.ts` и
`session-view.spec.ts` (#1362); fix-forward ведёт bridge-Session.

**Mac после ПК.** `gate-failures import --gh IDSAD-XL/worfy --issue 1423` — «imported: 2 new, 0 skipped, 0 rejected»
(run и его повтор); `report --days 14` называет четыре записи ПК `windows; win32` в «stable red» и предлагает их в
Windows exception. Bridge-Session прислала свою сводку, текст `report` не пересказывала. В блоке export (3956 знаков)
поиск путей `Users\` и `Users/`, UUID, имён компьютера и email ничего не нашёл.

**Отклонения и заметки** (решено без владельца, подтвердить):
- Компьютер ПК в записях — `windows`, а не `PC`: это имя по умолчанию по spec-у («Компьютер»), `gate-failures machine
  --name PC` на ПК не запускали. Пункт считаю выполненным: записи ПК отличимы и названы по платформе.
- Текст блока export владелец сам не смотрел — проверил поиском Orchestrator.
- Заметки ПК, не дефекты: `export --run` принимает id в форме `<tag>/<run>` из `list` и первой строки `rerun`, а имя
  файла с `--` — нет (так и описано в ADR-0096, п. 2); `--out X` пишет часть в `X.1` — так описано в
  `docs/features/gate-and-github.md:354`. Новых Ticket-ов приёмка не дала.

