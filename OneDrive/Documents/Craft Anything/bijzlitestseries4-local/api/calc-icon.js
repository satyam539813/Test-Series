// Proxies the calculator icon.
import { ORIGIN } from "./_paper.js";

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  try {
    const upstream = await fetch(`${ORIGIN}/assets/calculator-icon.png`, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36",
        accept: "image/png,*/*"
      }
    });
    if (!upstream.ok) return res.status(upstream.status).send("Upstream asset unavailable");
    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=86400");
    return res.status(200).send(buffer);
  } catch (error) {
    return res.status(502).send(`Asset fetch failed: ${error.message}`);
  }
}
