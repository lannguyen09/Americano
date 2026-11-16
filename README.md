# Padel Americano Organizer

**Build:** `node build.js --theme=padelnext` writes `dist/padel.html` (one standalone file) and `dist/site/` (installable offline app).
**Try locally:** `node tools/serve.js` then open http://localhost:8080/ (offline works after the first load).

**Deploy:** push to `master`. `.github/workflows/pages.yml` runs the tests, builds and publishes `dist/site` to GitHub Pages.
One-time setup: repo Settings > Pages > Source: "GitHub Actions". A new build gets a new service-worker version,
so devices pick up the update on the next visit (reload once to see it).

**Install on iPad:** open the Pages URL in Safari > Share > Add to Home Screen. It then starts full screen and works offline.

**Your data:** tournaments are stored only in the browser's localStorage on each device. They are not synced between
devices and are lost if Safari website data is cleared. Use Data > Export (JSON) as the backup, and Import to move a
tournament to another device.
