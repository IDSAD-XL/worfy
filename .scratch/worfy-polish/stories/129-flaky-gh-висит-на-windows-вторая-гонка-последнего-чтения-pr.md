# Code story — worfy-polish 129: Flaky test «gh hangs the whole Run» на Windows: вторая гонка последнего чтения PR после 124

Kind: pr · Epic: worfy-polish · Ticket: 129 · PR: - · Language: ru

## 1. Что было не так

Contract test «gh hangs the whole Run» снова падал на Windows с `Error: timed out waiting for the last read of the
PRs` уже после исправления worfy-polish 124, и стоял в карантине на win32. Test ждёт, что последнее чтение PR перед
`run-stopped` запустит новый зависший вызов gh (второй pid в `hang.pids`). Оно его не запускало: Run к тому моменту
уже остановился с одним pid и без timer-ов. Причина — test отпускал turn Wave 2, когда stand-in первого вызова gh уже
умер, но чтение PR, которому он принадлежал, ещё не закончилось. `PrTracker` ведёт одно чтение за раз, и последнее
чтение присоединялось к этому, не запуская gh. На Mac это воспроизводится задержкой ответа `ghRunner` на 200 мс после
смерти процесса.

- Требование: [Что происходит](../issues/129-flaky-gh-висит-на-windows-вторая-гонка-последнего-чтения-pr.md#что-происходит)

## 2. faultRun говорит, сколько чтений PR ещё идёт

Code: `test/contract/autopilot-faults-setup.ts:742-747` · key lines: 747

```ts
    prs,
    /**
     * How many of the run's PR reads have not settled yet. A read settles on the close of its last gh
     * process, which may come after that process is gone (worfy-polish ticket 129).
     */
    prsReading: (): number => prReads.size,
```

- Что делает: отдаёт test-у размер `prReads` — набора чтений PR, которые Run начал и которые ещё не закончились.
  Этот набор уже был: по нему cleanup ждёт последних stand-in-ов перед удалением папки (worfy-polish 90).
- Почему здесь: Ticket называет `autopilot-faults-setup.ts` среди своих файлов; `prReads` живёт внутри `faultRun`.
- Без него: test видит только процессы stand-in-а и не может отличить «процесс умер» от «чтение закончилось».
- Требование: [Что делаем, п. 2](../issues/129-flaky-gh-висит-на-windows-вторая-гонка-последнего-чтения-pr.md#что-делаем)
- Риски и пробелы test-ов: чтение попадает в `prReads` только через обёртку `prReader`; чтение, которое тест сам
  делает через `h.prs`, сюда не входит. В этом test-е таких нет.

## 3. Test ждёт конца чтения, а не только смерти stand-in-а

Code: `test/contract/autopilot-faults-github.test.ts:175-179` · key lines: 179

```ts
    // ghRunner's timeout ends the hung call: no stand-in outlives it. The test waits for the read to settle,
    // not only for its stand-in to be gone: ghRunner answers on the stand-in's close, which may come later. A
    // read still running when Wave 2's turn ends is the one the run's last read joins, with no gh call of its
    // own, and the run stops when it settles. Windows CI lost that race (worfy-polish ticket 129).
    await until(() => h.gh!.calls().length === 1 && hungPids(h.gh!.dir).length === 1 && !alive(hungPids(h.gh!.dir)[0]!) && h.prsReading() === 0, 'the hung gh call of Wave 1 to end by the timeout')
```

- Что делает: к условию «первый вызов gh умер» добавляет «ни одно чтение PR Run-а не идёт». Только после этого test
  сдвигает часы и отпускает turn Wave 2, так что последнее чтение начинается с нового вызова gh.
- Почему здесь: это ожидание стоит прямо перед release; предел `until` прежний, ожидание — условие, а не часы.
- Без него: при задержке ответа `ghRunner` после смерти процесса длиннее пути от release до `end()` (на Mac 45–65 мс)
  test краснеет с той же ошибкой, что на Windows CI.
- Требование: [Что делаем, п. 2](../issues/129-flaky-gh-висит-на-windows-вторая-гонка-последнего-чтения-pr.md#что-делаем)
- Риски и пробелы test-ов: величина этой задержки на Windows не измерена; механизм доказан на Mac временной правкой.
  Окончательно — job-ы `windows / full-suite` этого PR и следующих.

## 4. Карантин снят

Code: `test/contract/autopilot-faults-github.test.ts:161-161` · key lines: 161

```ts
  it('gh hangs the whole Run: the Waves go on, no narrow-round, the stop waits END_READ_MS at most, and no hung gh is left', async () => {
```

- Что делает: test снова объявлен через `it(`; запись `test/quarantine/autopilot-faults-gh-hangs-whole-run.json`
  удалена, и на Windows test запускается.
- Почему здесь: Ticket требует убрать запись и вернуть `it(`.
- Без него: на Windows сценарий «gh висит весь Run» не проверяется до 2026-12-03.
- Требование: [Что делаем, п. 3](../issues/129-flaky-gh-висит-на-windows-вторая-гонка-последнего-чтения-pr.md#что-делаем)
- Риски и пробелы test-ов: если на Windows есть третья гонка, она снова покраснит `ci-ok`.

## 5. Как проверено

- Воспроизведение (временная правка обёртки `run` в `faultRun`, не в PR): задержка отказа вызова gh на 200 и
  1000 мс — до исправления exit 1 с `timed out waiting for the last read of the PRs`, после — exit 0 (и с 0 и 3000 мс).
- Все `test/contract/autopilot-faults-*.test.ts` и `test/contract/test-timeout-scale.test.ts` — 5 запусков подряд,
  5 из 5 exit 0 (57 test-ов).
- `pnpm lint` exit 0, `pnpm typecheck` exit 0.

## Проверить себя

1. Почему смерти stand-in-а мало, чтобы последнее чтение запустило свой вызов gh?
   - Ответ: `ghRunner` отвечает на `close` процесса, а не на его смерть; пока чтение Wave 1 не закончилось, последнее
     чтение присоединяется к нему и gh не запускает.
   - Строки: `test/contract/autopilot-faults-github.test.ts:175-179`
2. Почему исправлен test, а не `src/`?
   - Ответ: присоединение к идущему чтению — законное поведение `PrTracker` (одно чтение за раз); сценарию test-а
     нужно, чтобы последнее чтение началось после конца первого, и test теперь ждёт этого условия.
   - Строки: `test/contract/autopilot-faults-setup.ts:743-747`

## 6. Что нашёл review и что осталось

> VERIFIED — worfy-polish 129 (flaky test «gh hangs the whole Run» on Windows: the second race of the last PR read), head 1c236a0f84f2a576448f6a39a36b338f0e6bc82e
>
> Gate (depth medium, one round, test-only diff): reviewer (lenses: correctness + implementer's claims) — every claim backed, re-ran the reproduction and a mutant; no findings.
>
> - Cause: the test released Wave 2's turn as soon as the first stand-in gh process died, but ghRunner answers on execFile's callback when the pipes close (src/main/github/prs.ts:130-142), which can come later; PrTracker runs one read per Project and a read started meanwhile joins it (prs.ts:459-467), so the last read before run-stopped started no gh of its own and the second pid never appeared.
> - Fix (test only): faultRun exposes prsReading() (test/contract/autopilot-faults-setup.ts:747, the harness adds a read to its set synchronously before gh starts); the test also waits for prsReading() === 0; same 5000 ms limit via ms(); quarantine file removed, test declared with it( (autopilot-faults-github.test.ts:161).
> - Evidence: reproduction by a temporary delay of the gh refusal after process death (not in the PR) — before the fix 200 / 1000 ms red (exit 1, «timed out waiting for the last read of the PRs»), after 0 / 200 / 1000 / 3000 ms green; re-run by the reviewer; mutant prsReading() ≡ 0 with the 1000 ms delay → red. autopilot-faults-* + test-timeout-scale 57 passed EXIT=0, 5/5 repeats; lint, typecheck, story-check, evidence-check EXIT=0. Full `pnpm test` exit 1 only on the file-watcher contract tests (fseventsd at 100% CPU on this Mac), none of them touched; local gate fast not run for the same reason; CI incl. windows / full-suite is the verdict.
>
> Decided without the owner (to confirm): the test is fixed, not src — the last read legitimately joins the running one (one read per Project).

Code: `src/main/github/prs.ts:130-142` · key lines: 130

```ts
      execFile(
        start.file,
        [...start.args, ...args],
        { cwd, env: { ...env, ...extra, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', NO_COLOR: '1', ...start.env }, encoding: 'utf8', timeout: options.timeoutMs ?? 30_000, maxBuffer: 32 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (!error) return resolve(output === 'all' ? `${stdout}\n${stderr}` : stdout)
          const code = (error as NodeJS.ErrnoException).code
          if (code === 'ENOENT') return reject(new Error(`gh not found (${command})`))
          const reason = firstLine(stderr) || error.message
          // An exit code is a number; a timeout, a signal or a too long output leave none.
          if (output === 'all' && typeof code === 'number') return reject(new GhExitError(reason, `${stdout}\n${stderr}`))
          reject(new Error(reason))
        },
```

Code: `test/contract/autopilot-faults-setup.ts:747-747` · key lines: 747

```ts
    prsReading: (): number => prReads.size,
```
