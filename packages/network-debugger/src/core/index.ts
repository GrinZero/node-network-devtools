const http = require("http");
const https = require("https");
import type { IncomingMessage, ClientRequest } from "http";
import type { RequestOptions } from "https";
import { RequestDetail } from "./type";
import { RequestCenter } from "./request-center";

export async function register() {
  const requestCenter = new RequestCenter();

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
      requestCenter.endRequest(requestDetail);
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

      requestCenter.responseRequest(requestDetail.id, response);
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

      requestCenter.registerRequest(requestDetail);
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
    // Object.assign(agent, {
    //   request: requestProxyFactory(actualRequestHandlerFn, agent === https),
    // });
    // @ts-ignore
    agent.request = requestProxyFactory(
      actualRequestHandlerFn,
      agent === https
    );
  });
}
