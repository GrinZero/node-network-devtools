import http from 'http'
import https from 'https'
import { requestProxyFactory } from './request'
import { MainProcess } from './fork'
import { proxyFetch } from './fetch'
// import * as dc from 'node:diagnostics_channel'
// import { registerDc } from './dc'

/**
 * @mark 暂时不支持
 */
export interface RegisterOptions {
  /**
   * @description 主进程端口
   * @default 5270
   */
  port?: number
  /**
   * @description CDP服务端口
   */
  serverPort?: number
}

export async function register(props?: RegisterOptions) {
  const { port = 5270, serverPort = 5271 } = props || {}
  const mainProcess = new MainProcess({
    port,
    serverPort
  })

  proxyFetch(mainProcess)

  const agents = [http, https]
  agents.forEach((agent) => {
    const actualRequestHandlerFn = agent.request
    agent.request = requestProxyFactory(actualRequestHandlerFn, agent === https, mainProcess)
  })
}
