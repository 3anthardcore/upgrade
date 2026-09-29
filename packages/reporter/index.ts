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
const markdown = (s: unknown) =>
  esc(s)
    .replace(/([\\`*_\[\]#|])/g, "\\$1")
    .replace(/[\r\n]+/g, " ");
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
  const sourceArtifact = artifacts
    .filter((a) => a.type === "crawl-result.json")
    .at(-1);
  const accessError = latest("source-access-error.json");
  const persistedGuardError =
    sourceArtifact &&
    accessError?.source_artifact_id === sourceArtifact.artifact_id &&
    [
      "STORED_ACCESS_CHALLENGE",
      "ACCESS_REVALIDATION_REQUIRED",
      "ACCESS_REQUIRED",
    ].includes(accessError.code)
      ? accessError
      : null;
  const guardError =
    persistedGuardError ??
    (source?.state === "COMPLETE" && source?.access?.version !== 1
      ? {
          source_artifact_id: sourceArtifact!.artifact_id,
          code: "ACCESS_REVALIDATION_REQUIRED",
          reason:
            "Сохранённый COMPLETE не содержит access.version=1; требуется повторная проверка robots.txt перед использованием исходного контента.",
          origin: "report-compatibility-check",
        }
      : null);
  const content = latest("content-model.json");
  const release = latest("release-manifest.json");
  const entries: Array<{ status: string }> = source?.entries ?? [];
  const count = (...states: string[]) =>
    entries.filter((entry) => states.includes(entry.status)).length;
  const recordedSourceState =
    source?.state ??
    (status.run?.execution_status === "PAUSED" ? "PAUSED" : "NOT_STARTED");
  const sourceState = guardError ? "PAUSED" : recordedSourceState;
  const registry = {
    basis: "discovered-source-registry",
    available: Boolean(source),
    denominator: entries.length,
    in_scope: entries.length - count("EXCLUDED"),
    excluded: count("EXCLUDED"),
    queued: count("DISCOVERED", "RATE_LIMITED"),
    requires_access: count("REQUIRES_ACCESS"),
    rate_limited: count("RATE_LIMITED"),
    fetched: guardError ? 0 : count("FETCHED", "RENDERED"),
    recorded_fetched: count("FETCHED", "RENDERED"),
    requires_revalidation: guardError ? count("FETCHED", "RENDERED") : 0,
    failed: count("FAILED", "UNREACHABLE", "REQUIRES_ACCESS", "RATE_LIMITED"),
  };
  const access = source?.access ?? { blocks: [] };
  const accessBlocked =
    Boolean(access.active_block_id) ||
    registry.requires_access > 0 ||
    ["STORED_ACCESS_CHALLENGE", "ACCESS_REQUIRED"].includes(guardError?.code);
  const needsRevalidation = guardError?.code === "ACCESS_REVALIDATION_REQUIRED";
  const incomplete = sourceState !== "COMPLETE" || accessBlocked;
  const entryUrl = status.project.source.entry_url;
  const extentNote =
    "Полный размер исходного сайта неизвестен; реестр содержит только обнаруженные URL и не доказывает полноту всего сайта.";
  const sourceSummary =
    `Исходный URL: ${entryUrl}. Исследование: ${sourceState}. ` +
    `Известный реестр: ${registry.denominator} URL; в scope: ${registry.in_scope}; ` +
    `в очереди: ${registry.queued}; требуют доступа: ${registry.requires_access}; ` +
    `ограничены по частоте: ${registry.rate_limited}; исключены: ${registry.excluded}; ` +
    `получены: ${registry.fetched}; с ошибкой или недоступны: ${registry.failed}. ` +
    `Требуют повторной проверки: ${registry.requires_revalidation}. ` +
    `Sitemap в очереди: ${source?.discovery?.sitemap_queue?.length ?? 0}. ` +
    `Зафиксировано ограничений доступа: ${access.blocks?.length ?? 0}. ` +
    `Активное ограничение доступа: ${accessBlocked ? "да" : "не зарегистрировано"}. ` +
    (needsRevalidation && !accessBlocked
      ? "Требуется повторная проверка robots.txt; блокировка провайдером не подтверждена. "
      : "") +
    "Сведения относятся к сохранённому автоматическому обходу, а не ко всем способам доступа к сайту. " +
    extentNote;
  const entities = content?.entities?.length ?? 0;
  const contentNote = content
    ? `Извлечено сущностей: ${entities}. Это число относится к сохранённой модели; размер каталога источника не установлен.`
    : "Контент ещё не извлечён. 0 сохранённых сущностей не означает пустой каталог источника.";
  const headline = accessBlocked
    ? "NOT_READY — автоматический доступ к источнику ограничен"
    : needsRevalidation
      ? "NOT_READY — требуется повторная проверка доступа к источнику"
      : incomplete
        ? sourceState === "NOT_STARTED"
          ? "NOT_READY — исследование источника не начато"
          : "NOT_READY — исследование источника не завершено"
        : "NOT_READY — интеграция Битрикс не подтверждена";
  const nextStep = accessBlocked
    ? "Получить разрешённый доступ к источнику или согласованный экспорт. После снятия ограничения продолжить исследование и проверить исходный реестр URL."
    : needsRevalidation
      ? "Повторно проверить robots.txt командой crawl с прежними лимитами и сохранёнными правилами доступа; после проверки продолжить исследование источника."
      : incomplete
        ? sourceState === "NOT_STARTED"
          ? "Начать исследование источника и сформировать исходный реестр URL, соблюдая разрешённый доступ и лимиты."
          : "Продолжить исследование источника с сохранённого состояния: проверить доступ, ограничения и оставшуюся очередь URL."
        : "Настроить изолированный Битрикс и выполнить импорт, URL/контент/сценарии/админку и backup restore.";
  const report = {
    schema_version: 1,
    project_id: status.project.project_id,
    phase: status.run?.phase ?? "NOT_STARTED",
    execution_status: status.run?.execution_status ?? "NOT_STARTED",
    readiness: "NOT_READY",
    headline,
    source: {
      url: entryUrl,
      origin: source?.source_origin ?? new URL(entryUrl).origin,
      state: sourceState,
      recorded_state: recordedSourceState,
      artifact_id: sourceArtifact?.artifact_id ?? null,
      guard_error: guardError,
      gate: accessBlocked
        ? "ACCESS_REQUIRED"
        : needsRevalidation
          ? "ACCESS_REVALIDATION_REQUIRED"
          : incomplete
            ? "DISCOVERY_INCOMPLETE"
            : "COMPLETE",
      counts: source?.counters ?? null,
      registry,
      access_blocked: accessBlocked,
      access,
      frontier: {
        robots_done: source?.discovery?.robots_done ?? false,
        sitemap_queued: source?.discovery?.sitemap_queue?.length ?? 0,
      },
      total_site_urls: null,
      total_site_urls_status: "UNKNOWN",
      extent_note: extentNote,
      summary: sourceSummary,
    },
    qa,
    entities,
    content: {
      state: content ? "EXTRACTED" : "NOT_EXTRACTED",
      observed_entities: entities,
      source_catalog_size: null,
      note: contentNote,
    },
    limitations: [
      ...new Set([
        ...(source?.limitations ?? []),
        ...(content?.limitations ?? []),
        ...(release?.warnings ?? []),
        ...(release?.blockers ?? []),
        ...(guardError ? [String(guardError.reason)] : []),
        ...(incomplete
          ? [
              "Исследование источника не завершено; полнота контента и исходного реестра не подтверждена.",
            ]
          : []),
        "Настоящий Битрикс, административная часть, production-интеграции и восстановление Битрикс: NOT_RUN.",
      ]),
    ],
    cost: {
      budget: status.run?.budget,
      monetary_status: "UNAVAILABLE",
      tokens_status: "See individual agent results; unavailable is not zero",
    },
    next_step: nextStep,
    resume: `npm run upgrade -- ${status.run ? "resume" : "plan"} --project ${status.project.project_id}`,
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
  const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex,nofollow"><title>Upgrade — ${esc(report.project_id)}</title><style>body{font:16px/1.6 system-ui;background:#f4f5f3;color:#172429;max-width:1100px;margin:auto;padding:32px}h1{font-size:40px}.status{background:#fff0d5;padding:20px;border-radius:12px}table{width:100%;border-collapse:collapse;background:white}td,th{text-align:left;border-bottom:1px solid #ddd;padding:12px}pre{white-space:pre-wrap;overflow-wrap:anywhere}li{margin-bottom:8px}@media(max-width:600px){body{padding:16px}table{display:block;overflow:auto}}</style><header><p>UPGRADE · ПРОВЕРЯЕМЫЙ ПЕРЕНОС</p><h1>${esc(report.project_id)}</h1></header><main><div class="status"><strong>${esc(report.headline)}</strong><p>Этап: ${esc(report.phase)}. Состояние: ${esc(report.execution_status)}.</p></div><h2>Реестр исходных адресов</h2><p>${esc(report.source.summary)}</p><pre>${esc(JSON.stringify(report.source, null, 2))}</pre><h2>Контент</h2><p>${esc(report.content.note)}</p><h2>Независимые проверки</h2><table><thead><tr><th>Проверка</th><th>Результат</th><th>Подтверждение / ограничение</th></tr></thead><tbody>${rows}</tbody></table><h2>Границы переноса</h2><ul>${report.limitations.map((x) => `<li>${esc(x)}</li>`).join("")}</ul><h2>Продолжение</h2><p>${esc(report.next_step)}</p><code>${esc(report.resume)}</code><h2>Расходы</h2><pre>${esc(JSON.stringify(report.cost, null, 2))}</pre></main></html>`;
  writeFileSync(resolve(dir, "index.html"), html);
  writeFileSync(
    resolve(dir, "summary.md"),
    `# ${markdown(report.project_id)}\n\n${markdown(report.headline)}. ${markdown(report.phase)} / ${markdown(report.execution_status)}.\n\n${markdown(report.source.summary)}\n\n${markdown(report.content.note)}\n\nДоступ к источнику:\n${(report.source.access.blocks ?? []).map((block: unknown) => "- " + markdown(JSON.stringify(block))).join("\n") || "- Ограничения не зарегистрированы."}\n\n${markdown(report.next_step)}\n\nОграничения:\n${report.limitations.map((x) => "- " + markdown(x)).join("\n")}\n\nПродолжение: ${markdown(report.resume)}\n`,
  );
  return {
    json: resolve(dir, "report.json"),
    html: resolve(dir, "index.html"),
    summary: resolve(dir, "summary.md"),
    readiness: "NOT_READY",
  };
}
