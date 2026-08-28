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

    const isBinary = !/text|json|xml|javascript|x-www-form-urlencoded/.test(contentType)
    const responseBuffer = (() => {
      if (Buffer.isBuffer(req.responseData)) return req.responseData
      if (
        typeof req.responseData === 'object' &&
        req.responseData !== null &&
        'type' in req.responseData &&
        req.responseData.type === 'Buffer' &&
        'data' in req.responseData &&
        Array.isArray(req.responseData.data)
      ) {
        return Buffer.from(req.responseData.data)
      }
      if (req.responseData instanceof Uint8Array) return Buffer.from(req.responseData)
      return undefined
    })()
    const body = (() => {
      if (req.responseData === undefined || req.responseData === null) {
        return void 0
      }
      if (isBinary) {
        return (responseBuffer ?? Buffer.from(String(req.responseData))).toString('base64')
      }
      if (responseBuffer) return iconv.decode(responseBuffer, encoding)
      return req.responseData
    })()

    return {
      body,
      base64Encoded: isBinary
    }
  }
}
