export const CLI_HELP = `Node Network Devtools

Usage:
  nnd dev [options] <entry> [-- args...]
  nnd doctor [--json] [--probe-wait <ms>]
  nnd replay [--dry-run] [--json] [--timeout <ms>] <session-dir|har-file>

Dev options:
  --open                    Open DevTools when the Inspector target appears
  --no-wait                 Start the application immediately (default: wait)
  --watch                   Restart the application when files change
  --runner <node|tsx>       Select the application runner (default: node)
  --mode <auto|native|legacy>
  --config <path>           Use an explicit nnd.config.mjs/cjs/json file
  --inspect-host <host>     Inspector bind host (default: 127.0.0.1)
  --inspect-port <port>     Inspector port; 0 asks the OS to choose
  --require <capability>    Require an adapter capability; may be repeated

Replay options:
  --dry-run                 Validate and print the request plan without I/O
  --stop-on-error           Stop after the first HTTP or transport failure
  --timeout <ms>            Per-request timeout (default: 30000)
  --json                    Print the complete machine-readable report

Configuration precedence:
  explicit CLI > NND_* environment > config file > defaults

By default, Native/Auto targets pause before the application entry runs. Attach
a debugger to the printed Inspector URL, pass --open to attach automatically,
or pass --no-wait to run immediately. Forced Legacy mode never starts Inspector.
`
