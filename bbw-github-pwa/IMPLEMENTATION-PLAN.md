# Binance BBW Scanner — implementation phase 1

## What this phase does

- Schedules the existing Node scanner every four hours in UTC (six planned runs per day).
- Supports a manual run from the GitHub Actions tab.
- Runs the existing scanner from `bbw-github-pwa/`, where its current `site/data` output path resolves to `bbw-github-pwa/site/data/`.
- Validates the scanner output before publishing it.
- Copies `latest.json` and `history.json` into `bbw-github-pwa/data/`, the directory read by the Pages app.
- Archives each successful run as a separate JSON file under `bbw-github-pwa/data/archive/YYYY/MM/`.
- Writes `bbw-github-pwa/data/status.json` with the workflow and publish timestamps.
- Uses a concurrency group to prevent overlapping production runs.

## Important limits

1. GitHub scheduled workflows are best-effort. The cron expression is not a guarantee of exact start time.
2. This phase archives the scanner's existing output. It does not yet constitute a validated historical backtest, a candidate lifecycle database, or a pump-event research database.
3. The current scanner still uses its existing BBW rules. Those rules must be audited and versioned before we claim they predict future pumps.
4. The scanner's current `history.json` remains a short rolling view (30 runs). The separate archive is intended to preserve each run independently.
5. GitHub Pages is static hosting. The app can read published JSON, but this workflow does not create push notifications.
6. GitHub Actions needs repository write access. If branch protection blocks bot pushes, the workflow will need a different publishing configuration.
7. This workflow intentionally fails if no symbols scan successfully, so a total scan failure is not published as an empty valid result.

## Install

Place this file at the repository root:

`.github/workflows/bbw-scan.yml`

The repository's existing scanner should remain at:

`bbw-github-pwa/scripts/scan.mjs`

After committing the workflow, open the repository's **Actions** tab, select **Binance BBW Scanner**, and run **Run workflow** once. Confirm that the run succeeds and that the commit adds/updates:

- `bbw-github-pwa/data/latest.json`
- `bbw-github-pwa/data/history.json`
- `bbw-github-pwa/data/status.json`
- `bbw-github-pwa/data/archive/YYYY/MM/<run-file>.json`

Then verify the deployed Pages URL. A successful Actions run is necessary but not sufficient; Pages publication and in-app fetching must also be checked.

## Audit findings from the current public code

- The scanner writes to `path.resolve('site/data')`. Therefore, it must be run with `bbw-github-pwa` as its working directory for the workflow's source path to be correct.
- The app fetches `./data/latest.json` and `./data/history.json`, so the scan output must be copied into `bbw-github-pwa/data/` for the current Pages layout.
- The scanner trims `history.json` to `MAX_HISTORY_RUNS = 30`. The separate date-partitioned archive avoids treating that short UI history as the permanent research record.
- Current rules include BBW >= 50%, live price above the upper Bollinger band, and daily EMA200 above MA200 by at least 2% for breakout; squeeze is BBW <= 2% in the 1–5h and 16–20h periods. These are the current implementation, not yet evidence of predictive value.
- The current scanner uses live ticker price for breakout deviation while using completed candles for indicator inputs. This is a mixed-time reference and must be explicitly considered during historical validation.
