import { config } from "../config";

/** Name used to match robots.txt groups, so a site's rules for "*" apply to us. */
export const ROBOTS_AGENT = "CompetitorMonitorBot";

const PLATFORM =
  process.platform === "win32"
    ? "Windows NT 10.0; Win64; x64"
    : process.platform === "darwin"
      ? "Macintosh; Intel Mac OS X 10_15_7"
      : "X11; Linux x86_64";

/**
 * User agent for page requests. Many sites (Akamai, Cloudflare) reject unknown bot
 * user agents outright, so default to a regular desktop Chrome string matching the
 * bundled Chromium version. Override with CRAWLER_USER_AGENT.
 */
export function crawlerUserAgent(chromeVersion = "141.0.0.0"): string {
  if (config.userAgent) return config.userAgent;
  const major = chromeVersion.split(".")[0];
  return `Mozilla/5.0 (${PLATFORM}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}
