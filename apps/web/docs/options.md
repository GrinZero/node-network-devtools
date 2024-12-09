# Options

## RegisterOptions

The `RegisterOptions` interface is used to configure the registration options for the network debugger. Below are detailed descriptions of each option and their default values.

### Example

Here is an example of using `RegisterOptions`:

```typescript
import { RegisterOptions } from 'packages/network-debugger/src/common'

const options: RegisterOptions = {
  port: 5270,
  serverPort: 5271,
  autoOpenDevtool: true,
  intercept: {
    fetch: true,
    normal: true
  }
}

// Use options to register the network debugger
registerNetworkDebugger(options)
```

### port

- **Description**: Main process port
- **Default value**: `5270`

### serverPort

- **Description**: CDP server port for Devtool
- **Link**: [devtools://devtools/bundled/inspector.html?ws=localhost:${serverPort}](devtools://devtools/bundled/inspector.html?ws=localhost:${serverPort})
- **Default value**: `5271`

### autoOpenDevtool

- **Description**: Whether to automatically open Devtool
- **Default value**: `true`

### intercept

- **Description**: Options for intercepting specific packets. If set to `false`, the packet will not be intercepted.

#### intercept.fetch

- **Default value**: `true`

- **Description**: Whether to intercept globalThis.fetch

#### intercept.normal

- **Default value**: `true`

- **Description**: Whether to intercept requests made by http/https basic packages

#### intercept.undici

- **Default value**: `false`
- **Options**:
  - `fetch`: `false` or `{}`, not intercepted by default. Used to intercept `undici.fetch`
  - `normal`: `false` or `{}`, not intercepted by default. Used to intercept `undici.request`
