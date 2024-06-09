export class RequestHeaderPipe {
  private headers: Record<string, any>;
  constructor(headers?: Record<string, any>) {
    this.headers = { ...(headers || {}) };
  }
  public getHeader(key: string) {
    const _key = key.toLowerCase();
    const keys = Object.keys(this.headers);
    for (const _k of keys) {
      if (_k.toLowerCase() === _key) {
        return this.headers[_k];
      }
    }
  }
  public getData() {
    return this.headers;
  }
  public valueOf() {
    return this.headers;
  }
}
