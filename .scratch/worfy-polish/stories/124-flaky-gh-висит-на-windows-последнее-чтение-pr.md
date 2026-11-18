# Code story — worfy-polish 124: Flaky test «gh hangs the whole Run» на Windows: последнее чтение PR не дожидается test

Kind: pr · Epic: worfy-polish · Ticket: 124 · PR: - · Language: ru

## 1. Что было не так

Contract test «gh hangs the whole Run» ждал, пока последнее чтение PR перед `run-stopped` повиснет на новом вызове gh.
Этому вызову `ghRunner` давал те же 1,5 с реального времени, что и первому. За них stand-in gh должен был стартовать и
записать pid, а Run — дочитать Ticket-ы. На нагруженном Windows runner-е это не успевало: runner убивал stand-in
раньше, и ожидание `the last read of the PRs` кончалось по пределу в обоих заходах трёх CI run-ов.

- Требование: [Что происходит](../issues/124-flaky-gh-висит-на-windows-последнее-чтение-pr.md#что-происходит)

## 2. Timeout gh, который спрашивается при каждом вызове

Code: `test/contract/autopilot-faults-setup.ts:532-534` · key lines: 534

```ts
    const timeoutMs = prOptions.timeoutMs ?? ms(15_000)
    const tracker = new PrTracker({
      run: (args, cwd, extra, output) => ghRunner({ command: STUB_COMMAND, env: () => Promise.resolve(ghEnv), timeoutMs: typeof timeoutMs === 'number' ? timeoutMs : timeoutMs() })(args, cwd, extra, output),
```

- Что делает: `faultRun` принимает `timeoutMs` числом, как раньше, или функцией; функция спрашивается при каждом вызове
  gh, и каждый вызов идёт через настоящий `ghRunner` с этим пределом.
- Почему здесь: Ticket называет `autopilot-faults-setup.ts` и просит такой режим; трекер PR строится здесь, и другой
  точки, где задаётся timeout gh для Run-а, у test-а нет.
- Без него: у всех вызовов gh одного Run-а один предел, и последний вызов умирает через 1,5 с, как первый.
- Требование: [Что делаем, п. 3](../issues/124-flaky-gh-висит-на-windows-последнее-чтение-pr.md#что-делаем)
- Риски и пробелы test-ов: остальные test-ы `autopilot-faults-*` передают число; путь с числом проверяют они.

## 3. Первый вызов кончается timeout-ом, последующие — нет

Code: `test/contract/autopilot-faults-github.test.ts:183-186` · key lines: 183, 186

```ts
    ghTimeoutMs = LATER_GH_TIMEOUT_MS
    h.clock.advance(2 * BASE_MS)
    h.releases.release('turn')
    await until(() => h.clock.pending().filter((timer) => timer.ms === END_READ_MS).length === 1 && hungPids(h.gh!.dir).length === 2, 'the last read of the PRs')
```

- Что делает: после того как первый зависший вызов убит timeout-ом `ghRunner` (`GH_TIMEOUT_MS`), следующие вызовы
  получают `LATER_GH_TIMEOUT_MS` (120 с × множитель) — дольше любого ожидания test-а. Последнее чтение PR висит, пока
  test сам не сдвинет часы на `END_READ_MS`, сколько бы ни стартовал stand-in и ни читались Ticket-ы. Окно test-а
  теперь ограничено только условиями.
- Почему здесь: Ticket просит лечить гонку причиной, без подъёма предела test-а или ожидания (правило проекта
  «Timeout-ы test-ов не подстраивают по одному»); предел `until` не тронут.
- Без него: условие ожидания выполняется, только если stand-in записал pid и чтение Ticket-ов ответило в пределах
  1,5 с от запуска gh. Задержка старта второго stand-in-а на 1,7 с воспроизводила ошибку CI на Mac.
- Требование: [Что делаем, п. 1–2](../issues/124-flaky-gh-висит-на-windows-последнее-чтение-pr.md#что-делаем)
- Риски и пробелы test-ов: первый вызов (ожидание выше по тексту test-а) всё ещё должен записать pid за 1,5 с; в шести
  упавших заходах CI это ни разу не подвело (раздел «Вне скоупа» Ticket-а). Условие стало однозначным: PR-чтение не
  может закончиться до сдвига часов, поэтому единственный оставшийся timer `END_READ_MS` — его.

## 4. Последний stand-in заканчивает test

Code: `test/contract/autopilot-faults-github.test.ts:198-199` · key lines: 198

```ts
    process.kill(last, 'SIGKILL')
    await until(() => hungPids(h.gh!.dir).every((pid) => !alive(pid)), 'the last hung gh call to end')
```

- Что делает: Run уже остановлен, а вызов ещё висит (`alive(last)` проверено выше). Test убивает этот stand-in
  вместо его долгого timeout-а и ждёт, что живых stand-in-ов нет; чтение Run-а заканчивается на закрытии процесса.
- Почему здесь: Ticket, п. 4.
- Без него: test ждал бы timeout `LATER_GH_TIMEOUT_MS` дольше своего предела.
- Требование: [Что делаем, п. 4](../issues/124-flaky-gh-висит-на-windows-последнее-чтение-pr.md#что-делаем)
- Риски и пробелы test-ов: то, что `ghRunner` сам кончает зависший gh, теперь проверяет только первый вызов, не
  последний.

## 5. Как проверено

На Mac с временными правками (не в PR): задержка старта второго stand-in-а 1,7 с — до исправления exit 1 с
`timed out waiting for the last read of the PRs` на той же строке, что в CI; после — exit 0, и с 4 с тоже. Задержка
чтения Ticket-ов 1,6 и 2,5 с — до исправления exit 1 (`alive(last)` — `false`), после — exit 0. Файл test-а 5 раз
подряд — exit 0; все `test/contract/autopilot-faults-*.test.ts` — exit 0; `pnpm lint`, `pnpm typecheck`, `pnpm test` —
exit 0; gate fast — exit 0. Windows — job `windows (2/3) / full-suite` CI этого PR.

## Проверить себя

1. Почему не хватило бы поднять `GH_TIMEOUT_MS` для всех вызовов?
   - Ответ: первый вызов должен умереть по timeout-у `ghRunner` в пределах ожидания test-а; общий большой предел или
     затянул бы это ожидание за его предел, или оставил бы гонку с меньшим запасом. Разные пределы для первого и
     последующих вызовов убирают реальное время из окна последнего чтения.
   - Строки: `test/contract/autopilot-faults-github.test.ts:183-186`
2. Почему ожидание теперь не может спутать timer чтения PR с timer-ом чтения Ticket-ов?
   - Ответ: вызов gh последнего чтения не кончается до сдвига часов, так что его timer `END_READ_MS` снят не будет;
     один оставшийся timer — это он, после ответа чтения Ticket-ов.
   - Строки: `test/contract/autopilot-faults-github.test.ts:186-186`
3. Что проверяет `alive(last)` после остановки и почему это больше не гонка?
   - Ответ: что Run остановился по `END_READ_MS` на часах test-а, не дождавшись gh; вызов живёт до SIGKILL test-а,
     а не 1,5 с реального времени.
   - Строки: `test/contract/autopilot-faults-github.test.ts:189-192`

## 6. Что нашёл review и что осталось

> VERIFIED
> Noted: test/contract/autopilot-faults-github.test.ts:198-200 — the test now SIGKILLs the last gh stand-in itself, so that `until(... every !alive)` can no longer fail for a product reason; "no hung gh is left" is now carried by the first-call check at :165 (ghRunner's own timeout-kill; removing the timeout in src/main/github/prs.ts:133 turns it red) and the afterEach at :100-104 (low).
> Review depth: low — default: the profile has no review.depth.wave
> Review tokens: 65998

Code: `test/contract/autopilot-faults-github.test.ts:198-200` · key lines: 198

```ts
    process.kill(last, 'SIGKILL')
    await until(() => hungPids(h.gh!.dir).every((pid) => !alive(pid)), 'the last hung gh call to end')
    // I2: the log holds only `pr list`.
```

Code: `src/main/github/prs.ts:133-133` · key lines: 133

```ts
        { cwd, env: { ...env, ...extra, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', NO_COLOR: '1', ...start.env }, encoding: 'utf8', timeout: options.timeoutMs ?? 30_000, maxBuffer: 32 * 1024 * 1024 },
```
