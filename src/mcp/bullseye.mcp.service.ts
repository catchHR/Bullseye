import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { Express, Request, Response } from 'express';
import * as express from 'express';
import { BullseyeApiService } from '../bullseye.api.service';
import { BULLSEYE_OPTIONS, BullseyeModuleOptions } from '../bullseye.types';
import { createBullseyeMcpBearerAuth } from './bullseye.mcp.auth';
import { createBullseyeMcpServer } from './bullseye.mcp.server';
import { BullseyeMcpSessionManager } from './bullseye.mcp.transport';

@Injectable()
export class BullseyeMcpService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BullseyeMcpService.name);
  private sessionManager: BullseyeMcpSessionManager | null = null;

  constructor(
    @Inject(BULLSEYE_OPTIONS)
    private readonly options: BullseyeModuleOptions,
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly api: BullseyeApiService,
  ) {}

  onModuleInit() {
    const mcp = this.options.mcp;
    if (!mcp) {
      return;
    }

    const apiKey = mcp.apiKey?.trim() ?? '';
    if (apiKey === '') {
      throw new Error(
        'Bullseye MCP: `mcp.apiKey` is required when `mcp` is configured.',
      );
    }

    const base = this.normalizeBasePath(this.options.basePath);
    const mcpSegment = this.normalizeMcpPath(mcp.path ?? '/mcp');
    const mountPath = `${base}${mcpSegment}`;
    const readOnly = mcp.readOnly !== false;

    this.sessionManager = new BullseyeMcpSessionManager(() =>
      createBullseyeMcpServer(this.api, { ...mcp, readOnly }),
    );

    const httpAdapter = this.httpAdapterHost.httpAdapter;
    const expressApp = httpAdapter.getInstance() as Express;
    const router = express.Router();
    router.use(express.json({ limit: '1mb' }));
    router.use(createBullseyeMcpBearerAuth(apiKey));
    router.all('/', async (req: Request, res: Response) => {
      try {
        await this.sessionManager!.handleRequest(req, res);
      } catch (error: unknown) {
        this.logger.error(error);
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: '2.0',
            error: {
              code: -32603,
              message: 'Internal MCP server error',
            },
            id: null,
          });
        }
      }
    });

    expressApp.use(mountPath, router);
    this.logger.log(
      `Bullseye MCP enabled at "${mountPath}" (${readOnly ? 'read-only' : 'read-write'}).`,
    );
  }

  async onModuleDestroy() {
    if (this.sessionManager) {
      await this.sessionManager.closeAll();
      this.sessionManager = null;
    }
  }

  private normalizeBasePath(basePath: string): string {
    return basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
  }

  private normalizeMcpPath(path: string): string {
    const trimmed = path.trim();
    if (trimmed === '' || trimmed === '/') {
      return '/mcp';
    }
    return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  }
}
