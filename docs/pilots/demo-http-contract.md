# HTTP demo integration contract — 30.09.2026

Root owns snapshot projection, native deployment/import, `upgrade-route.php`, module autoload and component wiring. Web adapter and view are separate tasks with disjoint files. All source strings remain untrusted and are escaped; no real personal data or external actions.

## Snapshot

DemoEngine snapshot contract from `docs/reviews/demo-engine-20260930.md`, plus presentation-only item fields: `thumbnail` (null or verified own `/upload/upgrade/PROJECT/SHA.ext`), `page_kind`, `breadcrumbs` (label/request_target). `id` is unchanged entity_source_id, `request_target` exact source route. No invented money/unit/variants. Root binds snapshot bytes to a trusted SHA before creating DemoEngine. Snapshot deployment and target verification are root responsibilities.

## Web adapter

`Upgrade\Core\DemoWeb::handle(DemoEngine $engine, array $snapshot, array $request): array` accepts trusted server request metadata and untrusted user input. Request fields: `method`, `request_target`, `host`, `https` boolean, `origin` nullable string, `cookie` nullable opaque cookie value, `body` raw URL-encoded bytes. Parse inputs with strict bounded scalar/duplicate-key handling. Do not trust a client supplied host/TLS marker without root Nginx binding. Return `status`, `headers` string map and `view` array or null; redirect is a Location header. No PHP headers/output directly, no CMS bootstrap/DB or external calls.

Own routes: GET/HEAD `/__upgrade/search`, `/__upgrade/cart`, `/__upgrade/lead`, `/__upgrade/receipt`; POST `/__upgrade/action`. An unsupported own route returns 404, unsupported method 405. Root checks no source registry path collides with `/__upgrade/`. Search query accepts `q`, `category`, `sort`, `page` and bounded explicit attribute filter mapping agreed by adapter/view authors. Preserve source URLs in results; no source form action is executed.

For ordinary source pages root calls adapter with an additional `item_id` (trusted matched source entity), and adapter returns a `product` view only for a product. Non-product ordinary requests return a null view. Avoid creating a session on read-only search if unnecessary. Cookie name is `upgrade_demo_session`, opaque random hex, HttpOnly/SameSite=Strict/Path=/, Secure only under verified HTTPS. POST requires exact same Origin, valid session cookie, csrf, snapshot pin and idempotency key. Lead/checkout forms include only fixed synthetic identity/consent and permitted fields from DemoEngine. No email/phone/name/free-text input. PRG redirects must retain same operation receipt without running the mutation twice.

Adapter view common fields: `kind` (`search`, `cart`, `product`, `lead`, `receipt`, `error`), `csrf`, `snapshot_id`, `cart` (actual engine result where applicable), `item` (product), `search` (actual engine search result), `query` (safe normalized search params), `record` (local synthetic receipt where applicable), `message` (safe fixed display error), `items` (snapshot id-to-item map for display only). View author and adapter author must coordinate any added fields in their reports and with root. Unknown total stays null with an explicit explanatory label. The template must never infer an amount from raw text.

## View

`Upgrade\Core\DemoView::render(array $view): string` produces escaped accessible HTML only, no server mutation/network/DB. Each form gets an independent cryptographically random idempotency key and the given csrf/snapshot fields. Inputs names match adapter contract. No JavaScript required: ordinary forms, GET filters and POST actions. Product view is inserted below the main heading and above the full factual content. Search/cart/lead/receipt replace the generic page component body for own routes. Native source body remains editable and visible.

Own template header/footer/styles may be improved for an actual store using retained observed content, restrained warm surfaces, clear typography, product photos, usable category/product/search/cart states and mobile menu. Do not invent badges, stock, discount claims, reviews or certificates. Maintain existing facts/card/table markup compatibility. New controls must work with adapter; disabled states must explain actual missing data. Keyboard focus, labelled inputs, visible validation, responsive widths 360/390/768/1024/1440 are required. Local fixture render is not native Bitrix acceptance.
