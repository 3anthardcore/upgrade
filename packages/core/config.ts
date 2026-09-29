import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { validateContract } from "../contracts/schemas.ts";
export function loadProfile(name = "public") {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error("Invalid profile name");
  const config = parse(
    readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        "../../configs",
        name + ".yaml",
      ),
      "utf8",
    ),
  );
  validateContract("profile", config);
  return config as {
    schema_version: 1;
    profile: string;
    crawl: {
      max_html_pages: number;
      max_assets: number;
      max_download_bytes: number;
      max_wall_time_minutes: number;
      requests_per_second_per_host: number;
      concurrency_per_host: number;
      respect_robots: true;
      max_redirects: number;
    };
    agents: {
      max_workers: number;
      max_task_attempts: number;
      max_fix_cycles: number;
      max_tasks: number;
      max_wall_time_seconds: number;
    };
    demo: {
      access: "authenticated";
      indexing: "disabled";
      outbound_integrations: "disabled";
    };
  };
}
