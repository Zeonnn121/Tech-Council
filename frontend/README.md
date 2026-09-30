# `frontend/` — placeholder

This is a **placeholder**, not the real UI. It exists so that
`deploy/build-and-upload.ps1` has a `frontend/` folder to `npm ci` and
`npm run build`, and so the packaged archive contains a `frontend/dist/` for
Express to serve in production (`backend/src/app.ts`).

It has **no dependencies**, so `npm ci` works offline and needs no lockfile
churn. `npm run build` copies `index.html` and `public/**` into `dist/`.

## Replace it

When the real React app is ready, delete this folder and drop the teammate's
project in its place. Keep these three contracts so the deploy scripts keep
working unchanged:

1. `npm ci` must work (commit a `package-lock.json`).
2. `npm run build` must emit static files into `frontend/dist/` with an
   `index.html` entry point.
3. Any inline `<script>` must be avoided unless the CSP in
   `backend/src/app.ts` is relaxed — production uses `script-src 'self'`.

## Local check

```bash
cd frontend
npm ci
npm run build
ls dist          # index.html, app.js
```
