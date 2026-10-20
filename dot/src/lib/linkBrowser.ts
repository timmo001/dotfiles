import {
  managedGitRepoForGitHub,
  type DotGitConfig,
  type LinkSiteRule,
} from "../services/GitConfig.js";

/** Whether a `host[/path]` site pattern, as used by link site rules, matches a URL. */
export function siteMatches(
  rule: Pick<LinkSiteRule, "match">,
  url: URL,
): boolean {
  const [host = "", ...path] = rule.match.toLowerCase().split("/");
  const prefix = path.length > 0 ? `/${path.join("/")}`.replace(/\/$/, "") : "";
  const target = host.includes(":") ? url.host : url.hostname;
  const pathname = url.pathname.toLowerCase();

  return (
    (host.startsWith("*.")
      ? target.endsWith(host.slice(1))
      : target === host) &&
    (prefix === "" || pathname === prefix || pathname.startsWith(`${prefix}/`))
  );
}

/**
 * The browser name a link is configured for, before `work-time` is resolved:
 * site rules first, then the browser of the tracked repository it belongs to.
 * Returns undefined when neither applies.
 */
export function linkBrowserName(
  gitConfig: DotGitConfig,
  url: URL,
  repoBrowser?: string,
): string | undefined {
  return (
    gitConfig.links?.sites?.find((rule) => siteMatches(rule, url))?.browser ??
    repoBrowser ??
    (url.hostname === "github.com"
      ? managedGitRepoForGitHub(
          gitConfig,
          url.pathname.split("/").slice(1, 3).join("/"),
        )?.browser
      : undefined)
  );
}
