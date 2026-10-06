/** Shared inert primary-content heuristic; it does not attest full-page coverage. */
import type { CheerioAPI } from "cheerio";
import type { AnyNode, Element } from "domhandler";
const isElement = (node: AnyNode): node is Element => "tagName" in node;
const inactiveDom =
  'script,style,button,input,textarea,select,iframe,frame,object,embed,svg,math,template,noscript,[hidden],[aria-hidden="true"]';
export const explicitlyHiddenStyle =
  /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*(?:!important\s*)?(?:;|$)/i;

export function cleanPrimaryDom(
  $: CheerioAPI,
  root: Element,
  bodyFallback = false,
) {
  const main = $(root);
  main.find(inactiveDom).remove();
  main.find("nav,aside").remove();
  if (bodyFallback) main.find("header,footer").remove();
  main.find("[style]").each((_i, node) => {
    if (explicitlyHiddenStyle.test($(node).attr("style") ?? ""))
      $(node).remove();
  });
  // Product/review copy may live inside a form. Preserve inert text, not fields or actions.
  main.find("form").each((_i, node) => {
    $(node).replaceWith($(node).contents());
  });
  return main;
}

/** The selector is an auditable heuristic, not proof that a page is complete. */
export function primaryDom($: CheerioAPI) {
  const usable = (node: Element) => {
    if (
      $(node).is('[hidden],[aria-hidden="true"]') ||
      $(node).parents('[hidden],[aria-hidden="true"],nav,header,footer,aside')
        .length ||
      $(node)
        .parents("[style]")
        .add(node)
        .toArray()
        .some((parent) =>
          explicitlyHiddenStyle.test($(parent).attr("style") ?? ""),
        )
    )
      return false;
    // Inspect the same inert content that extraction will retain, without
    // changing original nodes used for source locators and metadata evidence.
    const retained = cleanPrimaryDom($, $(node).clone().get(0)!);
    return Boolean(retained.text().trim() || retained.find("img").length);
  };
  for (const selector of [
    "main",
    '[role="main"]',
    "#content",
    "#main",
    "#main-content",
  ]) {
    const candidates = $(selector)
      .toArray()
      .filter((node): node is Element => isElement(node) && usable(node));
    if (candidates.length === 1) return { node: $(candidates[0]), selector };
  }
  const articles = $("article")
    .toArray()
    .filter((node): node is Element => isElement(node) && usable(node));
  const pageHeading = $("body h1").first().get(0);
  if (
    articles.length === 1 &&
    (!pageHeading ||
      $(articles[0])
        .find("h1")
        .toArray()
        .includes(pageHeading as Element))
  )
    return { node: $(articles[0]), selector: "article" };
  return { node: $("body"), selector: "body" };
}
