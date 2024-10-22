import { RequestDetail } from '../../common'
import iconv from 'iconv-lite'
import { RequestHeaderPipe } from './request-header-transformer'

export class BodyTransformer {
  private req: RequestDetail
  constructor(req: RequestDetail) {
    this.req = req
  }

  public decodeBody() {
    const { req } = this
    const header = new RequestHeaderPipe(req.responseHeaders)
    const contentType = header.getHeader('content-type') || 'text/plain; charset=utf-8'
    const match = contentType.match(/charset=([^;]+)/)
    const encoding = match ? match[1] : 'utf-8'

    const isBinary = !/text|json|xml/.test(contentType)
    const body = (() => {
      if (req.responseData === undefined || req.responseData === null) {
        return void 0
      }
      if (isBinary) {
        return req.responseData.toString('base64')
      }
      if (Buffer.isBuffer(req.responseData)) {
        return iconv.decode(req.responseData, encoding)
      }
      // if responseData is `JSON.stringify(Buffer)` => {"type":"Buffer","data":[1,2,3,4,5]}
      // need to decode the Buffer
      if (
        typeof req.responseData === 'object' &&
        'type' in req.responseData &&
        req.responseData.type === 'Buffer' &&
        'data' in req.responseData &&
        Array.isArray(req.responseData.data)
      ) {
        return iconv.decode(Buffer.from(req.responseData.data), encoding)
      }
      return req.responseData
    })()

    return {
      body,
      base64Encoded: isBinary
    }
  }
}
