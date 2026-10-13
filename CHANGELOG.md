# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.2.0] — 2026-10-13

Open-source readiness release: NestJS 12 + BullMQ 6 compatibility, lazy backend loading, and documentation overhaul.

### Breaking changes

- **BullMQ 6 Job Schedulers** — Legacy `Queue#getRepeatableJobs()` was removed in BullMQ 6. Bullseye now lists recurring work via `Queue#getJobSchedulers()` (Job Schedulers). On BullMQ 5.16+ it still falls back to `getRepeatableJobs()` when schedulers are unavailable.
  - **Action for hosts on BullMQ 6:** Migrate repeatable job definitions to Job Schedulers *before* or as part of the BullMQ 6 upgrade ([BullMQ v5 → v6 guide](https://docs.bullmq.io/guide/migrations/migrate-from-v5-to-v6)). Until then, the Schedules view may be empty or Redis may reject legacy repeat metadata.
- **BullMQ 6 paused jobs** — The `paused` job state was removed from BullMQ’s `JobType` / default counts. Jobs in a paused queue appear as **waiting**; Bullseye still exposes `isPaused` on queue summaries. The “paused” job filter lists waiting jobs only when the queue is paused (otherwise empty). `counts.paused` is typically `0` on BullMQ 6+.
- **`bull` is no longer loaded at startup** — The classic `bull` package is required only when `backend: 'bull'` (default). Pure BullMQ apps no longer need `bull` / `@nestjs/bull` installed just to boot the dashboard.
- **Peer dependency ranges**
  - `@nestjs/common` / `@nestjs/core`: `^11 || ^12` (NestJS 12 supported)
  - `@nestjs/bull`: `^11 || ^12` (optional when using BullMQ only)
  - `bullmq`: `^5.16 || ^6` (Job Scheduler APIs)
  - Node.js: `>=20.19` (NestJS 12 requirement)
- **`redis` option typing** — Typed as `BullseyeRedisConnection` (`string | RedisOptions`) instead of importing `BullRootModuleOptions` from `@nestjs/bull`, so BullMQ-only TypeScript projects do not need `@nestjs/bull` for types.

### Added

- `CHANGELOG.md` and Open Source–oriented `README.md` (screenshots placeholders, install guides for Bull and BullMQ).
- GitHub repository / issues / homepage fields in `package.json` pointing at [catchHR/Bullseye](https://github.com/catchHR/Bullseye).

### Changed

- Dev dependencies bumped to NestJS 12 and BullMQ 6 for local builds.
- Library still emits **CommonJS** (NestJS 12 packages are ESM; hosts need Node **≥ 20.19** / **≥ 22.12** for `require(esm)`).
- Schedules UI copy mentions BullMQ job schedulers.

### Migration notes (0.1.x → 0.2.0)

1. Upgrade host Nest packages to 11 or 12; prefer Node **20.19+** or **22.12+**.
2. If you use BullMQ 6: migrate producers/workers to `upsertJobScheduler` / `getJobSchedulers` / `removeJobScheduler`, then upgrade `bullmq` and this package together.
3. BullMQ-only hosts: set `backend: 'bullmq'` and omit `bull` / `@nestjs/bull` if unused.
4. Bull classic hosts: keep `backend: 'bull'` (or omit) and install `bull` + `@nestjs/bull` as before.

## [0.1.x]

Internal / pre-open-source releases. See git history for details.
