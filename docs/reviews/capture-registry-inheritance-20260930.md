# Наследование полного реестра capture — 30.09.2026

Задача `capture-registry-inheritance-20260930`, owner `demo-engine`, fence 1. Вход `art-6969c306-a3c1-4c78-83ee-cb92e7eba42f`. Изменены только `scripts/pack-browser-observations.ts`, `tests/integration/operator-capture.test.ts` и этот документ. Store, сервер, исходные capture, целевая БД и другие файлы проекта не изменялись. Коммита не было.

**Реализовано; локальные проверки PASS, независимая приёмка ожидается.** Фактическая пересборка пилотного stage из 371 DOM этим исполнителем не выполнялась. Root сообщил исходный дефект: полный v7 имеет 2737 известных URL, stage при наследовании того же manifest — только 1146.

## Изменение поведения

Ранее `--registry-manifest` проверял SHA только JSON и копировал `manifest.inventory.urls`. Полный проверенный реестр дополнительно содержит URL, найденные при инертном разборе DOM/selected-fields. Если такие страницы не наблюдаются в новом stage, их производные PDF/image href и другие ссылки исчезали из знаменателя.

Теперь пара `--registry-manifest PATH --registry-sha256 SHA` обязательна целиком. Пакет по этому пути проходит настоящий `validateOperatorCapture`:

- directory берётся из dirname manifest, manifestPath — basename; используются ожидаемые `teplypol-market` и source origin текущего pilot;
- проверяются внешне заданный manifest SHA, строгая схема, project/origin, полный набор разрешённых файлов, типы/пути, размеры/SHA payload, MIME и известные challenge-страницы;
- проверка завершается **до создания staging-каталога**;
- используются собственные фиксированные пределы prior capture, включая 512 MB. Уменьшенный byte budget нового stage не обязан вместить прежний полный пакет, потому что его bytes этим параметром не копируются.

В новый manifest inventory включаются **каждый `validated.inventory[].crawl_key` и все `raw_urls`**. При этом никакие `DOM_OBSERVED`/`SELECTED_FIELDS`, сами observations или файлы assets из prior не наследуются через этот параметр. Статусы вновь вычисляет обычная полная валидация нового capture; наблюдаемыми являются только действительно выбранные текущие snapshots. Прежние raw fragment/query варианты остаются в реестре. Полный размер исходного сайта остаётся UNKNOWN, состояние — PARTIAL.

Граница: это наследование проверенного URL-реестра, а не доказательство переноса всех документов, медиа, функций или фактов. Отдельная существующая обработка browser/legacy asset bytes не заменена. Image/PDF URL из прежнего DOM не превращается в подтверждённый файл нового stage только благодаря наследованию URL.

## Поведенческая регрессия

Тест запускает реальный pack CLI в отдельном временном cwd с двумя raw-директориями и настоящим валидным prior capture. Прежний условный JSON `prior-registry.json` заменён schema-complete capture с pinned DOM-файлом и собственным каталогом.

Сценарий проверяет:

1. Prior DOM содержит PDF с повторными и пустым query-параметрами, ссылку на full image, fragment/raw alias и ненаблюдённую страницу; этих адресов нет в declared inventory prior manifest.
2. Новый pack сохраняет все эти URL, предыдущую наблюдённую страницу и старые unresolved URL.
3. Отдельный stage выбирает только главную. В нём ровно один DOM observation, ноль selected-fields; прежняя observed страница и исключённая текущая raw-страница становятся UNOBSERVED. Каждый crawl key/raw URL проверенного prior остаётся в новом реестре.
4. Унаследованный image URL не становится asset-файлом. Старый фактический PDF, поступающий по отдельному существующему legacy asset-пути, сохраняет исходные bytes.
5. Изменённый prior DOM при неизменённом принятом manifest SHA отвергается по размеру/SHA **до появления output или `.pending-*`**. Исходные valid prior bytes остаются неизменными при успешном pack.
6. Сохраняются прежние проверки raw freeze, requested URL, aggregate cap и отсутствия опубликованного обрезанного пакета после превышения бюджета.

Дополнительно создана только во временном каталоге копия pack с возвращённой прежней логикой declared-inventory-only; к ней применён тот же реальный regression. **Ожидаемый FAIL** на отсутствии `https://source.example/prior-observed`. Текущие workspace исходники не подменялись. Это подтверждает, что regression обнаруживает прежнюю потерю реестра, а не только отражает новую реализацию. Временные файлы удалены с проверкой абсолютного temp-prefix.

## Выполненные команды

```text
node --disable-warning=ExperimentalWarning --test --test-name-pattern='offline pack inherits' tests/integration/operator-capture.test.ts
  1/1 PASS, 0 SKIP, 2.630 s
npm run check
  PASS
node --disable-warning=ExperimentalWarning --test tests/integration/operator-capture.test.ts
  30/30 PASS, 0 FAIL, 0 SKIP, 3.120 s
git diff --check -- scripts/pack-browser-observations.ts tests/integration/operator-capture.test.ts
  PASS
```

Read-only попытка `validateOperatorCapture` использовала **ошибочный проверочный путь** `var/pilots/teplypol-catalog-package-20260929-v7` и получила ENOENT. Фактический локальный каталог — `var/pilots/teplypol-catalog-package-20260930-v7`; root подтвердил, что он существует, успешно проверен и упакован. Ошибка даты в проверочном пути **не означает отсутствия полного пакета в workspace и не является блокером**. В этой задаче рецензент не повторил валидацию фактического полного каталога; поэтому независимый счётчик 2737/1146 и исправленный итоговый пилотный знаменатель здесь не заявляются. Указанные root pins сохранены как входы для его фактической пересборки:

- full v7: `f69b6bbd0e2a14e94d2f18a96014010e9227e7175a2815d483b17813cf39d9cf`;
- прежний stage: `03d461d4ed8efd9c5be1797e24dd23ed0907e26448d1edc639bcbb17784818ed`.

## FREEZE и следующий шаг

| Файл | SHA-256 |
| --- | --- |
| `scripts/pack-browser-observations.ts` | `a410ff91f275fd93aa67de0d64caf82b8f24dec9282f60a4aa825bcc865d3e04` |
| `tests/integration/operator-capture.test.ts` | `8a483fe1d19f351d7a1a60d3bd306ef9053e73d65df48e8b72eb9139d9e4ccad` |

Root проводит независимый review и повторно создаёт новый stage по существующему pinned full v7. Проверка приёмки: все crawl keys/raw URLs полного prior входят в новый validated inventory; observed-статусы относятся только к 371 выбранному DOM, новый capture остаётся PARTIAL/UNKNOWN. Старый stage сохраняется как свидетель дефекта. Native import, target verification и восстановление Битрикс этой задачей не выполнялись и не объявляются PASS.
