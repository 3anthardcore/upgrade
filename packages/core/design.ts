import { readdirSync, readFileSync, lstatSync } from "node:fs";
import { resolve, relative, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { hash } from "./index.ts";
export const repoRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
export function sourceFingerprint(paths: string[]) {
  const files: Array<[string, string]> = [];
  const walk = (path: string) => {
    const abs = resolve(repoRoot, path);
    if (lstatSync(abs).isSymbolicLink())
      throw new Error("Build source symlink forbidden");
    if (lstatSync(abs).isDirectory()) {
      for (const name of readdirSync(abs).sort()) walk(path + "/" + name);
    } else files.push([path.split(sep).join("/"), hash(readFileSync(abs))]);
  };
  for (const path of [...paths].sort()) walk(path);
  return hash(JSON.stringify(files));
}
export const defaultTokens = {
  schema_version: 1,
  color: {
    ink: "#172429",
    surface: "#f5f6f3",
    paper: "#ffffff",
    accent: "#145b45",
    muted: "#59676b",
    border: "#d9e0db",
  },
  typography: {
    family: "system-ui, sans-serif",
    body: "1rem",
    lineHeight: 1.6,
    title: "clamp(2rem, 5vw, 4rem)",
  },
  spacing: [4, 8, 12, 16, 24, 32, 48, 64],
  radius: 12,
  contentMax: 1120,
  breakpoints: [360, 390, 768, 1024, 1440],
};
export function designBrief(types: string[]) {
  return {
    schema_version: 1,
    approach: "shared-bitrix-template",
    purpose:
      "Читаемый фактический контент, единая навигация, видимая граница демонстрации.",
    preserve_facts: true,
    preserve_source_media: true,
    page_types: [...new Set(types)].sort(),
    components: [
      "header",
      "navigation",
      "breadcrumbs",
      "content-blocks",
      "media",
      "footer",
      "empty",
      "404",
      "demo-banner",
    ],
    required_states: [
      "long-title",
      "missing-media",
      "unknown-price",
      "keyboard-focus",
      "narrow-viewport",
    ],
    changes: [
      {
        change: "Единые отступы, типографика и ограничение ширины текста",
        purpose: "Читаемость на desktop и mobile",
      },
      {
        change: "Навигация по сохранённым маршрутам",
        purpose: "Предсказуемое открытие исходных ссылок",
      },
      {
        change: "Указание демонстрационного режима",
        purpose: "Отсутствие ложных обещаний отправки и оплаты",
      },
    ],
    limitations: [
      "Shared baseline design is implemented; per-client creative design and approval policy need the design task workflow.",
      "Visual checks on the actual Bitrix environment remain NOT_RUN.",
    ],
  };
}
