import { CallSite } from './call-site'

const ignoreList = [
  /* node:async_hooks */
  /\((internal\/)?async_hooks\.js:/,
  /* external */
  /\(\//,
  /* node_modules */
  /node_modules/
]

export function getStackFrames(_stack?: string) {
  const e = Object.create(null)
  if (_stack) {
    e.stack = _stack
  } else {
    Error.stackTraceLimit = Infinity
    Error.captureStackTrace(e)
  }
  const stack = e.stack
  const frames = stack
    .split('\n')
    .slice(1)
    .map((frame: string) => new CallSite(frame))
  return frames
}

export function initiatorStackPipe(sites: CallSite[]) {
  const frames = sites.filter((site) => {
    return !ignoreList.some((reg) => reg.test(site.fileName || ''))
  })

  return frames
}
