import { BodyTransformer } from '../../pipe'
import { createPlugin, useHandler } from '../common'

export const networkPlugin = createPlugin(({ devtool }) => {
  useHandler('Network.getResponseBody', ({ id, request }) => {
    const body = new BodyTransformer(request).decodeBody()

    devtool.send({
      id: id,
      result: body
    })
  })
})
