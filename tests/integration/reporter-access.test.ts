import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { Store } from "../../packages/core/index.ts";
import { writeReport } from "../../packages/reporter/index.ts";

const sourceUrl = "https://source.example/catalog/?kind=heating&view=full";
function crawl(state: "PAUSED" | "COMPLETE", statuses: string[]) {
  return {
    schema_version: 1,
    source_origin: "https://source.example",
    state,
    ...(state === "COMPLETE" ? { access: { version: 1, blocks: [] } } : {}),
    entries: statuses.map((status, i) => ({
      crawl_key: `https://source.example/page-${i}`,
      status,
    })),
    assets: [],
    limitations: [],
    counters: { requests: 2, pages: 0, bytes: 128 },
    discovery: {
      robots_done: true,
      sitemap_queue: [] as string[],
      sitemap_done: [],
    },
  };
}
function publish(store: Store, name: string, value: unknown) {
  return store.publishArtifact(name, JSON.stringify(value));
}
function persistedReport(
  prepare: (store: Store) => void,
  inspect: (report: any, html: string, markdown: string) => void,
  plan = true,
) {
  const directory = mkdtempSync(join(tmpdir(), "upgrade-reporter-access-"));
  let store: Store | undefined;
  try {
    store = new Store(directory);
    store.createProject("report-pilot", sourceUrl);
    if (plan) store.planRun();
    prepare(store);
    store.close();
    store = new Store(directory); // Report must derive everything from disk after restart.
    const result = writeReport(store);
    const report = JSON.parse(readFileSync(result.json, "utf8"));
    const html = readFileSync(result.html, "utf8");
    const markdown = readFileSync(result.summary, "utf8");
    assert.equal(result.readiness, "NOT_READY");
    assert.equal(report.readiness, "NOT_READY");
    assert.ok(html.includes(report.headline));
    assert.ok(markdown.includes(report.headline.replaceAll("_", "\\_")));
    assert.ok(html.includes(report.next_step));
    assert.ok(markdown.includes(report.next_step));
    inspect(report, html, markdown);
  } finally {
    store?.close();
    const target = resolve(directory);
    assert.equal(dirname(target), resolve(tmpdir()));
    assert.match(basename(target), /^upgrade-reporter-access-[a-zA-Z0-9_-]+$/);
    rmSync(target, { recursive: true, force: true });
  }
}

test("fresh persisted project reports unstarted discovery and unknown site size", () => {
  persistedReport(
    () => {},
    (report, html, markdown) => {
      assert.equal(report.source.url, sourceUrl);
      assert.equal(report.source.origin, "https://source.example");
      assert.equal(report.source.state, "NOT_STARTED");
      assert.equal(report.source.registry.available, false);
      assert.equal(report.source.registry.denominator, 0);
      assert.equal(report.source.registry.queued, 0);
      assert.equal(report.source.total_site_urls, null);
      assert.equal(report.source.total_site_urls_status, "UNKNOWN");
      assert.match(report.headline, /исследование источника не начато/);
      assert.match(report.next_step, /^Начать исследование источника/);
      assert.doesNotMatch(report.next_step, /Битрикс/);
      assert.equal(report.entities, 0);
      assert.equal(report.content.state, "NOT_EXTRACTED");
      assert.equal(report.content.source_catalog_size, null);
      for (const rendered of [html, markdown]) {
        assert.match(
          rendered,
          /0 сохранённых сущностей не означает пустой каталог/,
        );
        assert.match(rendered, /Полный размер исходного сайта неизвестен/);
        assert.ok(rendered.includes(sourceUrl.replaceAll("&", "&amp;")));
      }
    },
    false,
  );
});

test("paused persisted discovery without access metadata uses registry counts, not QA counts", () => {
  persistedReport(
    (store) => {
      const source = crawl("PAUSED", [
        "FETCHED",
        "DISCOVERED",
        "RATE_LIMITED",
        "EXCLUDED",
      ]);
      source.discovery.sitemap_queue.push("https://source.example/sitemap.xml");
      publish(store, "crawl-result.json", source);
      publish(store, "qa-report.json", {
        counts: { discovered: 999 },
        checks: [],
      });
      store.setRunStatus("PAUSED");
    },
    (report, html, markdown) => {
      assert.equal(report.source.state, "PAUSED");
      assert.equal(report.source.registry.denominator, 4);
      assert.equal(report.source.registry.in_scope, 3);
      assert.equal(report.source.registry.queued, 2);
      assert.equal(report.source.registry.rate_limited, 1);
      assert.equal(report.source.registry.requires_access, 0);
      assert.equal(report.source.frontier.sitemap_queued, 1);
      assert.equal(report.source.counts.requests, 2);
      assert.equal(report.source.access_blocked, false);
      assert.deepEqual(report.source.access.blocks, []);
      assert.match(report.headline, /исследование источника не завершено/);
      assert.match(report.next_step, /^Продолжить исследование источника/);
      for (const rendered of [html, markdown]) {
        assert.match(
          rendered,
          /Известный реестр: 4 URL; в scope: 3; в очереди: 2/,
        );
        assert.match(rendered, /Sitemap в очереди: 1/);
      }
    },
  );
});

test("persisted active robots challenge blocks source discovery even with HTTP 200 and queued seed", () => {
  const injected = "<script>alert(1)</script> [run](javascript:alert(2))";
  persistedReport(
    (store) => {
      publish(store, "crawl-result.json", {
        ...crawl("PAUSED", ["DISCOVERED", "EXCLUDED"]),
        access: {
          active_block_id: "access-1",
          blocks: [
            {
              id: "access-1",
              url: "https://source.example/robots.txt",
              stage: "robots",
              reason: injected,
              provider: "FixtureChallenge",
              signals: ["verification challenge"],
              body_sha256: "a".repeat(64),
              http_status: 200,
              observed_at: "2026-09-29T00:00:00Z",
            },
          ],
        },
        limitations: [injected],
      });
      store.setRunStatus("PAUSED");
    },
    (report, html, markdown) => {
      assert.equal(report.source.access_blocked, true);
      assert.equal(report.source.access.active_block_id, "access-1");
      assert.equal(report.source.registry.denominator, 2);
      assert.equal(report.source.registry.queued, 1);
      assert.equal(report.source.registry.requires_access, 0);
      assert.equal(report.source.access.blocks[0].http_status, 200);
      assert.equal(report.source.access.blocks[0].reason, injected);
      assert.match(report.headline, /доступ к источнику ограничен/);
      assert.match(
        report.next_step,
        /^Получить разрешённый доступ к источнику/,
      );
      assert.doesNotMatch(report.next_step, /Битрикс/);
      for (const rendered of [html, markdown]) {
        assert.doesNotMatch(rendered, /<script>/i);
        assert.match(rendered, /&lt;script&gt;/);
        assert.match(rendered, /Активное ограничение доступа: да/);
      }
      assert.ok(markdown.includes("\\[run\\](javascript:alert(2))"));
      assert.ok(!markdown.includes("[run](javascript:"));
    },
  );
});

test("REQUIRES_ACCESS registry entry is blocking without optional access metadata", () => {
  persistedReport(
    (store) => {
      publish(
        store,
        "crawl-result.json",
        crawl("PAUSED", ["REQUIRES_ACCESS", "DISCOVERED"]),
      );
    },
    (report) => {
      assert.equal(report.source.access_blocked, true);
      assert.equal(report.source.registry.requires_access, 1);
      assert.equal(report.source.registry.queued, 1);
      assert.match(report.next_step, /^Получить разрешённый доступ/);
    },
  );
});

test("completed persisted fixture keeps Bitrix NOT_READY gate and bounded source registry", () => {
  persistedReport(
    (store) => {
      publish(store, "crawl-result.json", {
        ...crawl("COMPLETE", ["FETCHED", "RENDERED", "EXCLUDED"]),
        access: {
          version: 1,
          blocks: [{ id: "old-resolved", reason: "Previously blocked" }],
        },
      });
      publish(store, "content-model.json", {
        entities: [{ source_id: "page-one" }],
        limitations: [],
      });
      publish(store, "qa-report.json", {
        counts: { discovered: 3 },
        checks: [
          {
            id: "bitrix-runtime",
            status: "NOT_RUN",
            details: "No licensed target",
          },
        ],
      });
    },
    (report, html, markdown) => {
      assert.equal(report.source.state, "COMPLETE");
      assert.equal(report.source.access_blocked, false);
      assert.equal(report.source.registry.denominator, 3);
      assert.equal(report.source.registry.in_scope, 2);
      assert.equal(report.source.total_site_urls, null);
      assert.equal(report.content.observed_entities, 1);
      assert.equal(report.entities, 1);
      assert.match(report.headline, /интеграция Битрикс не подтверждена/);
      assert.match(report.next_step, /^Настроить изолированный Битрикс/);
      assert.equal(report.qa.checks[0].status, "NOT_RUN");
      for (const rendered of [html, markdown]) {
        assert.match(rendered, /Извлечено сущностей: 1/);
        assert.match(rendered, /размер каталога источника не установлен/);
      }
    },
  );
});

for (const code of [
  "STORED_ACCESS_CHALLENGE",
  "ACCESS_REVALIDATION_REQUIRED",
  "ACCESS_REQUIRED",
]) {
  test(`current persisted ${code} guard prevents legacy COMPLETE from advancing to Bitrix`, () => {
    const reason =
      "Stored access evidence <img src=x onerror=alert(1)> requires review";
    let sourceId: string;
    persistedReport(
      (store) => {
        sourceId = publish(
          store,
          "crawl-result.json",
          crawl("COMPLETE", ["FETCHED"]),
        ).artifact_id;
        publish(store, "source-access-error.json", {
          source_artifact_id: sourceId,
          code,
          reason,
          recorded_at: "2026-09-29T01:00:00Z",
        });
        store.setRunStatus("PAUSED");
      },
      (report, html, markdown) => {
        assert.equal(report.source.artifact_id, sourceId);
        assert.equal(report.source.guard_error.source_artifact_id, sourceId);
        assert.equal(report.source.guard_error.code, code);
        assert.equal(report.source.recorded_state, "COMPLETE");
        assert.equal(report.source.state, "PAUSED");
        assert.equal(report.source.registry.fetched, 0);
        assert.equal(report.source.registry.recorded_fetched, 1);
        assert.equal(report.source.registry.requires_revalidation, 1);
        assert.ok(report.limitations.includes(reason));
        assert.doesNotMatch(report.next_step, /Битрикс/);
        if (code === "ACCESS_REVALIDATION_REQUIRED") {
          assert.equal(report.source.access_blocked, false);
          assert.equal(report.source.gate, code);
          assert.match(
            report.next_step,
            /robots\.txt командой crawl с прежними лимитами/,
          );
          assert.doesNotMatch(report.headline, /доступ к источнику ограничен/);
          assert.match(
            report.source.summary,
            /блокировка провайдером не подтверждена/,
          );
        } else {
          assert.equal(report.source.access_blocked, true);
          assert.equal(report.source.gate, "ACCESS_REQUIRED");
          assert.match(report.next_step, /^Получить разрешённый доступ/);
        }
        for (const rendered of [html, markdown]) {
          assert.doesNotMatch(rendered, /<img src=x/);
          assert.match(rendered, /&lt;img src=x onerror=alert\(1\)&gt;/);
        }
      },
    );
  });
}

test("guard for a previous crawl artifact does not block a newly completed crawl", () => {
  const staleReason = "STALE_GUARD_MUST_NOT_REAPPEAR";
  let currentId: string;
  persistedReport(
    (store) => {
      const old = publish(
        store,
        "crawl-result.json",
        crawl("COMPLETE", ["FETCHED"]),
      );
      publish(store, "source-access-error.json", {
        source_artifact_id: old.artifact_id,
        code: "STORED_ACCESS_CHALLENGE",
        reason: staleReason,
        recorded_at: "2026-09-29T01:00:00Z",
      });
      store.setRunStatus("PAUSED");
      currentId = publish(
        store,
        "crawl-result.json",
        crawl("COMPLETE", ["FETCHED", "RENDERED"]),
      ).artifact_id;
    },
    (report, html, markdown) => {
      assert.equal(report.source.artifact_id, currentId);
      assert.equal(report.source.guard_error, null);
      assert.equal(report.source.state, "COMPLETE");
      assert.equal(report.source.gate, "COMPLETE");
      assert.equal(report.source.registry.denominator, 2);
      assert.equal(report.source.access_blocked, false);
      assert.match(report.next_step, /^Настроить изолированный Битрикс/);
      for (const rendered of [JSON.stringify(report), html, markdown]) {
        assert.ok(!rendered.includes(staleReason));
      }
    },
  );
});

test("direct report of legacy COMPLETE without a current access marker requires revalidation", () => {
  for (const access of [
    undefined,
    { blocks: [] },
    { version: 0, blocks: [] },
  ]) {
    let sourceId: string;
    persistedReport(
      (store) => {
        sourceId = publish(store, "crawl-result.json", {
          ...crawl("COMPLETE", ["FETCHED"]),
          access,
        }).artifact_id;
        // No source-access-error artifact and no extract/network operation precedes report.
      },
      (report, html, markdown) => {
        assert.equal(report.source.guard_error.source_artifact_id, sourceId);
        assert.equal(
          report.source.guard_error.origin,
          "report-compatibility-check",
        );
        assert.equal(report.source.gate, "ACCESS_REVALIDATION_REQUIRED");
        assert.equal(report.source.state, "PAUSED");
        assert.equal(report.source.recorded_state, "COMPLETE");
        assert.equal(report.source.access_blocked, false);
        assert.equal(report.source.registry.fetched, 0);
        assert.equal(report.source.registry.requires_revalidation, 1);
        assert.match(
          report.next_step,
          /robots\.txt командой crawl с прежними лимитами/,
        );
        assert.doesNotMatch(report.next_step, /Битрикс/);
        for (const rendered of [html, markdown]) {
          assert.ok(rendered.includes("access.version=1"));
          assert.match(rendered, /блокировка провайдером не подтверждена/);
        }
      },
    );
  }
});
