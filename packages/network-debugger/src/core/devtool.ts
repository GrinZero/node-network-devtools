import { Server, type WebSocket } from "ws";
import open, { apps } from "open";
import { type ChildProcess } from "child_process";
import { RequestDetail } from "./type";
const PORT = 5270;

export interface DevtoolServerInitOptions {
  port?: number;
}

const frameId = "517.528";
const loaderId = "517.529";
export class DevtoolServer {
  private server: Server;
  private port: number;
  private browser: ChildProcess | null = null;
  private socket: Promise<[WebSocket]>;
  private timestamp = 0;
  private startTime = Date.now();

  private listeners: ((error: unknown | null, message?: any) => void)[] = [];
  constructor(props?: DevtoolServerInitOptions) {
    const { port = PORT } = props || {};
    this.port = port;
    const server = new Server({ port });
    this.server = server;

    let connected = false;
    server.on("listening", () => {
      console.log(`devtool server is listening on port ${port}`);

      setTimeout(() => {
        if (!connected) {
          this.open();
        }
      }, 10);
    });

    this.socket = new Promise<[WebSocket]>((resolve) => {
      server.on("connection", (socket) => {
        connected = true;
        this.socket.then((l) => {
          l[0] = socket;
        });
        console.log("devtool connected");
        socket.on("message", (message) => {
          this.listeners.forEach((listener) => listener(null, message));
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

  public async open() {
    const url = `devtools://devtools/bundled/inspector.html?ws=localhost:${this.port}`;
    const process = await open(url, {
      app: {
        name: apps.chrome,
      },
    });
    console.log("click to open chrome devtool: ", url);
    this.browser = process;
    return process;
  }

  public close() {
    this.server.close();
    this.browser && this.browser.kill();
  }

  async send(message: any) {
    const [socket] = await this.socket;
    return socket.send(message);
  }

  public on(listener: (error: unknown | null, message?: any) => void) {
    this.listeners.push(listener);
  }

  async requestWillBeSent(request: RequestDetail) {
    this.timestamp = Date.now() - this.startTime;

    return this.send(
      JSON.stringify({
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
      })
    );
  }

  async responseReceived(request: RequestDetail) {
    this.timestamp = Date.now() - this.startTime;
    return this.send(
      JSON.stringify({
        method: "Network.responseReceived",
        params: {
          requestId: request.id,
          frameId,
          loaderId,
          timestamp: this.timestamp,
          type: "Document",
          response: {
            url: request.url,
            status: request.responseStatusCode,
            statusText: "",
            headers: request.responseHeaders,
            mimeType: "text/html",
            connectionReused: false,
            connectionId: 0,
            encodedDataLength: 0,
          },
        },
      })
    );
  }
}
