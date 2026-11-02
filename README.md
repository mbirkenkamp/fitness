# Fitness Tracker (PWA)

**[▶ Open the app: https://mbirkenkamp.github.io/fitness/](https://mbirkenkamp.github.io/fitness/)**

A simple fitness tracker that runs in the browser and can be installed like an app. No account, no build step, no dependencies.

## Use it

**It is available through GitHub Pages: [https://mbirkenkamp.github.io/fitness/](https://mbirkenkamp.github.io/fitness/)**

Open the link on your phone or computer. To install it, use "Add to Home Screen" (iPhone: Share menu in Safari; Android: Chrome menu → "Install app"). After the first visit it also works offline, and it updates itself when you open it with a connection.

Your data never leaves the device: everything is stored in the browser's `localStorage`. Use **Settings → Backup** to export it as a file now and then, since clearing the site data or switching devices loses it.

## Features

- **Exercises** in seconds (full-screen timer with a big Stop button) or repetitions, each entry with a 😞 / 😐 / 😊 rating, shown as a line chart and a history.
- **Streaks:** current and longest streak, a heatmap of the last 16 weeks, an optional weekly goal and a celebration at 7, 14, 30, 90, 180 and 365 days.
- **Intermittent fasting:** an eating window per weekday, a green header while you may eat and a red one while you fast, and a daily question on how yesterday went.
- **Backup:** export and import as a JSON file (merge or replace).
- **Languages:** English and German, picked automatically from the device or chosen in the settings.

## Deploy your own copy on GitHub Pages

Repo **Settings → Pages → Source: GitHub Actions**, then push to `main` (workflow in `.github/workflows/pages.yml`).
Alternatively choose "Deploy from a branch" and select the root folder.

## Run locally

`python3 -m http.server` and open http://localhost:8000
