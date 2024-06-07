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
export const LOCK_FILE = "request-center.lock";
export const PORT = Number(process.env.NETWORK_PORT || 5270);
export const SERVER_PORT = Number(process.env.NETWORK_SERVER_PORT || 5271);
export const REMOTE_DEBUGGER_PORT = Number(process.env.REMOTE_DEBUGGER_PORT || 9333);
export const READY_MESSAGE = "ready";