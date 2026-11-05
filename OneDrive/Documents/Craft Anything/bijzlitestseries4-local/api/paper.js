// GET /paper?path=<paper path> — fetch the paper from the upstream mirror,
// apply the local patches (base URL, patched assets, branding scrub, host
// bridge) and return it. Papers are never stored on Vercel.
import { cleanPaperVercel, upstreamPath, ORIGIN } from "./_paper.js";

export const config = { maxDuration: 30 };

const encoder = (p) => String(p).split("/").map(encodeURIComponent).join("/");

export default async function handler(req, res) {
  const paperPath = String(req.query?.path || "").trim();
  if (!paperPath) {
    return res.status(400).send("Missing paper path");
  }
  const mapped = upstreamPath(paperPath);
  const url = `${ORIGIN}/${encoder(mapped)}`;
  const host = String(req.headers.host || "").trim() || "bijzlitestseries4-local.vercel.app";
  try {
    const upstream = await fetch(url, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36",
        accept: "text/html,*/*"
      }
    });
    if (!upstream.ok) {
      return res.status(upstream.status).send("Paper not found upstream");
    }
    const html = await upstream.text();
    const cleaned = cleanPaperVercel(html, mapped, host);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    // Papers are immutable per path: let the CDN serve repeats so the
    // upstream fetch + patch cost is paid once per path per week.
    res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=86400");
    return res.status(200).send(cleaned);
  } catch (error) {
    return res.status(502).send(`Paper fetch failed: ${error.message}`);
  }
}
