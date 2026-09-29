import { mkdirSync, writeFileSync } from "node:fs";
import { schemas } from "../packages/contracts/schemas.ts";
mkdirSync("packages/contracts/schemas", { recursive: true });
for (const [name, schema] of Object.entries(schemas))
  writeFileSync(
    `packages/contracts/schemas/${name}.schema.json`,
    JSON.stringify(
      { $schema: "http://json-schema.org/draft-07/schema#", ...schema },
      null,
      2,
    ) + "\n",
  );
