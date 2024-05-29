import { DevtoolServer } from "./devtool";
import { RequestDetail } from "./type";
import type { IncomingMessage } from "http";
import iconv from "iconv-lite";
import chardet from "chardet";

export class RequestCenter {
  private requests: Record<string, RequestDetail>;
  private devtool: DevtoolServer;
  constructor() {
    this.requests = {};
    this.devtool = new DevtoolServer();
    this.devtool.on((error, message) => {
      if (error) {
        return;
      }

      if (message.method === "Network.getResponseBody") {
        const req = this.getRequest(message.params.requestId);
        if (!req) {
          return;
        }
        const encoding = "utf-8";
        const str = iconv.decode(req.responseData, encoding);
        this.devtool.send({
          id: message.id,
          result: {
            body: str,
            base64Encoded: false,
          },
        });
      }
    });
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
      requestDetail.responseData = Buffer.concat(responseBuffer);
      this.updateRequest(requestDetail);
      this.endRequest(requestDetail);
    });
  }
}
