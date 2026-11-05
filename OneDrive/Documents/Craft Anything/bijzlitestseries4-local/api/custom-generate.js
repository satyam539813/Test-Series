// POST /custom/generate — builds a custom test upstream and returns it as a
// data: URL (genuinely works on Vercel; no local disk needed).
import { generateCustomTestVercel } from "./_custom.js";

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const entry = await generateCustomTestVercel(body);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.status(200).send(JSON.stringify({ ok: true, entry }));
  } catch (error) {
    return res.status(400).send(JSON.stringify({ ok: false, error: error.message || "Could not generate the test" }));
  }
}
