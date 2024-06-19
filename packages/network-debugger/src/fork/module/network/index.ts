import { BodyTransformer } from '../../pipe'
import { createPlugin, useHandler } from '../common'

export const networkPlugin = createPlugin(({ devtool }) => {
  useHandler('Network.getResponseBody', ({ id, request }) => {
    if (!request) {
      console.error('request is not found')
      return
    }
    const body = new BodyTransformer(request).decodeBody()

    devtool.send({
      id: id,
      result: body
    })
  })
})
