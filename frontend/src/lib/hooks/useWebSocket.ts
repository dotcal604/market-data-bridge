"use client";

import { useEffect, useRef, useState, useCallback } from "react";

// WebSocket message types (must match backend)
export type Channel = "positions" | "orders" | "account" | "executions";

interface SubscribeMessage {
  type: "subscribe";
  channel: Channel;
}

interface UnsubscribeMessage {
  type: "unsubscribe";
  channel: Channel;
}

interface DataMessage {
  type: "data";
  channel: Channel;
  data: any;
}

interface ErrorMessage {
  type: "error";
  message: string;
}

interface PingMessage {
  type: "ping";
}

interface PongMessage {
  type: "pong";
}

type ServerMessage = DataMessage | ErrorMessage | PongMessage;

export interface UseWebSocketOptions {
  /** Channel to subscribe to */
  channel: Channel;
  /** Whether to automatically connect (default: true) */
  enabled?: boolean;
  /** Custom WebSocket URL (default: ws://localhost:3000) */
  url?: string;
  /** API key for authentication */
  apiKey?: string;
  /** Callback when data is received */
  onData?: (data: any) => void;
  /** Callback when error occurs */
  onError?: (error: string) => void;
  /** Callback when connection state changes */
  onConnectionChange?: (connected: boolean) => void;
}

export interface UseWebSocketReturn<T = any> {
  /** Latest data received */
  data: T | null;
  /** Whether WebSocket is connected */
  connected: boolean;
  /** Any error message */
  error: string | null;
  /** Manually reconnect */
  reconnect: () => void;
  /** Send a ping message */
  ping: () => void;
}

/**
 * Generic WebSocket hook with auto-reconnect and exponential backoff
 * 
 * @example
 * const { data, connected } = useWebSocket({
 *   channel: "positions",
 *   onData: (positions) => console.log("Positions updated:", positions)
 * });
 */
export function useWebSocket<T = any>(options: UseWebSocketOptions): UseWebSocketReturn<T> {
  const {
    channel,
    enabled = true,
    url = getWebSocketUrl(),
    apiKey,
    onData,
    onError,
    onConnectionChange,
  } = options;

  const [data, setData] = useState<T | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const intentionalCloseRef = useRef(false);

  // Calculate backoff delay (exponential with jitter)
  const getReconnectDelay = useCallback(() => {
    const baseDelay = 1000; // 1 second
    const maxDelay = 30000; // 30 seconds
    const attempt = reconnectAttemptsRef.current;
    const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
    // Add jitter (±25%)
    const jitter = delay * 0.25 * (Math.random() * 2 - 1);
    return Math.floor(delay + jitter);
  }, []);

  // Send message to WebSocket
  const send = useCallback((message: SubscribeMessage | UnsubscribeMessage | PingMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  // Ping function
  const ping = useCallback(() => {
    send({ type: "ping" });
  }, [send]);

  // Connect to WebSocket
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN || !enabled) {
      return;
    }

    intentionalCloseRef.current = false;

    try {
      // Build WebSocket URL with API key if provided
      let wsUrl = url;
      if (apiKey) {
        const urlObj = new URL(wsUrl);
        urlObj.searchParams.set("apiKey", apiKey);
        wsUrl = urlObj.toString();
      }

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log(`[WebSocket] Connected to ${channel} channel`);
        setConnected(true);
        setError(null);
        reconnectAttemptsRef.current = 0;
        onConnectionChange?.(true);

        // Subscribe to channel
        send({ type: "subscribe", channel });
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as ServerMessage;

          if (message.type === "data") {
            const receivedData = message.data as T;
            setData(receivedData);
            onData?.(receivedData);
          } else if (message.type === "error") {
            const errorMsg = message.message;
            setError(errorMsg);
            onError?.(errorMsg);
            console.error(`[WebSocket] Error:`, errorMsg);
          } else if (message.type === "pong") {
            // Heartbeat response
          }
        } catch (err) {
          console.error("[WebSocket] Failed to parse message:", err);
        }
      };

      ws.onerror = (event) => {
        console.error(`[WebSocket] Error on ${channel} channel:`, event);
        setError("WebSocket connection error");
        onError?.("WebSocket connection error");
      };

      ws.onclose = (event) => {
        console.log(`[WebSocket] Disconnected from ${channel} channel`, event.code, event.reason);
        setConnected(false);
        onConnectionChange?.(false);
        wsRef.current = null;

        // Auto-reconnect if not intentionally closed
        if (!intentionalCloseRef.current && enabled) {
          const delay = getReconnectDelay();
          console.log(`[WebSocket] Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current + 1})...`);
          reconnectAttemptsRef.current++;
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, delay);
        }
      };
    } catch (err) {
      console.error(`[WebSocket] Failed to connect:`, err);
      setError("Failed to establish WebSocket connection");
      onError?.("Failed to establish WebSocket connection");
    }
  }, [channel, enabled, url, apiKey, send, onData, onError, onConnectionChange, getReconnectDelay]);

  // Manual reconnect function
  const reconnect = useCallback(() => {
    if (wsRef.current) {
      intentionalCloseRef.current = true;
      wsRef.current.close();
    }
    reconnectAttemptsRef.current = 0;
    connect();
  }, [connect]);

  // Connect on mount and when enabled changes
  useEffect(() => {
    if (enabled) {
      connect();
    }

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        intentionalCloseRef.current = true;
        wsRef.current.close();
      }
    };
  }, [enabled, connect]);

  return {
    data,
    connected,
    error,
    reconnect,
    ping,
  };
}

/**
 * Get WebSocket URL based on current window location
 * Falls back to localhost:3000 if not in browser
 */
function getWebSocketUrl(): string {
  // API server port - should match backend config (REST_PORT env var, default 3000)
  const API_PORT = "3000";
  
  if (typeof window === "undefined") {
    return `ws://localhost:${API_PORT}`;
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.hostname;
  
  // In development, frontend is on :3001 but API is on :3000
  const port = process.env.NODE_ENV === "development" ? API_PORT : window.location.port || API_PORT;
  
  return `${protocol}//${host}:${port}`;
}
