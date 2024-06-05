import { READY_MESSAGE, RequestDetail } from "../common";
import { type IncomingMessage } from "http";
import WebSocket from "ws";
import { fork } from "child_process";
import fs from "fs";
import { LOCK_FILE } from "../common";

export class MainProcess {
  private ws: Promise<WebSocket>;

  constructor({ port = 5270 }: { port: number; serverPort: number }) {
    this.ws = new Promise<WebSocket>((resolve) => {
      this.openProcess(() => {
        const socket = new WebSocket(`ws://localhost:${port}`);
        socket.on("open", () => {
          resolve(socket);
        });
      });
    });
    this.ws.then((ws) => {
      ws.on("error", (e) => {
        console.error("MainProcess Socket Error: ", e);
      });
    });
  }

  public openProcess(callback?: () => void) {
    if (fs.existsSync(LOCK_FILE)) {
      callback && callback();
      return;
    }
    const cp = fork(require.resolve("./fork"));

    const handleMsg = (e: any) => {
      if (e === READY_MESSAGE) {
        callback && callback();
        fs.writeFileSync(LOCK_FILE, String(cp.pid));
        cp.off("message", handleMsg);
      }
    };

    cp.on("message", handleMsg);
  }

  public closeProcess() {
    if (fs.existsSync(LOCK_FILE)) {
      const pid = fs.readFileSync(LOCK_FILE, "utf-8");
      process.kill(Number(pid), "SIGINT");
      fs.unlinkSync(LOCK_FILE);
    }
  }

  private async send(data: any) {
    const ws = await this.ws;
    ws.send(JSON.stringify(data));
  }

  public registerRequest(request: RequestDetail) {
    this.send({
      type: "registerRequest",
      data: request,
    });
  }

  public updateRequest(request: RequestDetail) {
    this.send({
      type: "updateRequest",
      data: request,
    });
  }

  public endRequest(request: RequestDetail) {
    this.send({
      type: "endRequest",
      data: request,
    });
  }

  public responseRequest(id: string, response: IncomingMessage) {
    const responseBuffer: Buffer[] = [];

    response.on("data", (chunk: any) => {
      responseBuffer.push(chunk);
    });

    response.on("end", () => {
      const rawData = Buffer.concat(responseBuffer);
      this.ws.then((ws) => {
        ws.send(
          JSON.stringify({
            type: "responseData",
            data: {
              id: id,
              rawData: rawData, // Convert to string
              statusCode: response.statusCode,
              headers: response.headers,
            },
          }),
          { binary: true }
        );
      });
    });
  }
}
