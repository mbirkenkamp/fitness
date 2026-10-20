# Fitness Tracker (PWA)

Create exercises, log a length (any unit) with a 😞/😐/😊 rating, and see progress as a line chart.
All data stays in the device's `localStorage`. No build step, no dependencies.

## Deploy on GitHub Pages
Repo **Settings → Pages → Source: GitHub Actions**, then push to `main` (workflow in `.github/workflows/pages.yml`).
Alternatively choose "Deploy from a branch" and select the root folder.

## Run locally
`python3 -m http.server` and open http://localhost:8000
