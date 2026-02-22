"use client";

import { useEffect, useCallback, useRef, useState } from "react";

interface EvalCreatedMessage {
  type: "eval";
  action: "created";
  evalId: string;
  symbol: string;
  score: number;
  models: string[];
  timestamp: string;
  sequence_id: number;
}

interface JournalPostedMessage {
  type: "journal";
  action: "posted";
  entryId: number;
  symbol: string | null;
  reasoning: string;
  timestamp: string;
  sequence_id: number;
}

interface OrderFilledMessage {
  type: "order";
  action: "filled";
  orderId: number;
  symbol: string;
  price: number;
  qty: number;
  execution: {
    execId: string;
    side: string;
    avgPrice?: number;
  };
  timestamp: string;
  sequence_id: number;
}

type StreamMessage = EvalCreatedMessage | JournalPostedMessage | OrderFilledMessage;

interface UseStreamOptions {
  onMessage?: (message: StreamMessage) => void;
  onError?: (error: Error) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
}

interface WebSocketConfig {
  maxReconnectAttempts?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
}

/**
 * Hook for WebSocket streaming with auto-reconnect and exponential backoff.
 * Handles authentication, channel subscription, and message ordering.
 */
function useWebSocketStream(
  channels: string[],
  options: UseStreamOptions = {},
  config: WebSocketConfig = {}
) {
  const { onMessage, onError, onConnected, onDisconnected } = options;
  const {
    maxReconnectAttempts = 10,
    baseBackoffMs = 500,
    maxBackoffMs = 30000,
  } = config;

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectCountRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const messageQueueRef = useRef<Map<number, StreamMessage>>(new Map());
  const lastProcessedSeqRef = useRef(-1);
  const [isConnected, setIsConnected] = useState(false);

  // Get API key from localStorage or fallback
  const getApiKey = useCallback((): string => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem("api-key") || "";
  }, []);

  // Process queued messages in order
  const processMessageQueue = useCallback(() => {
    const queue = messageQueueRef.current;
    let processed = true;

    while (processed) {
      processed = false;
      const nextSeq = lastProcessedSeqRef.current + 1;
      const nextMsg = queue.get(nextSeq);

      if (nextMsg) {
        onMessage?.(nextMsg);
        lastProcessedSeqRef.current = nextSeq;
        queue.delete(nextSeq);
        processed = true;
      }
    }
  }, [onMessage]);

  // Connect to WebSocket
  const connect = useCallback(() => {
    if (typeof window === "undefined") return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    try {
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        // Authenticate with API key
        const apiKey = getApiKey();
        ws.send(JSON.stringify({ type: "auth", apiKey }));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          // Handle auth response
          if (msg.type === "auth") {
            if (msg.ok) {
              // Subscribe to channels
              for (const channel of channels) {
                ws.send(JSON.stringify({ type: "subscribe", channel }));
              }
              reconnectCountRef.current = 0;
              setIsConnected(true);
              onConnected?.();
            } else {
              throw new Error("Authentication failed");
            }
            return;
          }

          // Handle subscription confirmation
          if (msg.type === "subscribed") {
            return;
          }

          // Handle stream messages
          if (msg.channel && channels.includes(msg.channel)) {
            const data = msg.data as StreamMessage;
            const seqId = data.sequence_id ?? -1;

            // Queue message for ordered processing
            if (seqId >= 0) {
              messageQueueRef.current.set(seqId, data);
              processMessageQueue();
            } else {
              // Message without sequence ID (fallback)
              onMessage?.(data);
            }
          }
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          onError?.(error);
        }
      };

      ws.onerror = (event) => {
        const error = new Error(`WebSocket error: ${event.type}`);
        onError?.(error);
      };

      ws.onclose = () => {
        setIsConnected(false);
        onDisconnected?.();
        wsRef.current = null;

        // Schedule reconnect with exponential backoff
        if (reconnectCountRef.current < maxReconnectAttempts) {
          const backoffMs = Math.min(
            baseBackoffMs * Math.pow(2, reconnectCountRef.current),
            maxBackoffMs
          );
          reconnectCountRef.current += 1;
          reconnectTimeoutRef.current = setTimeout(connect, backoffMs);
        }
      };

      wsRef.current = ws;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      onError?.(error);
    }
  }, [channels, getApiKey, onConnected, onDisconnected, onError, onMessage, processMessageQueue, maxReconnectAttempts, baseBackoffMs, maxBackoffMs]);

  // Connect on mount
  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  return { isConnected };
}

/**
 * Hook to subscribe to eval creation messages.
 * Automatically handles WebSocket connection, authentication, and reconnect.
 */
export function useEvalStream(
  onEvalCreated?: (eval: EvalCreatedMessage) => void,
  options: UseStreamOptions = {},
  config: WebSocketConfig = {}
) {
  return useWebSocketStream(
    ["eval_created"],
    {
      ...options,
      onMessage: (msg) => {
        if (msg.type === "eval") {
          onEvalCreated?.(msg as EvalCreatedMessage);
        }
        options.onMessage?.(msg);
      },
    },
    config
  );
}

/**
 * Hook to subscribe to journal post messages.
 * Automatically handles WebSocket connection, authentication, and reconnect.
 */
export function useJournalStream(
  onJournalPosted?: (journal: JournalPostedMessage) => void,
  options: UseStreamOptions = {},
  config: WebSocketConfig = {}
) {
  return useWebSocketStream(
    ["journal_posted"],
    {
      ...options,
      onMessage: (msg) => {
        if (msg.type === "journal") {
          onJournalPosted?.(msg as JournalPostedMessage);
        }
        options.onMessage?.(msg);
      },
    },
    config
  );
}

/**
 * Hook to subscribe to order fill messages.
 * Automatically handles WebSocket connection, authentication, and reconnect.
 */
export function useOrderStream(
  onOrderFilled?: (order: OrderFilledMessage) => void,
  options: UseStreamOptions = {},
  config: WebSocketConfig = {}
) {
  return useWebSocketStream(
    ["order_filled"],
    {
      ...options,
      onMessage: (msg) => {
        if (msg.type === "order") {
          onOrderFilled?.(msg as OrderFilledMessage);
        }
        options.onMessage?.(msg);
      },
    },
    config
  );
}

/**
 * Hook to subscribe to multiple stream types simultaneously.
 */
export function useMultiStream(
  channelTypes: ("eval" | "journal" | "order")[],
  options: UseStreamOptions = {},
  config: WebSocketConfig = {}
) {
  const channels = channelTypes.map((type) => {
    switch (type) {
      case "eval":
        return "eval_created";
      case "journal":
        return "journal_posted";
      case "order":
        return "order_filled";
      default:
        return "";
    }
  });

  return useWebSocketStream(channels.filter(Boolean), options, config);
}
