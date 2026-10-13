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

## Publish

```bash
npm publish --access public
```

Before publishing, check `package.json` `name`, `version`, and repository URLs ([catchHR/Bullseye](https://github.com/catchHR/Bullseye)).

---

## Frontend stack

React, Vite, Tailwind, Recharts (`frontend/`).
