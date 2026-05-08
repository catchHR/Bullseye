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

## Publish

```bash
npm publish --access public
```

Before publishing, verify `package.json` values like `name` and `version` are correct.

---

## Frontend stack

React, Vite, Tailwind, Recharts (sources live in `frontend/`).

