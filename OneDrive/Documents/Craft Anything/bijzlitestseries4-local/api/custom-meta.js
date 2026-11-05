// GET /custom/meta?branch=... — branch list (no branch) or subject list.
import { loadBranchIndex, fetchManifest } from "./_custom.js";

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  try {
    const branch = String(req.query?.branch || "").trim();
    if (!branch) {
      const manifest = await fetchManifest();
      const branches = (manifest.branches || []).map((item) => ({ name: item.name, testCount: item.testCount || 0 }));
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=3600");
      return res.status(200).send(JSON.stringify({ branches }));
    }
    const index = await loadBranchIndex(branch);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600");
    return res.status(200).send(
      JSON.stringify({ branch: index.branch, subjects: index.subjects })
    );
  } catch (error) {
    return res.status(400).send(JSON.stringify({ error: error.message || "Could not load subjects" }));
  }
}
