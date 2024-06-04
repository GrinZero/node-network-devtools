import { DevtoolServer } from "./devtool";
import { READY_MESSAGE, RequestDetail } from "../common";
import type { IncomingMessage } from "http";
import iconv from "iconv-lite";
import zlib from "zlib";
import { Server } from "ws";

export interface RequestCenterInitOptions {
  port?: number;
}

export class RequestCenter {
  private requests: Record<string, RequestDetail>;
  private devtool: DevtoolServer;
  private server: Server;
  constructor({ port }: { port: number }) {
    this.requests = {};
    this.devtool = new DevtoolServer({
      port,
    });
    this.devtool.on((error, message) => {
      if (error) {
        return;
      }

      if (message.method === "Network.getResponseBody") {
        const req = this.getRequest(message.params.requestId);
        if (!req) {
          return;
        }
        const contentType =
          req.responseHeaders?.["content-type"] || "text/plain; charset=utf-8";
        const match = contentType.match(/charset=([^;]+)/);
        const encoding = match ? match[1] : "utf-8";

        const isBinary = !/text|json|xml/.test(contentType);
        const body = isBinary
          ? req.responseData.toString("base64")
          : iconv.decode(req.responseData, encoding);

        this.devtool.send({
          id: message.id,
          result: {
            body,
            base64Encoded: isBinary,
          },
        });
      }
    });
    this.server = this.initServer();
  }

  private initServer() {
    const server = new Server({ port: 5270 });
    server.on("connection", (ws) => {
      ws.on("message", (data) => {
        const message = JSON.parse(data.toString());
        const _message = message as { type: string; data: any };
        switch (_message.type) {
          case "registerRequest":
          case "updateRequest":
          case "endRequest":
            this[_message.type](_message.data);
            break;
          case "responseData":
            const request = this.getRequest(message.data.id);
            if (request) {
              this.tryDecompression(
                Buffer.from(message.data.rawData),
                (decodedData) => {
                  request.responseData = decodedData;
                  request.responseStatusCode = message.data.statusCode;
                  request.responseHeaders = message.data.headers;
                  this.updateRequest(request);
                  this.endRequest(request);
                }
              );
            }
            break;
        }
      });
    });
    server.on("listening", () => {
      setTimeout(() => {
        if (process.send) {
          process.send(READY_MESSAGE);
        }
      }, 10);
    });

    return server;
  }

  private getRequest(id: string) {
    return this.requests[id];
  }

  public registerRequest(request: RequestDetail) {
    this.requests[request.id] = request;
    // console.log("registerRequest", request);
    this.devtool.requestWillBeSent(request);
  }

  public updateRequest(request: RequestDetail) {
    this.requests[request.id] = request;
    // console.log("updateRequest", request);
  }

  public endRequest(request: RequestDetail) {
    request.requestEndTime = request.requestEndTime || Date.now();
    // console.log("endRequest", request);
    this.devtool.responseReceived(request);
  }

  public responseRequest(id: string, response: IncomingMessage) {
    const requestDetail = this.requests[id];
    if (!requestDetail) {
      return;
    }

    const responseBuffer: Buffer[] = [];

    requestDetail.responseStatusCode = response.statusCode;

    response.on("data", (chunk: any) => {
      responseBuffer.push(chunk);
    });

    response.on("aborted", () => {
      requestDetail.responseStatusCode = 0;
      requestDetail.requestEndTime = new Date().getTime();
      this.updateRequest(requestDetail);
    });

    response.on("error", () => {
      requestDetail.responseStatusCode = 0;
      requestDetail.requestEndTime = new Date().getTime();
      this.updateRequest(requestDetail);
    });

    response.on("end", () => {
      const rawData = Buffer.concat(responseBuffer);
      this.tryDecompression(rawData, (decodedData) => {
        requestDetail.responseData = decodedData;
        this.updateRequest(requestDetail);
        this.endRequest(requestDetail);
      });
    });
  }

  private tryDecompression(data: Buffer, callback: (result: Buffer) => void) {
    const decompressors: Array<
      (data: Buffer, cb: (err: Error | null, result: Buffer) => void) => void
    > = [zlib.gunzip, zlib.inflate, zlib.brotliDecompress];

    let attempts = 0;

    const tryNext = () => {
      if (attempts >= decompressors.length) {
        callback(data); // 理论上没有压缩
        return;
      }

      const decompressor = decompressors[attempts];
      attempts += 1;

      decompressor(data, (err, result) => {
        if (!err) {
          callback(result);
        } else {
          tryNext();
        }
      });
    };

    tryNext();
  }
}
