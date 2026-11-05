// Proxies the calculator stylesheet (calculator.js builds its href from the
// script URL, so it resolves under /assets/ here).
import { ORIGIN } from "./_paper.js";

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  try {
    const upstream = await fetch(`${ORIGIN}/assets/calculator.css`, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36",
        accept: "text/css,*/*"
      }
    });
    if (!upstream.ok) return res.status(upstream.status).send("Upstream asset unavailable");
    const css = await upstream.text();
    res.setHeader("Content-Type", "text/css; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=86400");
    return res.status(200).send(css);
  } catch (error) {
    return res.status(502).send(`Asset fetch failed: ${error.message}`);
  }
}
