import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Static policy verification, not an Nginx/FPM simulator or HTTP acceptance.
interface Directive {
  args: string[];
  children?: Directive[];
}
const config = readFileSync(
  new URL("../../infra/nginx/partial-demo.conf", import.meta.url),
  "utf8",
);
function parse(text: string): Directive[] {
  const tokens = (text.match(/"[^"\n]*"|#[^\n]*|[{};]|[^\s{};]+/g) ?? [])
    .filter((token) => !token.startsWith("#"))
    .map((token) => (token.startsWith('"') ? token.slice(1, -1) : token));
  let i = 0;
  function block(nested = false): Directive[] {
    const result: Directive[] = [];
    let args: string[] = [];
    while (i < tokens.length) {
      const token = tokens[i++];
      if (token === "{") {
        assert.ok(args.length);
        result.push({ args, children: block(true) });
        args = [];
      } else if (token === ";") {
        assert.ok(args.length);
        result.push({ args });
        args = [];
      } else if (token === "}") {
        assert.ok(nested);
        assert.equal(args.length, 0);
        return result;
      } else args.push(token);
    }
    assert.equal(nested, false, "unclosed configuration block");
    assert.equal(args.length, 0);
    return result;
  }
  return block();
}
const ast = parse(config);
const find = (nodes: Directive[], key: string) =>
  nodes.filter((node) => node.args[0] === key);
function one(nodes: Directive[], key: string) {
  const found = find(nodes, key);
  assert.equal(found.length, 1, `${key} must occur once`);
  return found[0].args.slice(1);
}
assert.equal(find(ast, "server").length, 1);
const server = find(ast, "server")[0].children!;
const locations = find(server, "location");
function select(path: string) {
  const exact = locations.find(
    (node) => node.args[1] === "=" && node.args[2] === path,
  );
  if (exact) return exact;
  for (const node of locations) {
    if (
      ["~", "~*"].includes(node.args[1]) &&
      new RegExp(node.args[2], node.args[1] === "~*" ? "i" : "").test(path)
    )
      return node;
  }
  return locations.find(
    (node) => node.args.length === 2 && node.args[1] === "/",
  )!;
}
function policy(target: string, method = "GET", authenticated = true) {
  const path = decodeURIComponent(target.split("?")[0]);
  const nodes = select(path).children!;
  if (find(nodes, "return").some((node) => node.args[1] === "404"))
    return "DENIED";
  assert.deepEqual(one(nodes, "limit_except"), ["GET"]);
  assert.deepEqual(one(find(nodes, "limit_except")[0].children!, "deny"), [
    "all",
  ]);
  if (!["GET", "HEAD"].includes(method)) return "METHOD_DENIED";
  assert.equal(find(nodes, "auth_basic").length, 0);
  if (!authenticated) return "AUTH_REQUIRED";
  return find(nodes, "fastcgi_pass").length ? "OWN_ROUTER" : "OWN_STATIC";
}
const sha = "a".repeat(64);
const media = (name = `${sha}.png`) =>
  `/upload/upgrade/teplypol-market/${name}`;

test("private preview has one fixed own execution target and preserves original request identity", () => {
  assert.deepEqual(one(server, "listen"), ["8080"]);
  assert.deepEqual(one(server, "root"), ["/var/www/html"]);
  assert.deepEqual(one(server, "auth_basic_user_file"), [
    "/etc/nginx/demo.htpasswd",
  ]);
  assert.notEqual(one(server, "auth_basic")[0], "off");
  assert.deepEqual(one(server, "disable_symlinks"), [
    "on",
    "from=$document_root",
  ]);
  assert.deepEqual(one(server, "merge_slashes"), ["off"]);
  assert.deepEqual(one(server, "autoindex"), ["off"]);
  const executable = locations.filter(
    (node) => find(node.children!, "fastcgi_pass").length,
  );
  assert.equal(executable.length, 1);
  assert.deepEqual(executable[0].args, ["location", "/"]);
  const nodes = executable[0].children!;
  assert.deepEqual(one(nodes, "try_files"), [
    "/local/upgrade-route.php",
    "=404",
  ]);
  assert.deepEqual(one(nodes, "fastcgi_pass"), ["php:9000"]);
  for (const key of [
    "fastcgi_pass_request_headers",
    "fastcgi_pass_request_body",
    "fastcgi_intercept_errors",
  ])
    assert.deepEqual(one(nodes, key), ["off"]);
  const params = new Map<string, string[]>();
  for (const { args } of find(nodes, "fastcgi_param")) {
    assert.equal(params.has(args[1]), false);
    params.set(args[1], args.slice(2));
  }
  for (const [key, value] of Object.entries({
    SCRIPT_FILENAME: "/var/www/html/local/upgrade-route.php",
    SCRIPT_NAME: "/local/upgrade-route.php",
    REQUEST_URI: "$request_uri",
    QUERY_STRING: "$query_string",
    HTTP_HOST: "$http_host",
    SERVER_PORT: "$upgrade_preview_server_port",
    REQUEST_SCHEME: "$upgrade_preview_request_scheme",
    HTTP_X_FORWARDED_PROTO: "$upgrade_preview_request_scheme",
  }))
    assert.deepEqual(params.get(key), [value]);
  assert.deepEqual(params.get("HTTPS"), [
    "$upgrade_preview_https",
    "if_not_empty",
  ]);
  for (const key of [
    "PATH_INFO",
    "HTTP_AUTHORIZATION",
    "HTTP_PROXY",
    "HTTP_COOKIE",
    "HTTP_X_FORWARDED_HOST",
    "REMOTE_USER",
  ])
    assert.equal(params.has(key), false, key);
  const all = (nodes: Directive[]): Directive[] =>
    nodes.flatMap((node) => [node, ...all(node.children ?? [])]);
  for (const key of [
    "rewrite",
    "alias",
    "index",
    "fastcgi_split_path_info",
    "real_ip_header",
    "proxy_pass",
    "satisfy",
  ])
    assert.equal(find(all(ast), key).length, 0, key);
  assert.deepEqual(
    find(all(ast), "include").map((node) => node.args[1]),
    ["/etc/nginx/mime.types"],
  );
});

test("source PHP names, encoded paths and repeated query remain authenticated router data; writes are denied", () => {
  for (const path of [
    "/",
    "/Product/%D1%82.html?color=red&color=blue&empty=",
    "/A%2fB?q=&q=2",
    "/A%2FB?q=2&q=",
    "/a//b",
    "/index.php",
    "/catalog/item.php?x=1&x=2",
    "/unknown-never-in-database",
  ]) {
    assert.equal(policy(path), "OWN_ROUTER", path);
    assert.equal(policy(path, "HEAD"), "OWN_ROUTER", path);
    assert.equal(policy(path, "GET", false), "AUTH_REQUIRED", path);
  }
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS", "TRACE"])
    for (const path of [
      "/",
      "/index.php",
      "/local/templates/upgrade/styles.css",
      media(),
    ])
      assert.equal(policy(path, method), "METHOD_DENIED", `${method} ${path}`);
});

test("only exact own CSS and project-pinned hash images/PDF are static; misleading suffixes and other projects fail", () => {
  for (const path of [
    "/local/templates/upgrade/styles.css",
    ...["png", "jpg", "gif", "webp", "avif", "pdf"].map((ext) =>
      media(`${sha}.${ext}`),
    ),
  ]) {
    assert.equal(policy(path), "OWN_STATIC", path);
    assert.equal(policy(path, "HEAD"), "OWN_STATIC", path);
    assert.equal(policy(path, "GET", false), "AUTH_REQUIRED", path);
  }
  for (const path of [
    "/local/templates/upgrade/styles.css.map",
    "/local/templates/upgrade/header.php",
    "/local/templates/upgrade/styles.css/extra",
    "/local/templates/other/styles.css",
    media(`${sha}.php`),
    media(`${sha}.php.png`),
    media(`${sha}.svg`),
    media(`${sha}.html`),
    media(`${sha}.json`),
    media(`${sha}.PDF`),
    media(`${sha.toUpperCase()}.png`),
    media(`${"a".repeat(63)}.png`),
    media(`${sha}.png/extra`),
    media("nested/" + sha + ".png"),
    `/upload/upgrade/other-project/${sha}.png`,
    "/upload/upgrade/teplypol-market/",
    "/upload/source.png",
    "/upload/upgrade/teplypol-market/.hidden.png",
  ])
    assert.equal(policy(path), "DENIED", path);
});

test("installer, admin, direct router, private files and encoded protected paths never reach a content handler", () => {
  for (const path of [
    "/bitrix/",
    "/bitrix/admin/index.php",
    "/bitrix/admin/site_checker.php",
    "/bitrix/admin/update_system.php",
    "/bitrix/legal/license.php",
    "/bitrixsetup.php",
    "/BITRIXSETUP.PHP/path",
    "/bitrixinstall.php",
    "/local/upgrade-installer-resume.php",
    "/local/upgrade-route.php",
    "/local/upgrade-route.php/extra",
    "/bitrix/license_key.php",
    "/bitrix/.settings.php",
    "/license_key.php.css",
    "/php_interface/dbconn.php",
    "/backup/site.zip",
    "/backups/database.sql",
    "/.git/config",
    "/.env",
    "/path/.htaccess",
    "/dump.sql.css",
    "/settings.ini",
    "/%62itrix/admin/index.php",
    "/bitrix%2flicense_key.php",
    "/%2elocal/.settings.php",
    "/%2egit/config",
    "/local/%75pgrade-route.php",
    "/.well-known/acme-challenge/test",
  ])
    assert.equal(policy(path), "DENIED", path);
  const fallback = locations.find(
    (node) => node.args[1] === "@partial_not_found",
  )!;
  assert.deepEqual(one(fallback.children!, "return"), [
    "404",
    "Upgrade partial preview: route not available.\\n",
  ]);
});

test("TLS trusts both verified peer and overwritten marker; all responses inherit privacy and logging policy", () => {
  const maps = find(ast, "map");
  assert.equal(maps.length, 3);
  const secure = maps.find(
    (node) => node.args[2] === "$upgrade_preview_https",
  )!;
  assert.equal(secure.args[1], "$remote_addr|$http_x_forwarded_proto");
  assert.deepEqual(
    secure.children!.map((node) => node.args),
    [
      ["default", ""],
      ["172.30.50.1|https", "on"],
    ],
  );
  const tls = (peer: string, header: string) =>
    secure.children!.find(
      (node) =>
        node.args[0].toLowerCase() === `${peer}|${header}`.toLowerCase(),
    )?.args[1] ?? "";
  for (const [peer, header, expected] of [
    ["172.30.50.1", "https", "on"],
    ["172.30.50.1", "HTTPS", "on"],
    ["172.30.50.1", "http", ""],
    ["172.30.50.1", "https, http", ""],
    ["172.30.50.1", "", ""],
    ["172.30.50.2", "https", ""],
    ["127.0.0.1", "https", ""],
  ])
    assert.equal(tls(peer, header), expected);
  assert.deepEqual(one(server, "access_log"), ["off"]);
  assert.deepEqual(one(server, "error_log"), ["/dev/null", "crit"]);
  const headers = new Map(
    find(server, "add_header").map((node) => [
      node.args[1],
      node.args.slice(2),
    ]),
  );
  assert.deepEqual(headers.get("X-Robots-Tag"), [
    "noindex, nofollow, noarchive",
    "always",
  ]);
  assert.deepEqual(headers.get("Cache-Control"), ["no-store", "always"]);
  assert.deepEqual(headers.get("X-Content-Type-Options"), [
    "nosniff",
    "always",
  ]);
  assert.match(headers.get("Content-Security-Policy")![0], /script-src 'none'/);
  assert.match(
    headers.get("Content-Security-Policy")![0],
    /connect-src 'none'; form-action 'none'/,
  );
  for (const location of locations)
    assert.equal(
      find(location.children!, "add_header").length,
      0,
      "location headers would cancel inherited privacy headers on Nginx 1.28",
    );
});
