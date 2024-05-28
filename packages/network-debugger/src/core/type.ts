export class RequestDetail {
  id: string;
  constructor() {
    this.id = Math.random().toString(36).slice(2);
  }

  url?: string;
  method?: string;
  cookies: any;

  requestHeaders: any;
  requestData: any;

  responseData: any;
  responseStatusCode?: number;
  responseHeaders: any;

  requestStartTime?: number;
  requestEndTime?: number;
}
