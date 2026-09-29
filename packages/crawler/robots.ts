export interface RobotsPolicy {
  rules: { allow: boolean; pattern: string }[];
  sitemaps: string[];
}

export function parseRobots(text: string): RobotsPolicy {
  const groups: { agents: string[]; rules: RobotsPolicy["rules"] }[] = [];
  const sitemaps: string[] = [];
  let group: (typeof groups)[number] | undefined;
  let hasRules = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase(),
      value = line.slice(colon + 1).trim();
    if (name === "sitemap" && value) {
      sitemaps.push(value);
      continue;
    }
    if (name === "user-agent") {
      if (!group || hasRules) {
        group = { agents: [], rules: [] };
        groups.push(group);
        hasRules = false;
      }
      group.agents.push(value.toLowerCase());
    } else if (group && ["allow", "disallow"].includes(name)) {
      hasRules = true;
      if (value) group.rules.push({ allow: name === "allow", pattern: value });
    }
  }
  const exact = groups.filter((item) =>
    item.agents.some(
      (agent) => agent !== "*" && "upgraderesearch".includes(agent),
    ),
  );
  return {
    rules: (exact.length
      ? exact
      : groups.filter((item) => item.agents.includes("*"))
    ).flatMap((item) => item.rules),
    sitemaps,
  };
}

export function robotsAllows(
  policy: RobotsPolicy,
  requestTarget: string,
): boolean {
  let bestLength = -1,
    allowed = true;
  for (const rule of policy.rules) {
    const end = rule.pattern.endsWith("$");
    const source = (end ? rule.pattern.slice(0, -1) : rule.pattern)
      .split("*")
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*");
    if (new RegExp(`^${source}${end ? "$" : ""}`).test(requestTarget)) {
      const length = rule.pattern.replace(/[*$]/g, "").length;
      if (length > bestLength || (length === bestLength && rule.allow)) {
        bestLength = length;
        allowed = rule.allow;
      }
    }
  }
  return allowed;
}
