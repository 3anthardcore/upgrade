# Независимая проверка HTTP verifier — 30.09.2026

Root проверил замороженный `scripts/verify-demo-http.py` SHA `876b8bd9101ffb8694aa748cfb569fbfa320dec1980e88246f9be9722a58cf08`, контракт форм, сохранение intent до POST, точный operation GET перед повтором, строгие snapshot/action/Origin/cookie ограничения и частные файлы checkpoint. Разрешён только собственный `/__upgrade/action`; PII и исходные формы не становятся допустимым payload. TLS проверяется; redirect/proxy не расширяют назначение.

Независимый общий запуск `npm test` с явно заданным PHP 8.3.35 выполнил все шесть verifier тестов, включая настоящие HTTP fixture, потерю ответа до/после commit и cookie regressions: общий итог 373/373 PASS, 0 SKIP. Лог `var/evidence/continuation-20260930/full-test-v3.log`. Отдельно прочитаны проверки фактических state files в fixture, а не только HTTP 200.

Вердикт **ACCEPT для локального ограниченного verifier**. Проверка фильтра ограничена наблюдаемым параметром и непустым результатом; корректность всей выборки дополнительно проверяется engine tests. Реальный Битрикс, native browser form, SQL order/mail counters и сетевая изоляция ещё NOT_RUN и не входят в этот PASS. Следующий шаг — root запускает тот же закреплённый verifier на изолированном HTTPS target после активации проверенного snapshot; UNKNOWN_WRITE продолжает прежний checkpoint и ключ.
