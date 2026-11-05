// Serves calculator.js from the upstream mirror with one patch: the progress
// tracker it injects is served from our patched /assets/progress.js instead
// of the upstream copy (srcdoc frames break the upstream path logic).
import { ORIGIN } from "./_paper.js";

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  try {
    const upstream = await fetch(`${ORIGIN}/assets/calculator.js`, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36",
        accept: "text/javascript,*/*"
      }
    });
    if (!upstream.ok) return res.status(upstream.status).send("Upstream asset unavailable");
    let js = await upstream.text();
    js = js.replace(
      'script.src = baseAssetsPath + "progress.js?v=20260812-portal";',
      'script.src = "/assets/progress.js";'
    );
    res.setHeader("Content-Type", "text/javascript; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
    return res.status(200).send(js);
  } catch (error) {
    return res.status(502).send(`Asset fetch failed: ${error.message}`);
  }
}
