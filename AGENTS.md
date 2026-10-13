# AGENTS.md

Guidance for AI agents and contributors working on **nestjs-bullseye** (`@catchhr/nestjs-bullseye`).

---

## Project purpose

Bullseye is an **open-source, embedded queue dashboard** for [Bull](https://github.com/OptimalBits/bull) and [BullMQ](https://docs.bullmq.io/) in **NestJS (Express)**.

One Nest module mounts:

- a React SPA (dashboard UI)
- a REST API under a configurable `basePath`
- optional webhook **alerts**
- an optional **MCP** server for AI tools (Cursor, Claude Desktop, …)

Design goals:

- **Self-hosted** — runs inside the host Nest app; no separate process / extra Redis DB for the UI itself
- **Backend-agnostic** — support classic Bull **or** BullMQ via drivers; peers stay optional
- **Safe by default** — HTTP Basic auth + custom Express middleware under `basePath`
- **MIT / operator-controlled** — inspired by Bull Board / Taskforce, but embeddable and free

End-user docs: `README.md`. Maintainer build/publish notes: `DEVELOPMENT.md`.

---

## Repo layout

| Path | Role |
|------|------|
| `src/` | Nest library (module, API, alerts, MCP, queue drivers) → builds to `dist/` |
| `frontend/` | Vite + React + Tailwind SPA → builds into `public/` |
| `public/` | Built dashboard assets (published with the package) |
| `docs/` | Screenshots and supporting docs |

Package publish contents: `"files": ["dist", "public"]`.

---

## Changelog (required on every change)

**Every meaningful change must update [`CHANGELOG.md`](./CHANGELOG.md)** before the work is considered done.

- Follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
- Follow [Semantic Versioning](https://semver.org/) for version bumps
- Put unreleased work under `## [Unreleased]` (create the section if missing)
- Use the standard categories only when they apply:

  - `### Added` — new features
  - `### Changed` — changes in existing behavior
  - `### Deprecated` — soon-to-be removed
  - `### Removed` — removed features
  - `### Fixed` — bug fixes
  - `### Security` — vulnerability fixes

- For breaking changes: document under `### Breaking changes` (or `### Changed` with a clear **Breaking** callout) and include migration notes when hosts must act
- Write entries for **operators and integrators**, not as a dump of commit subjects
- Do **not** leave the changelog stale across a PR or release; if you change public API, drivers, peers, UI behavior, or docs that affect users, update the changelog in the same change set

When cutting a release: move `[Unreleased]` entries into a dated version section (`## [x.y.z] — YYYY-MM-DD`) and bump `package.json` `version` accordingly.

---

## Code best practices

### General

- Prefer small, focused diffs; match existing naming, file layout, and comment style
- Do not add drive-by refactors, unused abstractions, or docs the user did not ask for
- Keep public surface area intentional: export only what hosts need from `src/index.ts`
- Types for the public API live in `src/bullseye.types.ts`; keep DTOs and options documented with short JSDoc where non-obvious
- Avoid introducing secrets into the repo (`.env`, keys, tokens)

### Nest / library (`src/`)

- **Express only** — do not add Fastify-specific code paths
- Queue access goes through the driver abstraction (`src/drivers/`); do not hardcode BullMQ APIs in shared services when Bull must keep working
- Keep **lazy loading** of optional peers (`bull` / `bullmq` / `@nestjs/bull`) so BullMQ-only hosts can boot without classic Bull installed (and vice versa)
- Prefer `backend: 'bull' | 'bullmq'` branching at driver / factory boundaries, not scattered `require()` calls
- Alerts and Redis key helpers should stay prefix/instance-aware (`alertsRedisNamespace`, options `prefix`)
- Destructive or mutating queue operations (retry, remove, promote, add job) must remain explicit API/UI actions with clear errors when unsupported by the backend
- MCP auth stays Bearer/`apiKey`-gated; never weaken auth “for convenience” in shared code

### Frontend (`frontend/`)

- Stay consistent with the existing React + Vite + Tailwind + shadcn-style UI stack
- Preserve URL/search state patterns already used for filters and navigation
- Prefer reusing shared helpers (`lib/api.ts`, `lib/format.ts`, status styles) over duplicating queue/job logic
- Keep the dashboard usable: loading/empty/error states matter for ops UIs
- Build output must land in `../public/` (do not invent a second asset pipeline)

### Compatibility

- Respect peer ranges and Node engines in `package.json` (`node >= 20.19`, Nest 11–12, BullMQ `^5.16 \|\| ^6`, Bull 4)
- BullMQ 6: Job Schedulers (`getJobSchedulers` / `upsertJobScheduler`); no reliance on removed `getRepeatableJobs()` / paused job type as primary APIs
- When changing peers, engines, or backend behavior: update README compatibility notes **and** the changelog

### Commits & PRs

- Only commit when explicitly asked
- Do not force-push main/master; do not skip hooks unless requested
- PR descriptions should mention user-facing impact and point at changelog entries when relevant

---

## Workflow checklist for agents

Before finishing a task:

1. Implement the change in the correct layer (`src/` vs `frontend/`)
2. Update `CHANGELOG.md` under `[Unreleased]` (Keep a Changelog categories)
3. Update `README.md` / `DEVELOPMENT.md` only if install, API, peers, or maintainer steps changed
4. Run or note the relevant build: `npm run build` (or `build:lib` / frontend `dev` as appropriate)
5. Do not publish or bump the release version unless asked

---

## Out of scope (unless explicitly requested)

- Fastify support
- A standalone Bullseye server process
- Bundling Redis or queue workers into this package
- Rewriting the UI into a different framework
