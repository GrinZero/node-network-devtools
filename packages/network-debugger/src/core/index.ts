const http = require("http");
const https = require("https");
import { requestProxyFactory } from "./request";
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

export async function register(props: RegisterOptions) {
  const { port = 5270, serverPort = 5271 } = props || {};
  const mainProcess = new MainProcess({
    port,
    serverPort,
  });

  const agents = [http, https];

  agents.forEach((agent) => {
    const actualRequestHandlerFn = agent.request;
    // @ts-ignore
    agent.request = requestProxyFactory(
      actualRequestHandlerFn,
      agent === https,
      mainProcess
    );
  });
}
