export const log = console.log.bind(console, '\x1B[36m[node-network-debugger]:', '\x1B[32m')

export const warn = console.warn.bind(console, '\x1B[36m[node-network-debugger](warn):', '\x1B[33m')
