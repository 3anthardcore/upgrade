import { resolve } from "node:path";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { startFixtureServer } from "../tests/fixtures/sites/server.ts";
import { Store, projectRoot } from "../packages/core/index.ts";
import { Pipeline } from "../packages/core/pipeline.ts";
const fixtureId = process.env.UPGRADE_FIXTURE_PROJECT ?? "fixture-demo-v2";
const root = projectRoot(
  process.env.UPGRADE_DATA_DIR ?? "var/projects",
  fixtureId,
);
const fixture = await startFixtureServer({ port: 8787 });
const store = new Store(root);
try {
  if (!store.list("project").length)
    store.createProject(fixtureId, fixture.url);
  store.planRun(100, 7200);
  if (store.currentRun().execution_status !== "ACTIVE") store.resumeRun();
  const pipeline = new Pipeline(store, { fixtureOrigin: fixture.origin });
  const result = await pipeline.run();
  console.log(
    JSON.stringify(
      {
        status: result.status,
        report: resolve(root, "reports/index.html"),
        state: resolve(root, "state/upgrade.db"),
        source_side_effects: fixture.sideEffects,
        notice: "Synthetic source and package only; actual Bitrix NOT_RUN.",
      },
      null,
      2,
    ),
  );
} catch (e) {
  store.setRunStatus("BLOCKED");
  new Pipeline(store).report();
  throw e;
} finally {
  store.close();
  await fixture.close();
}
