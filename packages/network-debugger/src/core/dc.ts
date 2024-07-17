import { ClientRequest, IncomingMessage } from 'http'
import { MainProcess } from './fork'
import * as dc from 'node:diagnostics_channel'
import { RequestDetail } from '../common'
import * as ayncHooks from 'node:async_hooks'

const stackMap = new Map()

const asyncHook = ayncHooks.createHook({
  init(asyncId, type) {
    if (type === 'HTTPPARSER' || type === 'HTTPCLIENTREQUEST') {
      const stack = new Error().stack
      stackMap.set(asyncId, stack)
    }
  },
  destroy(asyncId) {
    stackMap.delete(asyncId)
  }
})
asyncHook.enable()

export type MergeClientRequest = ClientRequest & {
  _inspectorRequestId: string
}

export const registerDc = (mainProcess: MainProcess) => {
  dc.subscribe('http.client.request.start', (event) => {
    const request = (event as any).request as MergeClientRequest
    const requestDetail = new RequestDetail()
    requestDetail.url = `${request.protocol}//${request.host}${request.path}`
    requestDetail.method = request.method
    requestDetail.requestHeaders = request.getHeaders()
    request._inspectorRequestId = requestDetail.id

    const asyncId = ayncHooks.executionAsyncId()
    const stack = stackMap.get(asyncId + 1)
    requestDetail.loadCallFrames(stack || '')
    mainProcess.registerRequest(requestDetail)
  })

  dc.subscribe('http.client.response.finish', (event) => {
    const request = (event as any).request as MergeClientRequest
    const response = (event as any).response as IncomingMessage
    if (typeof request._inspectorRequestId !== 'string') {
      return
    }
    mainProcess.responseRequest(request._inspectorRequestId, response)
  })
}
