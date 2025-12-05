# Options

## RegisterOptions

The `RegisterOptions` interface is used to configure the registration options for the network debugger. Below are detailed descriptions of each option and their default values.

### Example

Here is an example of using `RegisterOptions`:

```typescript
import { RegisterOptions, register } from 'node-network-devtools'

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
register(options)
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

- **Description**: Options for intercepting different types of requests.
  If a property is set to `false`, that specific type of request will not be intercepted.
  By default, all are intercepted if not explicitly set.

#### intercept.fetch

- **Description**: Whether to intercept `fetch` requests.
- **Default value**: `true`

#### intercept.normal

- **Description**: Whether to intercept `http/https` requests.
- **Default value**: `true`

#### intercept.undici

- **Description**: Options for intercepting `undici` requests. Set to `false` to disable all `undici` interception. Otherwise, configure specific `undici` interception options.
- **Default value**: `false`
- **Options**:
  - `fetch`: Whether to intercept `undici`'s `fetch` requests. Defaults to `false`.
  - `normal`: Whether to intercept `undici`'s normal requests. Defaults to `false`.

## ConnectOptions

The `ConnectOptions` interface configures options for connecting to the network debugger.

### port

- **Description**: Main process port
- **Default value**: `5270`

## UnregisterOptions

The `UnregisterOptions` interface configures options for unregistering the network debugger.

### port

- **Description**: Main process port
- **Default value**: `5270`

## SetRequestInterceptorOptions

The `SetRequestInterceptorOptions` interface configures options for setting a request interceptor.

### port

- **Description**: Main process port
- **Default value**: `5270`

### request

- **Description**: A function to intercept and modify outgoing requests.

## SetResponseInterceptorOptions

The `SetResponseInterceptorOptions` interface configures options for setting a response interceptor.

### port

- **Description**: Main process port
- **Default value**: `5270`

### response

- **Description**: A function to intercept and modify incoming responses.

## RemoveRequestInterceptorOptions

The `RemoveRequestInterceptorOptions` interface configures options for removing a request interceptor.

### port

- **Description**: Main process port
- **Default value**: `5270`

## RemoveResponseInterceptorOptions

The `RemoveResponseInterceptorOptions` interface configures options for removing a response interceptor.

### port

- **Description**: Main process port
- **Default value**: `5270`