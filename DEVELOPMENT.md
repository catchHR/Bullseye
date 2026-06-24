# Development & publishing

This document is for maintainers of the repository. The npm `README.md` is intentionally focused on **usage**.

---

## Build (library + dashboard assets)

```bash
npm install
npm run build
```

The build does two things:

1. `build:frontend`: builds the Vite SPA from `frontend/` into `public/`
2. `build:lib`: compiles the NestJS module from `src/` into `dist/`

The npm package includes both `dist/` and `public/` via `"files": ["dist", "public"]`.

---

## UI development (local)

```bash
cd frontend
npm install
npm run dev
```

Production builds write to `../public/`.

---

## MCP (manual test)

1. Enable MCP in your host app's `BullseyeModule.forRoot({ …, mcp: { apiKey: '…' } })`.
2. `npm run build:lib` and start the Nest app.
3. Add a Cursor MCP entry pointing at `http://localhost:<port><basePath>/mcp` with `Authorization: Bearer <apiKey>`.
4. In Cursor → Tools, verify tools list and run `list_queues` / `get_job` on a failed job.
5. Confirm `401` without Bearer header and that the SPA under `basePath` still works.

---

## Publish

```bash
npm publish --access public
```

Before publishing, verify `package.json` values like `name` and `version` are correct.

---

## Frontend stack

React, Vite, Tailwind, Recharts (sources live in `frontend/`).

