import type { FastifyInstance } from 'fastify';
import type { Bus } from './bus/bus.js';
import type { HubConfig } from './config.js';
import type { Logger } from './log/logger.js';
import { createCasepackModule } from './casepacks/module.js';
import { createGestureModule } from './gesture/module.js';

export type ModuleStatus = 'mock' | 'live' | 'error';

export interface ModuleHealth {
  status: ModuleStatus;
  detail: string;
}

export interface HubContext {
  cfg: HubConfig;
  bus: Bus;
  log: Logger;
}

/**
 * A hub module. Each team member owns their modules; the server only knows this interface.
 * To add a module: write a create function in your folder and add it to createModules() below.
 */
export interface HubModule {
  name: string;
  start(): Promise<void> | void;
  stop?(): Promise<void> | void;
  health(): ModuleHealth;
  registerRoutes?(app: FastifyInstance): Promise<void> | void;
  /**
   * Called with every raw message a browser client sends over /ws before it is published.
   * Return true if the module consumed it (it will not be published as-is).
   */
  onClientMessage?(raw: unknown, clientId: string): boolean;
}

/** Module registry. Order matters only for route registration and shutdown. */
export function createModules(ctx: HubContext): HubModule[] {
  return [createCasepackModule(ctx), createGestureModule(ctx)];
}
