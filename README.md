# nestjs-bullseye

> **Work in progress**: This project is currently being developed primarily for internal use at our company.  
> We’re happy if you try it out and would love to get feedback (issues, suggestions, and PRs are welcome).

Embedded **web dashboard for [Bull](https://github.com/OptimalBits/bull)** (classic Bull queues) in a **NestJS** app with **Express**. Includes queue/job overviews, repeatable jobs, cross-queue logs, runtime statistics, and optional **webhook alerts**. The UI ships as **static assets** — no separate “Bull Board” service required.

> Targets: **Bull (bull + @nestjs/bull)** and **BullMQ (bullmq)**.

---

## Install

```bash
npm install @catchhr/nestjs-bullseye
```

### Peer dependencies (install in the host app)

If your app doesn’t have them yet:

```bash
npm install @nestjs/common @nestjs/core @nestjs/bull bull ioredis express
```

### Why there’s a `.npmrc` in this package

This repository includes a `.npmrc` with `omit=peer` so `npm install` does **not** pull duplicate copies of `@nestjs/*` or `bull` into this package’s own `node_modules`. That helps avoid DI/runtime issues caused by multiple NestJS instances being resolved at runtime.

> Maintainer docs (build/publish/UI development): see `DEVELOPMENT.md`.

---

## Quick start

Import `BullseyeModule` **after** you configure Bull (`BullModule.forRoot` / `registerQueue`). Use the **same Redis settings and the same `prefix`** as your workers.

### Backend selection (Bull vs BullMQ)

- Default: `backend: 'bull'`
- BullMQ: set `backend: 'bullmq'` (queues can be discovered via Redis key scanning, or configured explicitly via `queueNames`).

```typescript
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { BullseyeModule } from '@catchhr/nestjs-bullseye';

@Module({
  imports: [
    BullModule.forRoot({
      redis: { host: 'localhost', port: 6379 },
      prefix: 'myapp',
    }),
    BullModule.registerQueue({ name: 'email' }),
    BullseyeModule.forRoot({
      basePath: '/queue-dashboard',
      redis: { host: 'localhost', port: 6379 },
      prefix: 'myapp',
      backend: 'bull', // or: 'bullmq'
      queueNames: ['email'], // optional allow-list (recommended in locked-down environments)
    }),
  ],
})
export class AppModule {}
```

Dashboard: `http://localhost:3000/queue-dashboard` (adjust the port to your Nest app).

### Async config

```typescript
BullseyeModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    basePath: '/queue-dashboard',
    redis: config.get('REDIS_URL'),
    prefix: config.get('BULL_PREFIX'),
  }),
}),
```

---

## Module options (`BullseyeModuleOptions`)

| Option | Type | Description |
|--------|------|-------------|
| `backend` | `'bull' \| 'bullmq'` | Queue backend implementation (default: `bull`). |
| `basePath` | `string` | Mount path **without** a trailing slash (SPA + `/api/*`). |
| `faviconPath` | `string?` | Optional favicon file to serve as `${basePath}/favicon.ico` (absolute or relative to `process.cwd()`). |
| `redis` | same shape as `BullModule.forRoot` | Must match your workers. |
| `prefix` | `string?` | Bull key prefix (same as in `BullModule.forRoot`). |
| `queueNames` | `string[]?` | Fixed allow-list; if omitted, queues can be discovered automatically (see below). |
| `autoDiscoverQueues` | `boolean` | Default `true`. If `false`, only configured/DI-provided queues are exposed. |
| `basicAuth` | `{ username, password } \| null` | HTTP Basic auth for UI and API under `basePath`. |
| `middleware` | Express middleware \| `null` | Runs after Basic auth (e.g. additional checks). |
| `alertsStoragePath` | `string?` | JSON file for alerts (default: `.bullseye-alerts.json` in `process.cwd()`). |
| `operator` | `BullseyeOperatorProfile \| null` | Optional sidebar profile (name/contact/avatar); returned via `GET …/api/ui-config`. |

Exported token: **`BULLSEYE_OPTIONS`**.

Queues can be detected via Nest DI (Bull classic) and/or via Redis key scanning (`{prefix}:*:meta`).

---

## Security

Do **not** expose this dashboard publicly without protection. Use `basicAuth`, custom `middleware`, and network controls (VPN / firewall).

### Alerts / webhooks

- Config is stored as JSON at `alertsStoragePath` (default: `.bullseye-alerts.json`).
- Bull events are emitted from the **local** queue instance — typically only when workers run in the **same** NestJS process.

---

## API overview (mounted under `basePath`)

- `GET /api/ui-config`, `GET /api/queues`, `GET /api/repeatable-jobs`, `GET /api/stats/job-runtime`, `GET /api/job-log`
- `GET/POST /api/alerts`, `PUT/DELETE /api/alerts/:id`, `GET /api/alerts/trigger-types`, `GET /api/alerts/suggested-job-names?queues=a,b`
- `GET /api/queues/:queueName/jobs`, `GET /api/queues/:queueName/jobs/:jobId`
- `POST /api/queues/:queueName/jobs` — create a job (body: `{ name?, data, opts? }`, JSON)
- `POST /api/queues/:queueName/jobs/:jobId/promote` — promote a delayed job to **waiting** (204)
- `POST /api/queues/:queueName/jobs/:jobId/duplicate` — duplicate a job (body: `{ name?, data?, opts? }`; `opts` replaces the source `opts` after stripping `jobId`/`timestamp`)

---

## License

MIT
