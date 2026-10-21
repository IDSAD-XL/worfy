# 16 — Долг после review PR #707: комментарий и пустое ожидание в test-е Browser layer

Type: task
Status: claimed 2026-10-21T21:41Z
Branch: worfy-browser/16
Blocked by: —
Source: ревью PR [#707](https://github.com/IDSAD-XL/worfy/pull/707) (Ticket 15), 2026-10-21. Low.

## Готово, когда

- [x] `test/unit/browser-layer.test.tsx:84-85`: комментарий вводит в заблуждение, а ожидание 50 ms ничего не
      проверяет. Поправить комментарий; ожидание убрать или заменить ожиданием того, что оно должно ловить.
- [x] `pnpm test test/unit/browser-layer.test.tsx` — exit 0.

## Итог

- Ожидание 50 ms заменено ожиданием того, что оно должно было ловить: ответа main в store профилей
  (`browserProfilesNow` — список `work-bbbbbb`, `admin-aaaaaa`). Только после этого test смотрит, что
  сделал layer: «Choose a profile», нет `<webview>`, нет записи в Node. Комментарий говорит именно это:
  layer и frame читают один store, React рисует его изменение одним commit-ом, запись профиля идёт из
  effect-а этого commit-а.
- Проверка `main.asked` («read был запрошен») убрана вместе с журналом `asked` в mock-е: ответ в store
  её покрывает, а больше журнал никто не читал.
- Mutation testing: frame спрашивает профиль до ответа main (`browserProfileChoice` без `loading`), layer
  при пропавшем `default` открывает первый профиль, mock отвечает через 10 ms. Новый test — exit 1
  (`<webview>` есть), test с main с ожиданием 50 ms — exit 1, тот же test, где ожидание просто удалено, —
  exit 0 (прошёл бы по неверной причине). Без mutant-ов новый test — exit 0, 8 прогонов из 8.
- `pnpm test test/unit/browser-layer.test.tsx` — exit 0.
