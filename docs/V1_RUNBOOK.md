# ВЕКТОР — ФИНСИСТЕМА / API v1 — Production Runbook

Статус документа: operational runbook для принятого production scope v1.

## 1. Принятая production-база

- Runtime SHA, на котором выполнена финальная acceptance-проверка: `11eaa3150761fbb85d78df2fdb31ba101e3d55e1`.
- PR runtime-финала: #187 (`feat: close v1 intraday decision sync gap`).
- PR merge-ref CI: run `34328956444`.
- Post-merge main CI: run `34329182296`, полный набор `674/674`, `0 fail`.
- Принятый production deployment: `dpl_AAUV62GtckvCsdi8sYn6iUpAsPZ9`.
- Production deployment SHA: `11eaa3150761fbb85d78df2fdb31ba101e3d55e1`.
- Финальная runtime acceptance: `2026-09-09T11:02:47.758Z`.
- Acceptance evidence: реальный scheduled intraday run `2026-09-09T10:51:16Z` дошёл через Data Health; `Rule Engine Audit` `2026-09-09T10:53:28.939Z` = `daily-cron / commit / 4/4 / drift 0 / verified=true / OK`; canonical `/api/decision-shadow-status` после run = `MATCH`, `matches=4`, `total=4`, `drift=0`.

Документирование после acceptance не меняет runtime-логику. Для docs-only deployment повторный intraday acceptance не требуется; требуется обычная проверка CI/deploy/health/security.

## 2. Границы v1

v1 автоматизирует read/sync/control/decision контур. Она **не выполняет платежи, переводы, банковские распоряжения или иные движения денег**.

Не разрешено автоматически:

- классифицировать неоднозначные операции Точки;
- создавать новые финансовые факты в ДДС/обязательствах только ради прохождения gate;
- ослаблять Data Health, reserve policy, Driving Fund или `safeWithdrawal` ради зелёного статуса;
- менять банковскую операцию или её назначение.

Любая неоднозначная операция Точки остаётся fail-closed до явного подтверждения собственника.

## 3. Канонический порядок intraday

Рабочий дневной контур должен идти строго в следующем порядке:

1. **Payments** — обновить АШК оплаты и доказать verified readback.
2. **ROP** — пересобрать операционный контроль продаж/сбора, задачи и приоритетную дебиторку.
3. **Tochka → DDS** — обновить операции Точки, исключить собственные внутренние переводы, импортировать только однозначные и подтверждённые строки, проверить покрытие.
4. **Balances** — обновить read-only LIVE остатки пяти счетов/фондов.
5. **Data Health** — проверить свежесть ключевых источников и консистентность финансового контура.
6. **Decision Reconcile** — синхронизировать `Решения` с текущими источниками только при зелёном gate.
7. **Owner Action Queue** — обрабатывать очередь действий только после verified reconcile.

Если этап 5 заблокирован, этапы 6–7 не запускаются. Если этап 6 не доказал verified commit без drift, этап 7 не запускается.

## 4. Data Health gate

Перед записью decision state должны одновременно выполняться требования:

- обязательные источники присутствуют и не просрочены выше error-порогов;
- Tochka → DDS accounting coverage полная для eligible операций текущего контура;
- `missingCount = 0`, `missingOutflow = 0`, `missingInflow = 0` для проверяемого покрытия;
- нет ручной неоднозначной операции, оставленной без статьи ДДС;
- нет consistency error, который делает финансовое решение недостоверным.

`WARNING` по бизнес-рискам (например дефицит продаж, дефицит фонда вождения, устаревшая касса) не равен software failure, если обязательные системные источники и accounting coverage корректны. `BLOCKED` по обязательному источнику/консистентности — стоп decision writes.

Контрольная acceptance 09.09.2026 после ручного подтверждения операции 5 227 ₽ показала Tochka → DDS: `eligibleCount=40`, `coveredCount=40`, `missingCount=0`, а Data Health прошёл без consistency errors.

## 5. Decision Reconcile contract

Decision Reconcile считается успешным только если одновременно:

- `mode = commit`;
- `verified = true`;
- `matches` и `total` конечные числа;
- `matches = total`;
- остаточный `drift = 0`.

`dry-run`, `verified=false`, неполный match или drift — это не acceptance.

Production proof хранится в `Rule Engine Audit`. После успешного reconcile canonical `GET /api/decision-shadow-status` должен вернуть `MATCH` и `drift=0` с `Cache-Control: no-store`.

### Защищённая запись decision state

Синхронизация сохраняет существующую модель безопасности:

1. резервирование формульного/предыдущего состояния backend-owned полей (`H/J/M/P`);
2. атомарная запись backend-owned decision state;
3. post-write shadow verification;
4. rollback при ошибке записи или несовпадении после записи.

Не оставлять частично записанное состояние ради продолжения pipeline.

## 6. Проверка `Решения`

После verified reconcile читать `Решения!A1:V...` и сверять не только технический match, но и бизнес-смысл против текущих источников.

Контрольные примеры принятой версии:

- если `Прогноз 30 дней` показывает кассовый разрыв `0`, `DEC-CASH-GAP` должен быть неактивен/закрыт с риском `0`, а не сохранять старую сумму;
- если неподтверждённых обязательств `0`, `DEC-UNCONF-OBL` должен быть неактивен/закрыт с риском `0`;
- отсутствие критического платежа в трёхдневном окне должно закрывать `DEC-CRIT-DUE`.

Acceptance 09.09.2026: `DEC-CASH-GAP` = «Разрыва нет», `Неактивно`, `Закрыто`, `0`; `DEC-UNCONF-OBL` = «Все обязательства имеют сумму», `Неактивно`, `Закрыто`, `0`.

## 7. Owner Action Queue lifecycle

Очередь исполняется только после verified Decision Reconcile.

Жизненный цикл действия:

- принятие в работу;
- завершение результата;
- отдельная верификация эффекта.

Каждая команда должна быть идемпотентной по `requestId` и иметь фиксированный `commandStatus`/ответ. Не создавать новый READY/pending артефакт в рамках acceptance, если пользователь не инициировал новое действие.

Owner Action Queue не является платёжным механизмом. Её действия не дают права отправлять банковские распоряжения.

## 8. Ручная классификация Tochka

Когда `Контроль Точка → ДДС` показывает `ТРЕБУЕТ РАЗБОРА` / `Ручная классификация`:

1. зафиксировать дату, сумму, фонд/счёт, контрагента, назначение, `transactionId` и ключ дубля;
2. не импортировать строку в ДДС и не подбирать статью автоматически;
3. запросить явное решение собственника по конкретной операции;
4. после подтверждения записать **только подтверждённую статью** и соответствующий вид деятельности; не изменять сам банковский факт;
5. убедиться, что строка стала `Готово к ДДС`;
6. дать штатному Tochka → DDS importer перенести операцию с дедупликацией;
7. проверить, что Data Health видит `missingCount=0` и manual backlog `0` перед Decision Reconcile.

Acceptance-пример: операция ИП Егорова 5 227 ₽, transactionId `cbs-tb;2491210341;1`, была явно подтверждена собственником как `РКО`; после этого стала `РКО / Операционная / Готово к ДДС`, затем штатный run закрыл accounting gap.

## 9. Operating reserve

Operating reserve читается из `Настройки системы` как настройка `Операционный резерв`.

Правило:

- должна существовать ровно одна настройка;
- значение должно быть числовым и неотрицательным;
- отсутствие, дубль, нечисловое или отрицательное значение => fail-closed (`OPERATING_RESERVE_UNDEFINED`) и `safeWithdrawal=0`;
- изменение значения — управленческое решение собственника, а не техническая правка для прохождения тестов.

На принятой версии operating reserve = `550000 ₽`. Он отдельный от forecast safety reserve `300000 ₽`.

## 10. `safeWithdrawal=0` — корректный результат

`safeWithdrawal=0` сам по себе **не является дефектом**.

Если ликвидные деньги после обязательных ограничений, operating reserve, фондовых дефицитов и других policy caps не оставляют безопасного остатка для вывода, система обязана вернуть `0`.

Не уменьшать operating reserve, не менять Driving Fund и не обходить `LIQUIDITY_CAP` ради положительного числа.

## 11. Business risk vs software defect

**Business risk / рабочий выход системы:**

- `safeWithdrawal=0` при реальном дефиците;
- дефицит фонда вождения;
- отставание продаж/сбора от плана;
- высокая дебиторка;
- устаревшие кассовые факты филиалов;
- предупреждение Data Health, которое не нарушает обязательную консистентность.

**Software/data-pipeline defect:**

- обязательный источник не обновляется в пределах error-порога;
- eligible операция Точки потеряна между source и ДДС после того, как она однозначна/подтверждена;
- Decision Reconcile не делает verified commit или оставляет drift;
- актуальные источники и `Решения` расходятся после verified reconcile;
- Owner Action Queue запускается до прохождения gate;
- auth/no-store/security contract нарушен.

Не маскировать business risk изменением software policy.

## 12. Rollback / incident procedure

При сбое production:

1. установить точный failing stage и exact deployment SHA;
2. не запускать вручную finance-run для имитации успешного cron и не обходить cron auth;
3. если Data Health BLOCKED — исправлять источник/классификацию только законным подтверждённым способом; decision writes не запускать;
4. если reconcile unverified/drift — остановить очередь действий; использовать встроенный rollback decision state;
5. если проблема появилась после runtime deploy — откатить runtime на последний принятый SHA/deployment, не меняя финансовые факты;
6. после rollback заново доказать health, Data Health, verified reconcile и shadow MATCH;
7. документировать incident отдельно от business-warning.

## 13. Production verification checklist

Перед заявлением «готово» собрать свежие доказательства:

- `main` указывает на ожидаемый SHA;
- GitHub CI на exact SHA зелёный, полный тестовый набор без failure;
- exact Vercel deployment `READY`, commit SHA совпадает;
- canonical `/api/health` = HTTP 200;
- защищённый Owner endpoint без авторизации = HTTP 403 и `Cache-Control: no-store`;
- реальный scheduled finance run (для runtime-изменений) дошёл до Data Health → Decision Reconcile → Owner Action Queue;
- `Rule Engine Audit` = `commit`, `verified=true`, `matches=total`;
- `/api/decision-shadow-status` = `MATCH`, `drift=0`;
- `Решения` отражает текущие факты;
- Owner Action Queue не содержит нового непроцессированного acceptance-артефакта.

Нельзя объявлять завершение только по unit tests, только по CI или только по READY deployment — runtime-финансовый контур должен быть доказан отдельно при изменении runtime logic.

## 14. Post-v1

Текущий v1 scope после финальной acceptance и merge этого docs-only runbook считается закрытым. Новые функции, изменение финансовой политики, новые интеграции и расширение Decision/Execution Layer выполняются как post-v1 scope отдельными PR и отдельной acceptance, без ретроактивного изменения критериев принятой v1.
