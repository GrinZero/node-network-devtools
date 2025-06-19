export interface DevtoolMessageRequest {
  method: string
  params: Record<string, any>
}

export interface DevtoolMessageResponse {
  id: string
  result: any
  method?: string
}

export interface DevtoolErrorResponse {
  id: string
  error: { code: number; message?: string }
}

export type DevtoolMessage = DevtoolMessageRequest | DevtoolMessageResponse | DevtoolErrorResponse

export class BaseDevtoolServer {
  public timestamp = 0
  private startTime = Date.now()
  public getTimestamp() {
    this.updateTimestamp()
    return this.timestamp
  }
  public listeners: ((error: unknown | null, message?: any) => void)[] = []
  public updateTimestamp() {
    this.timestamp = (Date.now() - this.startTime) / 1000
  }
  public on(listener: (error: unknown | null, message?: any) => void) {
    this.listeners.push(listener)
  }
}
