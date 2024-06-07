import { Server, WebSocket } from "ws";
import open, { apps } from "open";
import { type ChildProcess } from "child_process";
import { RequestDetail } from "../common";

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
    // 检测是否已经打开，已打开则跳过
    if (this.browser) {
      return this.browser;
    }

    const url = `devtools://devtools/bundled/inspector.html?ws=localhost:${this.port}`;
    const process = await open('', {
        app: {
            name: apps.chrome,
            arguments: ['--remote-debugging-port=9222']
        }
    });

    const json: any[] = await new Promise<any[]>((resolve, reject) => {
        let stop = setInterval(async () => {
            try {
                resolve((await fetch('http://127.0.0.1:9222/json')).json());
                clearInterval(stop);
            } catch (error) {
                console.log('未找到9222');
            }
        }, 500);
    });
    const { webSocketDebuggerUrl } = json[0];
    const debuggerWs = new WebSocket(webSocketDebuggerUrl);

    debuggerWs.on('open', () => {
        const navigateCommand = {
            id:1,
            method: 'Page.navigate',
            params: {
                url
            }
        };
        debuggerWs.send(JSON.stringify(navigateCommand));
        debuggerWs.close();
    });


    console.log("opened in chrome or click here to open chrome devtool: ", url);
    this.browser = process;
    return process;
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
                postData: request.requestData,
              }
            : {}),
        },
        timestamp: this.timestamp,
        wallTime: request.requestStartTime,
        initiator: {
          type: "other",
        },
        type: "Fetch",
      },
    });
  }

  async responseReceived(request: RequestDetail) {
    this.updateTimestamp();
    const headers = request.responseHeaders;

    const contentType = headers["content-type"] || "text/plain; charset=utf-8";

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
