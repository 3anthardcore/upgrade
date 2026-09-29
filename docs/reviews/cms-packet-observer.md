# Независимый review наблюдателя пакетов CMS

29.09.2026. Задача `review-cms-packet-observer-v1`, worker `cms-observer-reviewer`, fence 1, вход `art-8ac954d2-2f3a-45a1-886d-b70e4a591c89`. Проверен собственный operator helper `infra/provisioning/capture-runtime.py`, SHA-256 `c6157b3524667db40e4b3913e4678b3e22d7ee9e6791e806a68dd12430d0947a`. Он не входит в запечатанный пакет r7.

**ACCEPT для наблюдения одного ограниченного окна на eth0 выбранного PHP network namespace.** После исправлений новых блокирующих замечаний в этом scope не осталось. Ревьюер не запускал настоящий capture, HTTP или CMS, не подключался к серверу/БД, не менял Store, helper или прежние evidence. Единственный созданный файл проекта — этот review; тестовые результаты helper находились во временных каталогах WSL и удалялись средствами `TemporaryDirectory`.

## Найденные и исправленные проблемы

| Замечание | Исправление root | Независимая проверка |
|---|---|---|
| Ложный положительный DB control из четырёх байтов фрагмента, padding или обрезанного TCP | Проверяются IPv4 IHL/total length, MF/fragment offset; TCP минимум 20 байт и data offset. DB control ограничен own→database:3306 или обратным source port 3306. | Фрагменты, padding, неверный TCP offset/length и неправильное направление порта не дают PASS даже при отдельном валидном control. IPv4 options корректно сдвигают TCP header. |
| Нулевые drops при непрочитанной очереди не доказывали полноту обработки окна | Общий `frames_read` включает каждый `recv`, включая ARP/не-IP; PASS требует `socket_received == frames_read` и drops 0. | Один считанный control при socket_received 2 даёт INCONCLUSIVE_OR_FAILED; drops 1 также запрещает PASS. |
| `assert` отключал attestation и лимиты под Python `-O` | Используются явные проверки `require` с отказом. | Пять отказов до raw socket подтверждены при `sys.flags.optimize == 1`. |
| VLAN/QinQ и неизвестные EtherType молча пропускались | Отдельный счётчик unsupported Ethernet; его ненулевое значение запрещает PASS. ARP остаётся явно допустимым не-IP протоколом. | 0x8100, 0x88a8 и 0x8864 дают INCONCLUSIVE_OR_FAILED с валидным DB control. |

`PACKET_STATISTICS` возвращает число пакетов и drops; чтение статистики сбрасывает внутренние счётчики. Helper читает их один раз в конце и сопоставляет с фактически обработанными кадрами. Это сверено с [Linux packet(7)](https://man7.org/linux/man-pages/man7/packet.7.html). Локальные doubles проверяют логику решения, но не воспроизводят очередь конкретного ядра.

## Текущие границы реализации

- До raw socket сверяются точное значение `/proc/self/ns/net`, IPv4 адрес `eth0` через ioctl, различные own/database IP внутри переданного subnet, новый абсолютный output path без symlink в родительском пути и длительность 1–60 секунд. Привязку переданных namespace/IP/subnet к нужным контейнерам предварительно доказывает вызывающий root; helper не опрашивает Docker и не доказывает принадлежность database IP целевой БД.
- Приём ограничен monotonic deadline, `recv` имеет timeout 0.25 секунды; проверка deadline происходит между приёмами. Окончание может включать последний timeout. Готовность обозначает отдельный `.ready`, созданный после bind; вызывающий должен дождаться именно свежего файла своего запуска, затем связать HTTP receipt с этим окном.
- IPv4 source/destination читаются из фиксированных полей заголовка, смещение TCP вычисляется из IHL. Неподдержанная фрагментация, IPv6, malformed и unknown Ethernet запрещают PASS. ARP учитывается в общем числе обработанных кадров, но не является положительным DB control.
- `external_ipv4_from_php` означает только IPv4 от указанного own IP к адресу **вне указанного subnet**. Он не подтверждает запрет обращений к другим адресам внутри subnet, loopback, Docker DNS forwarding, другим интерфейсам или исходящего трафика хоста. Subnet и interface теперь сохранены в receipt вместе с IP и namespace.
- Положительный DB кадр подтверждает видимость этого направления в observer; сам по себе он не доказывает успешную SQL-команду или связь пакета с конкретным HTTP-запросом. Для этого нужен отдельный receipt действительного запроса и его временная привязка.
- Payload читается в память для разбора, но не включается в JSON, stdout или ready; packet dump не создаётся. Сохраняются счётчики, параметры и scope. Output и ready получают 0600; для запуска нужен заранее созданный закрытый каталог оператора. Скрипт не вызывает PHP, не отправляет пакеты, не меняет firewall и не предоставляет CMS новые разрешения.
- Любой провал условия даёт `INCONCLUSIVE_OR_FAILED` и exit 1; отсутствие положительного control не превращается в PASS. `historical_first_bootstrap` и `future_requests` всегда `NOT_VERIFIED`, HTTP требует отдельного receipt.

## Фактические локальные проверки

Команда запуска независимого harness через stdin: `wsl.exe --distribution Ubuntu --exec python3 -O -`. Harness использовал `runpy.run_path` над текущим helper; `socket.socket`, `fcntl.ioctl`, ответ только для `/proc/self/ns/net` и monotonic clock подменялись через `unittest.mock`. Другие файловые операции выполнялись в настоящем отдельном `tempfile.TemporaryDirectory`. Реального raw socket или сетевого обращения не было. Python optimization = 1.

**25/25 PASS, 0 FAIL**:

| Группа | Точные случаи | Ожидаемый результат helper |
|---|---|---|
| 3 положительных | own→database:3306 с payload canary; database:3306→own; IPv4 IHL 6 с options | PASS / exit 0 |
| 17 отрицательных | ARP без DB control; MF; noninitial fragment; IPv4 total length 20 с байтами TCP в padding; TCP data offset 4; data offset 15 при коротком сегменте; total length больше frame; исходящий 1.1.1.1; IPv6; VLAN 0x8100; QinQ 0x88a8; EtherType 0x8864; drops 1; received 2 при read 1; own source port 3306 к database port 80; Ethernet короче 14; IPv4 IHL 4 | INCONCLUSIVE_OR_FAILED / exit 1 |
| 5 guards под -O | Чужой namespace; другой ioctl IP; seconds 0; seconds 61; совпадающие own/database IP | Отказ до создания raw socket |

Для каждой записанной пары output/ready проверялись mode 0600, отсутствие `REVIEW_PAYLOAD_CANARY_DO_NOT_PERSIST` в обоих файлах и stdout, сохранённые subnet/interface и неизменные historical/future ограничения. В негативных packet cases, кроме отсутствующего/неверного control, присутствовал отдельный валидный DB control: отказ проверялся по дефекту наблюдения, а не только по пустому окну.

До последнего расширения также выполнен отдельный четырёхслучайный прогон текущего на тот момент helper: валидный control, noninitial fragment, padding-fake-ports и unread socket packet дали ожидаемые результаты 4/4. Итоговые 25 проверок охватывают эти границы; это не 29 независимых сценариев.

```json
[
  {"id":"observer-parser-and-completeness","status":"PASS","details":"20 synthetic packet cases; positive DB visibility required; malformed, IPv6, unsupported EtherType, drops and unread packets fail closed."},
  {"id":"observer-attestation-optimized-python","status":"PASS","details":"5 namespace/interface/peer/duration guards reject before raw socket under Python -O."},
  {"id":"observer-metadata-only-output","status":"PASS","details":"Payload canary absent from output/ready/stdout; 0600 and scope boundaries verified in real temporary files."},
  {"id":"actual-current-cms-packet-window","status":"NOT_RUN","details":"Reviewer did not run the server observer or HTTP. Requires separately accepted root receipt."},
  {"id":"historical-first-bootstrap-at28","status":"NOT_RUN","details":"Earlier first-window capture remains INCONCLUSIVE; this helper does not retrospectively verify it."}
]
```

Следующий шаг root: проверить выбранные namespace/IP/subnet по текущему контейнеру, запустить observer по принятому SHA, дождаться свежего ready, выполнить отдельно принятый known-page request, сохранить exit/status/counts и HTTP receipt. PASS разрешено описывать только как отсутствие наблюдавшихся запрещённых классов кадров в данном текущем окне с положительным DB control. Ранее зафиксированный INCONCLUSIVE первого bootstrap не изменяется; DEMO_READY и полная изоляция CMS этим наблюдением не устанавливаются.
