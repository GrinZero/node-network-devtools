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
      if (isBinary) {
        return req.responseData.toString('base64')
      }
      if (req.responseData instanceof Buffer) {
        return iconv.decode(req.responseData, encoding)
      }
      return req.responseData
    })()

    return {
      body,
      base64Encoded: isBinary
    }
  }
}
