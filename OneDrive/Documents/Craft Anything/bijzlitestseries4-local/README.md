# Test Series — Local Library

A separate, fully offline copy of the test-series app. The card list is
generated from the original 1,061-test manifest, but every paper and its images
are read from the `library/` folder on this computer. Nothing is fetched from
`dvruo-test-series.netlify.app` at runtime.

## Quick start

```bash
npm start
```

Open <http://localhost:8080/>. The server reads papers straight from `library/`,
so there is no build step needed for day-to-day use. Run `npm run build` only
after changing files in `src/`.

## Folder layout

```
bijzlitestseries4-local/
├── data/
│   ├── source-manifest.json   original 1,061-test manifest (metadata source)
│   └── test-map.json          generated flat map + download report
├── library/                   the local paper mirror
│   ├── <BRANCH>/<PROVIDER>/<SERIES>/*.html
│   ├── assets/                shared JS/CSS, vendored MathJax
│   ├── ext_media/             third-party images (e.g. madeeasyprime)
│   └── <BRANCH>/<PROVIDER>/media/
├── src/
│   ├── data/series-manifest.json   generated, consumed by the app
│   ├── index.html             card browser
│   └── paper.html             paper viewer (iframe.srcdoc)
├── tools/mirror.mjs           downloader + manifest/map generator
├── server.mjs                 local-only static + paper server
└── dist/                      build output served by server.mjs
```

`library/` is a full site mirror: a paper's relative `../../../assets/...`,
`../media/...`, and `../../../ext_media/...` references resolve unchanged when
served under `/library/*`.

## Downloading or refreshing papers

```bash
npm run mirror                 # download everything missing
npm run mirror -- --branch "CIVIL ENGINEERING"
npm run mirror -- --match "GATE 2027"
npm run mirror -- --limit 5
npm run mirror -- --force      # re-download existing files
npm run map                    # rebuild manifests from library/ without network
npm run verify                 # check manifest entries exist on disk
```

The downloader is resumable: existing non-empty files are skipped, so an
interrupted run can simply be started again. It rewrites the 96 renamed GATE
2027 Electrical paths (`BIJZLIACE` → `DVRUOACE`) while downloading.

`data/test-map.json` records every test with its source path, local path, size,
and any download failures. `src/data/series-manifest.json` only includes tests
whose paper downloaded successfully, so cards never point at a missing file.

## Offline behavior

- Papers are loaded from disk by `/paper?path=...`; there is no remote fallback.
- `library/assets/math-boot.js` uses the vendored
  `library/assets/mathjax/tex-svg-full.js`, not a CDN.
- Images hosted on third-party domains were downloaded into
  `library/ext_media/<host>/...`, and the referring pages were rewritten to
  load them locally.
- The app records opens and submissions in `localStorage` under
  `bijzli-activity-v1`, exactly like the original app.

## Serving a library from another directory

Point `PAPER_ROOT` at a copy of the library (useful for an external drive):

```bash
PAPER_ROOT=/path/to/library PORT=8080 npm start
```

`PAPER_ROOT` must contain the same layout as `library/` (papers plus `assets/`,
`media/`, `ext_media/`). Restart the server after changing it.

## Troubleshooting

- **A card opens "Paper not found in the local library"** — that paper was not
  downloaded. Run `npm run mirror` again, then `npm run map`.
- **`npm run verify` exits 1** — some manifest entries are missing from
  `library/`; re-run the mirror or run `npm run map` to drop them from the card
  list.
- **Math shows raw `$...$`** — check that
  `library/assets/mathjax/tex-svg-full.js` exists and that requests to
  `/library/assets/mathjax/` return 200.
- **Port already in use** — run with `PORT=8081 npm start`.
