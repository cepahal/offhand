import { z } from 'zod';
import { ViewerCommand } from './command.js';
import { GestureEvent } from './gesture.js';
import { ShareEvent } from './share.js';
import { ViewerState } from './state.js';

export const VoiceEvent = z
  .object({
    kind: z
      .enum(['listening', 'transcript', 'speaking', 'tool', 'error'])
      .describe('Voice event kind.'),
    text: z.string().optional().describe('Transcript/tool/error text.'),
  })
  .describe('Voice module event.');

export const LogEvent = z
  .object({
    level: z.enum(['debug', 'info', 'warn', 'error']).describe('Severity.'),
    module: z.string().describe('Emitting module.'),
    msg: z.string().describe('Message.'),
    data: z.record(z.string(), z.unknown()).optional().describe('Structured extras.'),
  })
  .describe('Log line broadcast to clients.');

export const BusEnvelope = z
  .discriminatedUnion('ch', [
    z.object({ ch: z.literal('cmd'), cmd: ViewerCommand }).describe('A viewer command.'),
    z.object({ ch: z.literal('state'), state: ViewerState }).describe('Latest viewer state.'),
    z.object({ ch: z.literal('gesture'), ev: GestureEvent }).describe('Raw gesture-board event.'),
    z.object({ ch: z.literal('share'), ev: ShareEvent }).describe('Share event.'),
    z.object({ ch: z.literal('voice'), ev: VoiceEvent }).describe('Voice event.'),
    z.object({ ch: z.literal('log'), ...LogEvent.shape }).describe('Log line.'),
  ])
  .describe('Everything on the hub WebSocket is one of these.');
export type BusEnvelope = z.infer<typeof BusEnvelope>;
export type BusChannel = BusEnvelope['ch'];
export type VoiceEvent = z.infer<typeof VoiceEvent>;
export type LogEvent = z.infer<typeof LogEvent>;
