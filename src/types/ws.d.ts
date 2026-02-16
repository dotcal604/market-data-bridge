declare module "ws" {
  import type { EventEmitter } from "node:events";
  import type { Server as HttpServer } from "node:http";

  export class WebSocket extends EventEmitter {
    static readonly OPEN: number;
    static readonly CLOSED: number;
    static readonly CLOSING: number;
    static readonly CONNECTING: number;
    readyState: number;
    send(data: string): void;
    close(code?: number, reason?: string): void;
    ping(): void;
    terminate(): void;
    on(event: "message", listener: (data: WebSocket.RawData) => void): this;
    on(event: "close", listener: () => void): this;
    on(event: "error", listener: (error: Error) => void): this;
    on(event: "pong", listener: () => void): this;
  }

  export namespace WebSocket {
    type RawData = Buffer | ArrayBuffer | Buffer[] | string;
  }

  export class WebSocketServer extends EventEmitter {
    constructor(options: { server: HttpServer; path?: string });
    clients: Set<WebSocket>;
    on(event: "connection", listener: (socket: WebSocket) => void): this;
    on(event: "close", listener: () => void): this;
  }
}
