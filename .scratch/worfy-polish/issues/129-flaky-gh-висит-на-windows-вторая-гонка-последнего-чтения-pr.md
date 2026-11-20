# 129 — Flaky test «gh hangs the whole Run» на Windows: вторая гонка последнего чтения PR после 124

Type: bug
Status: claimed 2026-11-20T12:41Z
Branch: worfy-polish/129
Blocked by: none
Source: красный push run 44471611202 на `main` eb669a653 (#2030, worfy-auth-check 08 — Autopilot не трогает), job
`windows (2/3) / full-suite`. Тот же файл зелёный в `windows (2/3)` на том же коде в run-ах 44550103039 (job
135651372486), 44547578992, 44535810835, 44535483050 — flaky test, не ошибка #2030; revert не делался.

Кто: агент.

## Что происходит

- `test/contract/autopilot-faults-github.test.ts:162` («gh hangs the whole Run: the Waves go on, no narrow-round, the
  stop waits END_READ_MS at most, and no hung gh is left») снова падает на Windows с
  `Error: timed out waiting for the last read of the PRs` — ожидание `until` перед `h.clock.advance(END_READ_MS)`:
  ждёт, пока `END_READ_MS`-timer останется один и зависший вызов gh последнего чтения запишет второй pid в `hang.pids`.
- Первую гонку того же ожидания (`ghRunner` убивал stand-in gh раньше, чем тот записывал pid, за 1,5 с реального
  времени) починил worfy-polish 124 (PR #1985): последующим вызовам gh дан `LATER_GH_TIMEOUT_MS`. Это новое падение
  после того исправления, причина не установлена.
- Test в карантине на win32 до 2026-12-03: запись `test/quarantine/autopilot-faults-gh-hangs-whole-run.json`
  (owner — этот Ticket). Пока она есть, на Windows test не запускается и сценарий «gh висит весь Run» там не проверен.

## Что делаем

1. Найти причину второй гонки — момент последнего чтения PR на медленном Windows runner-е: какое из двух условий
   ожидания не выполняется (второй pid в `hang.pids` или единственный `END_READ_MS`-timer на часах test-а) и почему.
   Кандидаты для проверки, не установлены: последнее чтение не начинается, потому что Run не дошёл до него за время
   `until`; чтение Ticket-ов не ответило и держит второй timer; второй вызов gh присоединился к уже идущему чтению или
   не стартовал. Воспроизвести на Mac временной задержкой (как в 124), записать в «Причина».
2. Исправить test (или продукт, если ошибка в нём): ждать условия, а не часов. Предел ни одного test-а и ни одного
   ожидания не поднимать (правило «Timeout-ы test-ов не подстраивают по одному»).
3. Убрать запись карантина и вернуть `it(` вместо `quarantined('autopilot-faults-gh-hangs-whole-run')(`.

## Готово, когда

- [ ] В «Причина» этого Ticket-а записано, какое условие ожидания не выполнялось и почему, с воспроизведением на Mac
      временной правкой (не в PR): до исправления красный, после — зелёный.
- [ ] Все test-ы `test/contract/autopilot-faults-*.test.ts` зелёные; `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.
- [ ] Job-ы `windows / full-suite` PR-а зелёные, test в них запускается (не skipped).
- [ ] Записи `test/quarantine/autopilot-faults-gh-hangs-whole-run.json` нет; test объявлен через `it(`.

## Где в коде

- `test/contract/autopilot-faults-github.test.ts`
- `test/contract/autopilot-faults-setup.ts`
- `test/quarantine/autopilot-faults-gh-hangs-whole-run.json`
