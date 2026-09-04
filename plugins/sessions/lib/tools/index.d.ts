import type { Context } from '@deepseek-ai/cordis';
import { SessionCreationService } from '../creation-service.js';
import { SessionSendService } from '../send-service.js';
import { SessionsService } from '../service.js';
export declare function registerSessionTools(ctx: Context, service: SessionsService, creationService?: SessionCreationService, sendService?: SessionSendService): () => void;
export { registerSessionCreateTool } from './session-create.js';
export { registerSessionSendTool } from './session-send.js';
export { registerSessionStatusTool } from './session-status.js';
//# sourceMappingURL=index.d.ts.map