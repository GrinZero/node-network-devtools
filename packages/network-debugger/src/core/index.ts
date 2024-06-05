const http = require("http");
const https = require("https");
import type { IncomingMessage, ClientRequest } from "http";
import type { RequestOptions } from "https";
import { RequestDetail } from "../common";
import { MainProcess } from "./fork";

/**
 * @mark 暂时不支持
 */
export interface RegisterOptions {
  /**
   * @description 主进程端口
   * @default 5270
   */
  port?: number;
  /**
   * @description CDP服务端口
   */
  serverPort?: number;
}


if (process.env.NETWORK_DEBUGGER) {
  console.log("network devtools run in debug mode");
  new MainProcess({ port: 5270, serverPort: 5271 }).closeProcess();
}

export async function register(props: RegisterOptions) {
  const { port = 5270, serverPort = 5271 } = props || {};
  const mainProcess = new MainProcess({
    port,
    serverPort,
  });

  function proxyClientRequestFactory(
    actualRequest: ClientRequest,
    requestDetail: RequestDetail
  ) {
    const actualFn = actualRequest.write;
    actualRequest.write = (data: any) => {
      try {
        requestDetail.requestData = JSON.parse(data.toString());
      } catch (err) {
        requestDetail.requestData = data;
      }

      return actualFn.bind(actualRequest)(data);
    };

    actualRequest.on("error", () => {
      requestDetail.responseStatusCode = 0;
      requestDetail.requestEndTime = new Date().getTime();
      // requestCenter.endRequest(requestDetail);
      mainProcess.endRequest(requestDetail);
    });

    return actualRequest;
  }

  function proxyCallbackFactory(
    actualCallBack: any,
    requestDetail: RequestDetail
  ) {
    return (response: IncomingMessage) => {
      requestDetail.responseHeaders = response.headers;

      if (typeof actualCallBack === "function") {
        actualCallBack(response);
      }

      mainProcess.responseRequest(requestDetail.id, response);
    };
  }

  function requestProxyFactory(actualRequestHandler: any, isHttps: boolean) {
    return (options: string | RequestOptions | URL, cb: any) => {
      const requestDetail = new RequestDetail();
      requestDetail.requestStartTime = Date.now();

      if (typeof options === "string") {
        requestDetail.url = options;
        requestDetail.method = "GET";
      } else if (options instanceof URL) {
        requestDetail.url = options.toString();
        requestDetail.method = "GET";
      } else if (options) {
        const connectionType = isHttps ? "https" : "http";
        requestDetail.url = `${connectionType}://${
          options.hostname || options.host
        }${options.path}`;
        requestDetail.method = options.method;
        requestDetail.requestHeaders = options.headers;
      }

      mainProcess.registerRequest(requestDetail);
      const proxyCallback = proxyCallbackFactory(cb, requestDetail);
      const request: ClientRequest = actualRequestHandler(
        options,
        proxyCallback
      );
      return proxyClientRequestFactory(request, requestDetail);
    };
  }

  const agents = [http, https];

  agents.forEach((agent) => {
    const actualRequestHandlerFn = agent.request;
    // @ts-ignore
    agent.request = requestProxyFactory(
      actualRequestHandlerFn,
      agent === https
    );
  });
}
