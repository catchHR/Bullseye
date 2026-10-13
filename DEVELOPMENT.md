# Development & publishing

Maintainer notes. End-user docs live in `README.md` and `CHANGELOG.md`.

---

## Compatibility matrix (local)

| Stack | Dev dependency (approx.) |
|-------|---------------------------|
| NestJS | `@nestjs/common` / `core` **12** |
| Bull classic | `bull` **4** + `@nestjs/bull` **12** |
| BullMQ | `bullmq` **6** (Job Schedulers) |
| Node | **≥ 20.19** |

Peers stay optional for `bull` / `bullmq` / `@nestjs/bull` so hosts can install only what they use.

---

## Build (library + dashboard assets)

```bash
npm install
npm run build
```

1. `build:frontend` — Vite SPA from `frontend/` → `public/`
2. `build:lib` — Nest module `src/` → `dist/`

Package contents: `"files": ["dist", "public"]`.

---

## UI development

```bash
cd frontend
npm install
npm run dev
```

Production builds write to `../public/`.

---

## Screenshots for GitHub

See [`docs/screenshots/README.md`](./docs/screenshots/README.md) for the labeled shot list. After capturing, drop files into `docs/screenshots/` so README images resolve.

---

## MCP (manual test)

1. Enable MCP: `BullseyeModule.forRoot({ …, mcp: { apiKey: '…' } })`.
2. `npm run build:lib` and start the Nest app.
3. Point Cursor MCP at `http://localhost:<port><basePath>/mcp` with `Authorization: Bearer <apiKey>`.
4. Verify tools (`list_queues`, `get_job`, …) and `401` without Bearer.
5. Confirm the SPA under `basePath` still works.

---

## Commit messages

This repo uses **[Conventional Commits](https://www.conventionalcommits.org/)** following [qoomon’s cheatsheet](https://gist.github.com/qoomon/5dfcdf8eec66a051ecd85625518cfd13). Agents must follow the same rules in [`AGENTS.md`](./AGENTS.md) (types, description style, `!` / `BREAKING CHANGE` for breaks).

```text
<type>(<optional scope>): <description>
```

Common types: `feat`, `fix`, `refactor`, `perf`, `style`, `test`, `docs`, `build`, `ops`, `chore`. Prefer short scopes such as `api`, `ui`, `drivers`, `alerts`, `mcp`, or `docs` when useful.

Examples: `feat(ui): add command palette`, `fix(drivers): handle missing paused counts`, `docs: clarify MCP auth`.

---

## Publish

Distribution is **npm** (`@catchhr/nestjs-bullseye`). GitHub holds source and release notes; hosts still install from the registry.

### Checklist

1. Move `[Unreleased]` entries in `CHANGELOG.md` into a dated version section (`## [x.y.z] — YYYY-MM-DD`).
2. Set `package.json` `version` to match (SemVer: breaking → major, `feat` → minor, otherwise patch).
3. Commit on `main` (or merge `develop` → `main`).
4. Tag and push:
   ```bash
   git tag v0.2.0
   git push origin main --tags
   ```
5. Optional GitHub Release from the tag (paste the changelog section as notes).
6. Log in if needed (`npm login`), then:
   ```bash
   npm publish --access public
   ```
   `prepublishOnly` runs `npm run build` (frontend → `public/`, lib → `dist/`). `public/assets/` is gitignored; the publish tarball still includes the built assets.

Before publishing, confirm `name`, `version`, and repository URLs ([catchHR/Bullseye](https://github.com/catchHR/Bullseye)).

---

## Frontend stack

React, Vite, Tailwind, Recharts (`frontend/`).
