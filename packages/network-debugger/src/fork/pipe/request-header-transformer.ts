export class RequestHeaderTransformer {
  private headers: Record<string, any>;
  constructor(headers?: Record<string, any>) {
    this.headers = { ...(headers || {}) };
  }
  public getData() {
    return this.headers;
  }
  public valueOf() {
    return this.headers;
  }
}
