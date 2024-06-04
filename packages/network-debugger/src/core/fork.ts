import { fork } from "child_process";
import { RequestDetail } from "./type";
import http from "http";
import requestCenterFilePath from "./request-center?url";

class MainProcess {
  private requestCenterProcess;

  constructor() {
    this.requestCenterProcess = fork(requestCenterFilePath);
  }

  public registerRequest(request: RequestDetail) {
    this.requestCenterProcess.send({
      type: "registerRequest",
      data: request,
    });
  }

  public updateRequest(request: RequestDetail) {
    this.requestCenterProcess.send({
      type: "updateRequest",
      data: request,
    });
  }

  public endRequest(request: RequestDetail) {
    this.requestCenterProcess.send({
      type: "endRequest",
      data: request,
    });
  }

  public responseRequest(id: string, response: http.IncomingMessage) {
    const responseBuffer: Buffer[] = [];

    response.on("data", (chunk: any) => {
      responseBuffer.push(chunk);
    });

    response.on("end", () => {
      const rawData = Buffer.concat(responseBuffer);
      this.requestCenterProcess.send({
        type: "responseData",
        data: {
          id: id,
          rawData: rawData,
          statusCode: response.statusCode,
          headers: response.headers,
        },
      });
    });
  }
}

const mainProcess = new MainProcess();
