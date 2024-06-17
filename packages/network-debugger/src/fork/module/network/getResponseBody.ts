import { BodyTransformer } from '../../pipe'
import { createHanlder } from '../common'

export const getResponseBodyHandler = createHanlder(
  'Network.getResponseBody',
  ({ id, devtool, request }) => {
    const body = new BodyTransformer(request).decodeBody()

    devtool.send({
      id: id,
      result: body
    })
  }
)
