import { Server, WebSocket } from "ws";
import open, { apps } from "open";
import { type ChildProcess } from "child_process";
import { IS_DEV_MODE, RequestDetail } from "../common";
import { REMOTE_DEBUGGER_PORT } from "../common";
import { RequestHeaderPipe } from "./pipe";

export interface DevtoolServerInitOptions {
  port: number;
}

const frameId = "517.528";
const loaderId = "517.529";

export const toMimeType = (contentType: string) => {
  return contentType.split(";")[0] || "text/plain";
};

export class DevtoolServer {
  private server: Server;
  private port: number;
  private browser: ChildProcess | null = null;
  private socket: Promise<[WebSocket]>;
  private timestamp = 0;
  private startTime = Date.now();

  private listeners: ((error: unknown | null, message?: any) => void)[] = [];
  constructor(props: DevtoolServerInitOptions) {
    const { port } = props;
    this.port = port;
    this.server = new Server({ port });
    const { server } = this;

    server.on("listening", () => {
      console.log(`devtool server is listening on port ${port}`);
      this.open();
    });

    this.socket = new Promise<[WebSocket]>((resolve) => {
      server.on("connection", (socket) => {
        this.socket.then((l) => {
          l[0] = socket;
        });
        console.log("devtool connected");
        socket.on("message", (message) => {
          const msg = JSON.parse(message.toString());
          this.listeners.forEach((listener) => listener(null, msg));
        });
        socket.on("close", () => {
          console.log("devtool closed");
        });
        socket.on("error", (error) => {
          this.listeners.forEach((listener) => listener(error));
        });
        resolve([socket] satisfies [WebSocket]);
      });
    });
  }

  private updateTimestamp() {
    this.timestamp = Date.now() - this.startTime;
  }

  public async open() {
    const url = `devtools://devtools/bundled/inspector.html?ws=localhost:${this.port}`;

    if (IS_DEV_MODE) {
      console.log(`In dev mode, open chrome devtool manually: ${url}`);
      return;
    }

    const pro = await open(url, {
      app: {
        name: apps.chrome,
        arguments: [
          process.platform !== "darwin"
            ? `--remote-debugging-port=${REMOTE_DEBUGGER_PORT}`
            : "",
        ],
      },
    });

    if (process.platform !== "darwin") {
      const json = await new Promise<
        { webSocketDebuggerUrl: string; id: string }[]
      >((resolve) => {
        let stop = setInterval(async () => {
          try {
            resolve(
              (
                await fetch(`http://localhost:${REMOTE_DEBUGGER_PORT}/json`)
              ).json()
            );
            clearInterval(stop);
          } catch {
            console.log("waiting for chrome to open");
          }
        }, 500);
      });
      const { id, webSocketDebuggerUrl } = json[0];
      const debuggerWs = new WebSocket(webSocketDebuggerUrl);

      debuggerWs.on("open", () => {
        const navigateCommand = {
          id,
          method: "Page.navigate",
          params: {
            url,
          },
        };
        debuggerWs.send(JSON.stringify(navigateCommand));
        debuggerWs.close();
      });
    }

    console.log("opened in chrome or click here to open chrome devtool: ", url);
    this.browser = pro;
    return pro;
  }

  public close() {
    this.server.close();
    this.browser && this.browser.kill();
  }

  async send(message: any) {
    const [socket] = await this.socket;
    return socket.send(JSON.stringify(message));
  }

  public on(listener: (error: unknown | null, message?: any) => void) {
    this.listeners.push(listener);
  }

  async requestWillBeSent(request: RequestDetail) {
    this.timestamp = Date.now() - this.startTime;

    const headerPipe = new RequestHeaderPipe(request.requestHeaders);
    const contentType = headerPipe.getHeader("content-type")

    return this.send({
      method: "Network.requestWillBeSent",
      params: {
        requestId: request.id,
        frameId,
        loaderId,
        request: {
          url: request.url,
          method: request.method,
          headers: request.requestHeaders,
          initialPriority: "High",
          mixedContentType: "none",
          ...(request.requestData
            ? {
                postData: contentType?.includes("application/json")
                  ? JSON.stringify(request.requestData)
                  : request.requestData,
              }
            : {}),
        },
        timestamp: this.timestamp,
        wallTime: request.requestStartTime,
        initiator: request.initiator,
        type: "Fetch",
      },
    });
  }

  async responseReceived(request: RequestDetail) {
    this.updateTimestamp();
    const headers = new RequestHeaderPipe(request.responseHeaders);

    const contentType = headers.getHeader("content-type") || "text/plain; charset=utf-8";

    const type = (() => {
      if (/image/.test(contentType)) {
        return "Image";
      }
      if (/javascript/.test(contentType)) {
        return "Script";
      }
      if (/css/.test(contentType)) {
        return "Stylesheet";
      }
      if (/html/.test(contentType)) {
        return "Document";
      }
      return "Other";
    })();

    this.send({
      method: "Network.responseReceived",
      params: {
        requestId: request.id,
        frameId,
        loaderId,
        timestamp: this.timestamp,
        type,
        response: {
          url: request.url,
          status: request.responseStatusCode,
          statusText: request.responseStatusCode === 200 ? "OK" : "",
          headers: request.responseHeaders,
          connectionReused: false,
          encodedDataLength: request.responseData.length,
          charset: "utf-8",
          mimeType: toMimeType(contentType),
        },
      },
    });

    this.updateTimestamp();
    this.send({
      method: "Network.dataReceived",
      params: {
        requestId: request.id,
        timestamp: this.timestamp,
        dataLength: request.responseData.length,
        encodedDataLength: request.responseData.length,
      },
    });

    this.updateTimestamp();
    this.send({
      method: "Network.loadingFinished",
      params: {
        requestId: request.id,
        timestamp: this.timestamp,
        encodedDataLength: request.responseData.length,
      },
    });
  }
}
