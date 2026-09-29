import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Store, inside } from "../core/index.ts";
import type { Artifact } from "../contracts/index.ts";
const esc = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function writeReport(store: Store) {
  const artifacts = store.list<Artifact>("artifact");
  const latest = (type: string) => {
    const a = artifacts.filter((a) => a.type === type).at(-1);
    if (!a) return null;
    store.validateArtifact(a.artifact_id);
    return JSON.parse(
      readFileSync(inside(store.root, a.relative_path), "utf8"),
    );
  };
  const status = store.getStatus();
  const qa = latest("qa-report.json");
  const source = latest("crawl-result.json");
  const content = latest("content-model.json");
  const release = latest("release-manifest.json");
  const report = {
    schema_version: 1,
    project_id: status.project.project_id,
    phase: status.run?.phase,
    execution_status: status.run?.execution_status,
    readiness: "NOT_READY",
    source: {
      origin: source?.source_origin,
      state: source?.state,
      counts: qa?.counts ?? source?.counters,
    },
    qa,
    entities: content?.entities.length ?? 0,
    limitations: [
      ...new Set([
        ...(source?.limitations ?? []),
        ...(content?.limitations ?? []),
        ...(release?.warnings ?? []),
        ...(release?.blockers ?? []),
        "Настоящий Битрикс, административная часть, production-интеграции и восстановление Битрикс: NOT_RUN.",
      ]),
    ],
    cost: {
      budget: status.run?.budget,
      monetary_status: "UNAVAILABLE",
      tokens_status: "See individual agent results; unavailable is not zero",
    },
    next_step:
      "Настроить изолированный Битрикс и выполнить импорт, URL/контент/сценарии/админку и backup restore.",
    resume: `npm run upgrade -- resume --project ${status.project.project_id}`,
    generated_at: new Date().toISOString(),
  };
  const dir = inside(store.root, "reports");
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "report.json"), JSON.stringify(report, null, 2));
  const rows = (qa?.checks ?? [])
    .map(
      (c: any) =>
        `<tr><td>${esc(c.id)}</td><td>${esc(c.status)}</td><td>${esc(c.details)}</td></tr>`,
    )
    .join("");
  const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex,nofollow"><title>Upgrade — ${esc(report.project_id)}</title><style>body{font:16px/1.6 system-ui;background:#f4f5f3;color:#172429;max-width:1100px;margin:auto;padding:32px}h1{font-size:40px}.status{background:#fff0d5;padding:20px;border-radius:12px}table{width:100%;border-collapse:collapse;background:white}td,th{text-align:left;border-bottom:1px solid #ddd;padding:12px}pre{white-space:pre-wrap;overflow-wrap:anywhere}li{margin-bottom:8px}@media(max-width:600px){body{padding:16px}table{display:block;overflow:auto}}</style><header><p>UPGRADE · ПРОВЕРЯЕМЫЙ ПЕРЕНОС</p><h1>${esc(report.project_id)}</h1></header><main><div class="status"><strong>NOT_READY — интеграция Битрикс не подтверждена</strong><p>Этап: ${esc(report.phase)}. Состояние: ${esc(report.execution_status)}.</p></div><h2>Реестр исходных адресов</h2><pre>${esc(JSON.stringify(report.source, null, 2))}</pre><h2>Независимые проверки</h2><table><thead><tr><th>Проверка</th><th>Результат</th><th>Подтверждение / ограничение</th></tr></thead><tbody>${rows}</tbody></table><h2>Границы переноса</h2><ul>${report.limitations.map((x) => `<li>${esc(x)}</li>`).join("")}</ul><h2>Продолжение</h2><p>${esc(report.next_step)}</p><code>${esc(report.resume)}</code><h2>Расходы</h2><pre>${esc(JSON.stringify(report.cost, null, 2))}</pre></main></html>`;
  writeFileSync(resolve(dir, "index.html"), html);
  writeFileSync(
    resolve(dir, "summary.md"),
    `# ${report.project_id}\n\nNOT_READY. ${report.phase} / ${report.execution_status}.\n\n${report.next_step}\n\nОграничения:\n${report.limitations.map((x) => "- " + x).join("\n")}\n\nПродолжение: \`${report.resume}\`\n`,
  );
  return {
    json: resolve(dir, "report.json"),
    html: resolve(dir, "index.html"),
    summary: resolve(dir, "summary.md"),
    readiness: "NOT_READY",
  };
}
