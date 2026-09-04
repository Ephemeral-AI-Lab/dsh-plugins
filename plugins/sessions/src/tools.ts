/** Compatibility barrel for callers that imported the former flat tools module. */
export {
  registerSessionTools,
  registerSessionTools as registerSessionsTool,
} from './tools/index.js'
export * from './tools/session-create.js'
export * from './tools/session-send.js'
export * from './tools/session-status.js'
