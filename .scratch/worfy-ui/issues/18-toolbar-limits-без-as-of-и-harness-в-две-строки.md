# 18 — Toolbar: Limits без строки «as of», Harness и версия приложения в две строки

Type: task
Status: done 2026-10-19T22:31Z
PR: #543
Branch: worfy-ui/18
Blocked by: —
Source: отзыв владельца 2026-10-19 по скриншоту toolbar. Правая часть toolbar читалась так:
«Limits 5-hour 10% resets 20:30 as of 18:00 | 7-day 8% resets Mon 06:00 as of 18:00 | Harness
0.3.0+e61cb1fe v0.3.0+e61cb1fe». Код перечитан по main `ecbfb783`, типы SDK — по
`@anthropic-ai/claude-agent-sdk` 0.3.289.

## Что происходит

- **Limits устаревают.** Main получает их только пассивно (`src/main/agent/limits.ts`):
  - `rate_limit_event` из сообщений SDK — Session-ы (`app-registry.ts`) и процесс Terminal AI
    (`terminal-ai/assist.ts`);
  - `<WORFY_DATA_DIR>/statusline-limits.json`, его пишет `scripts/statusline-bridge.mjs`.

  Периодического запроса нет. Без Session-ов данные стареют, и через час
  (`STALE_AFTER_MS`, `src/shared/agent/limits.ts`) у каждой полосы появляется строка
  «as of HH:MM».
- **Строка «as of» — третья строка полосы** (`src/renderer/limits/LimitBar.tsx`): label, полоса,
  «resets …», «as of …». Toolbar тесный, текст мелкий, а «as of 18:00» повторяется у обеих полос.
- **Версия Harness и версия приложения стоят рядом в одну строку:** «Harness 0.3.0+e61cb1fe
  v0.3.0+e61cb1fe» (`toolbar/HarnessStatus.tsx`, `toolbar/AppVersion.tsx`). Одна и та же строка
  версии подряд дважды.
- **Кнопки Harness — текстовые:** «Update Harness», «Move old Harness…», «Install», «Retry».
  Они занимают ширину toolbar.
- В SDK 0.3.289 у `Query` есть
  `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true })`
  (`sdk.d.ts:3056`). Ответ — `rate_limits.five_hour` / `seven_day` с `{ utilization 0..100,
  resets_at ISO 8601 }` (`sdk.d.ts:4251`). Это control request: сообщение пользователя не
  уходит, модель не зовётся. Для API key, Bedrock и Vertex — `rate_limits_available: false`,
  `rate_limits: null`.

## Что сделать

1. **Limits обновляются раз в 30 минут без токенов модели.**
   - Main раз в 30 минут спрашивает usage через метод SDK выше. При старте приложения он
     спрашивает один раз, если данные старше 30 минут.
   - Вызова нет, если за последние 30 минут пришли свежие данные из пассивного источника.
   - Способ запроса — короткий `query()` в режиме streaming input, который не шлёт ни одного
     сообщения пользователя. Порядок: вызвать метод, закрыть процесс. Заданы `persistSession: false`,
     `settingSources: []`, без MCP-серверов и инструментов, без API key в окружении. `cwd` —
     собственная пустая папка worfy вне Project-ов (`<WORFY_DATA_DIR>/terminal-ai`, ADR-0058).
   - Ответ идёт в тот же LimitsTracker с собственным временем получения и источником `usage`.
   - Метод отсутствует, ответ `null` или ошибка → одна строка лога уровня debug, дальше —
     пассивные источники. Повтор — только по следующему тику, без цикла.
   - Имя метода — в одном маленьком адаптере: переименование в SDK правится одной строкой.
   - Интервал останавливается при выходе из приложения (`will-quit`). Под `WORFY_AGENT=fake` и
     под vitest настоящий Claude Code не запускается.
   - Проверка с временными HOME и `CLAUDE_CONFIG_DIR`: процесс не тратит токены и не оставляет
     следа, который worfy показал бы как Session. Следы — транскрипт в `~/.claude/projects`,
     запись в `~/.claude/sessions`, строка в `history.jsonl`.
2. **Нет строки «as of».** Полоса в toolbar — не больше двух строк текста: строка label и строка
   «resets …». Данные старше часа, если и после проверки они не обновились, → полоса приглушена
   (opacity), её native `title` — «as of HH:MM». Высота полосы не растёт.
3. **Версия приложения под строкой Harness.** Одна колонка: «Harness 0.3.0+…» сверху,
   «v0.3.0+…» снизу, мелко и приглушённо. `AppVersion` сливается с `HarnessStatus`, а
   `data-testid="app-version"` остаётся. Высота toolbar не меняется.
4. **Кнопки-иконки.** Inline svg, `stroke="currentColor"`, класс `.w-toolbar__icon-button`,
   native `title` и `aria-label`.
   - «Update Harness» — стрелка вверх в круге: `title` «Update Harness: OLD → NEW», `aria-label`
     «Update Harness».
   - «Move old Harness…»: `title` и `aria-label` «Move old Harness…», `data-testid` остаётся
     `harness-migrate`.
   - «Install» и «Retry» стоят там же и тоже становятся иконками. Доступные имена остаются
     прежними: «Install» и «Retry».
   - e2e, которые читали видимый текст кнопок, проверяют доступное имя (`toHaveAccessibleName`).

## Готово, когда

- [x] Unit планировщика обновления (fake timers, stub адаптера): вызов при старте со старыми
      данными, нет вызова со свежими пассивными, вызов раз в 30 минут, `null` и ошибка — одна
      строка лога и без повтора до следующего тика, после `stop()` вызовов нет.
- [x] Unit разбора ответа usage в обновления окон (проценты, ISO-время, `null`, мусор).
- [x] Unit `LimitBarView` (`test/unit/limits-meter.test.tsx`): нет строки «as of», устаревшая полоса приглушена, у неё `title`
      «as of …».
- [x] Unit `HarnessStatusView`: иконки с `aria-label` и `title`, версия второй строкой.
- [x] e2e `limits.spec.ts` (сценарий старых данных и снимок `toolbar-limits-as-of.png`),
      `toolbar.spec.ts`, `launch.spec.ts`, `harness-install.spec.ts`, `harness-migrate.spec.ts`,
      `packaged.spec.ts` обновлены и зелёные под замком e2e.
- [x] «Итог» называет: путь запроса usage (короткий `query()` или переиспользование spare-процесса),
      как доказано отсутствие токенов и следов Session.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `gate.mjs fast` — exit 0 и
      «[gate] зелено».

## Где в коде

- `src/main/agent/limits.ts`
- `src/main/agent/limits-usage.ts` (новый)
- `src/main/index.ts`
- `src/shared/agent/limits.ts`
- `src/renderer/limits/LimitBar.tsx`
- `src/renderer/limits/useLimits.ts`
- `src/renderer/shell/toolbar/HarnessStatus.tsx`
- `src/renderer/shell/toolbar/AppVersion.tsx` (удаляется)
- `src/renderer/shell/toolbar/LimitsMeter.tsx`
- `src/renderer/main.tsx` (комментарий об `AppVersion`)
- `src/renderer/shell/shell.css`
- `test/unit/limits-usage.test.ts` (новый)
- `test/unit/limits.test.ts`
- `test/unit/harness-status.test.tsx`
- `test/unit/limits-meter.test.tsx`
- `test/e2e/limits.spec.ts`, `test/e2e/toolbar.spec.ts`, `test/e2e/launch.spec.ts`,
  `test/e2e/harness-install.spec.ts`, `test/e2e/harness-migrate.spec.ts`,
  `test/e2e/packaged.spec.ts`

## Итог

Ветка `worfy-ui/18`, база — main `ecbfb783`.

**Limits раз в 30 минут — `src/main/agent/limits-usage.ts`.**
- `LimitsRefresher`. При старте он спрашивает usage, если хотя бы одно окно (5-hour, 7-day)
  старше 30 минут — из любого источника, включая usage прошлого запуска. Дальше — тик раз в
  30 минут. Тик пропускается, если оба окна свежие из пассивного источника (`sdk`, `statusline`);
  свой прошлый ответ (`usage`) тик не пропускает. Одновременно идёт не больше одного запроса.
- Ответ — `limitUpdatesFromUsage` (`src/shared/agent/limits.ts`): проценты 0..100 → доля,
  ISO-время → Unix seconds, источник `usage` (новое значение enum `source`), время получения —
  собственное. Запись — через тот же `LimitsTracker.record()`, так что `mergeLimits` применяет
  обычные правила: более новое побеждает, статус SDK того же окна сохраняется.
- Нет метода, ответ `null` или без `rate_limits`, исключение → одна строка `console.debug` на
  каждый вид (сбрасывается после удачного ответа). Следующая попытка — только на следующем тике.
- Имя метода — одна константа `USAGE_METHOD`, вызов — `askUsage()`.
- `installLimitsRefresh()` в `src/main/index.ts` после авто-архива; стоп — `will-quit`.
  `stop()` гасит интервал и через `AbortSignal` сразу закрывает процесс запроса в полёте. Под
  `WORFY_AGENT=fake` (все e2e) и под vitest ничего не запускается.

**Путь запроса — короткий `query()`, не spare-процесс Terminal AI.** У spare-процесса
(`prewarm()`, ADR-0058) нет `Query`, пока его не заняли через `claim()`. `claim()` одноразовый: он
забрал бы spare у Terminal AI и вмешался бы в его очередь запросов (`assist.ts`). Поэтому — свой
процесс: `query()` с prompt-потоком, который ничего не отдаёт (как `accountInfo()` в
`src/main/ipc/first-run.ts`), `persistSession: false`, `settingSources: []`, без MCP и
инструментов, без `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN`, `cwd` —
`<WORFY_DATA_DIR>/terminal-ai` (пустая папка worfy вне Project-ов). Тайм-аут — 30 s, процесс
закрывается всегда.

**Проверка: ноль токенов и нет следа Session.** Настоящий Claude Code 2.1.289 (SDK 0.3.289),
`HOME` и `CLAUDE_CONFIG_DIR` — во временной папке, без API key. Два запуска:
1. Скрипт с теми же options, который во время работы смотрит в config dir.
2. Бандл (esbuild) настоящих `sdkUsageReader` + `usageOptions` из `limits-usage.ts`.

Результат обоих:
- Ответ: `session.total_cost_usd: 0`, `total_api_duration_ms: 0`, `model_usage: {}`; сообщений
  из Query — ноль (ни `assistant`, ни `result`).
- Пока процесс открыт: `sessions/<pid>.json` и `.key`. После `close()` их нет.
- После закрытия в config dir только `.claude.json` и его `backups/…`. Ревью (круг 1) уточнило:
  их Claude Code пишет только при первом старте в config dir, не при каждом. Нет `projects/` (нет
  транскрипта), нет `history.jsonl`, нет `sessions/`. Процессов с временной папкой не осталось.
- Без сети каждый запуск оставлял файл около 150 KB в `telemetry/` (нашло ревью). Процессу
  задан `DISABLE_TELEMETRY=1`, usage с ним отвечает (круг 2).
- Hook-и и MCP-серверы в процессе не загружаются — это подтвердил probe ревьюера.
- Пока процесс жив (меньше секунды), его запись в `sessions` с `cwd` в папке данных worfy не
  попадает ни в один Project (`src/main/claude-home/registry.ts`, `inProject`).
- **Не решено в этом Ticket-е:** сама регистрация в `~/.claude/sessions` (kind `interactive`,
  idle, socket примерно на 0,3 s). Это решение владельца в Ticket-е `worfy-terminal-ai` 16, пункт
  2 (тот же вопрос для процесса Terminal AI); orchestrator добавляет туда
  `src/main/agent/limits-usage.ts`.

Без входа по подписке ответ — `rate_limits_available: false`, `rate_limits: null`. Ответ с
настоящими `rate_limits` не наблюдался: настоящий `~/.claude` и Keychain не трогались. Форма
взята из типов (`sdk.d.ts:4251`).

**Toolbar.**
- `LimitBar.tsx`: строки «as of» больше нет. Под полосой одна строка `resets …`
  (`data-testid limit-<окно>-note`, её `title` — полный текст строки). Данные старше часа →
  `opacity 0.55`, `data-stale="true"`, native `title` «62% · as of HH:MM» (значение остаётся
  читаемым, если «limit reached» обрезан; «as of Sat 05:00» для другого дня). Высота полосы та же.
- `limits.json`: поле `source` читается мягко — неизвестный источник (новой сборки) читается как
  `sdk`, а не откладывает весь файл. Иначе старая сборка теряла бы `rejected` и время сброса, по
  которым ждут Autopilot (`resume-at.ts`) и Terminal AI (`limits-gate.ts`).
- `HarnessStatus.tsx`: одна колонка `harness-column` — строка Harness, под ней `v…`
  (`data-testid app-version`, 11px, muted). `AppVersion.tsx` удалён, `app.version` читает
  `HarnessStatus`.
- Иконки (`.w-toolbar__icon-button` + новый `--compact` 20×20 в `shell.css`): Install
  (стрелка вниз на черту), Update Harness (стрелка вверх в круге, `title` «Update Harness: OLD →
  NEW»), Retry (круговая стрелка), «Move old Harness…» (`data-testid harness-migrate`).
  `aria-label` — прежние имена.
- Устаревший Harness с доступным обновлением теперь показывает «Harness OLD» и иконку;
  раньше строки текста не было, была только кнопка «Update Harness».

Снимок toolbar (1280 px, старые Limits приглушены, Harness и версия в колонке, иконка Install):
[18-toolbar.png](../evidence/18-toolbar.png).

**Test-ы.**
- `test/unit/limits-usage.test.ts` (новый, 18): планировщик на fake timers и stub reader,
  `askUsage`, `sdkUsageReader` на fake SDK (закрытие после ответа, ошибки, тайм-аута, выхода),
  `usageOptions`.
- `test/unit/limits.test.ts` — разбор ответа usage.
- `test/unit/limits-meter.test.tsx` — полоса без «as of», приглушение, `title`.
- `test/unit/harness-status.test.tsx` — иконки, доступные имена, `title`, вторая строка версии.
- Мутанты красные: тик без фильтра `usage` (пропускал бы тик после своего ответа), `stop()`
  без abort, лог без «один раз»; круг 2 — без `DISABLE_TELEMETRY`, `installLimitsRefresh` без
  проверки `WORFY_AGENT=fake`.
- Круг 2 добавил: интервал литералом (`1_800_000`), `installLimitsRefresh` с fake и vitest не
  ставит ни одного таймера, отказ метода usage после тайм-аута и после выхода не даёт unhandled
  rejection, `title` иконки Install, неизвестный `source` в `limits.json`. Из `toolbar.spec.ts`
  убрана проверка высоты toolbar `toBe(52)`: высоту задаёт CSS, проверка ничего не ловила.
  Вместо неё — строка Harness и версия внутри toolbar.
- e2e под замком: `limits`, `toolbar`, `launch`, `harness-install`, `harness-migrate`,
  `select` — зелёные. `packaged.spec.ts` (одна строка: Install → `toHaveAccessibleName`) не
  запускался: это `@packaged`, его гоняет `test:package` в gate full.
- `pnpm lint`, `pnpm typecheck` — exit 0. `gate.mjs fast` — exit 0, «[gate] зелено (fast)».
