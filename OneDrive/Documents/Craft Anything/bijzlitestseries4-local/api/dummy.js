// Serves the patched exam engine (made-easy-dummy.js) from the upstream
// mirror. Patching adds progress save/restore, removes provider branding
// from the exam header, and applies the improved UI theme.
import { patchDummy, ORIGIN } from "./_paper.js";

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  try {
    const upstream = await fetch(`${ORIGIN}/assets/made-easy-dummy.js`, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36",
        accept: "text/javascript,*/*"
      }
    });
    if (!upstream.ok) return res.status(upstream.status).send("Upstream asset unavailable");
    const js = await upstream.text();
    res.setHeader("Content-Type", "text/javascript; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
    return res.status(200).send(patchDummy(js));
  } catch (error) {
    return res.status(502).send(`Asset fetch failed: ${error.message}`);
  }
}
