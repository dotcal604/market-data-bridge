"use client";

import { useEffect, useRef, useState } from "react";

interface ChannelMessage<T> {
  channel: string;
  data: T;
}

interface UseWebSocketResult<T> {
  data: T | null;
  connected: boolean;
}

function getWebSocketUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.host}/ws`;
}

export function useWebSocket<T>(channel: string): UseWebSocketResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [connected, setConnected] = useState<boolean>(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let closedByEffect = false;

    const connect = (): void => {
      const socket = new WebSocket(getWebSocketUrl());
      socketRef.current = socket;

      socket.onopen = () => {
        setConnected(true);
        socket.send(
          JSON.stringify({
            type: "auth",
            apiKey: process.env.NEXT_PUBLIC_REST_API_KEY ?? "",
          }),
        );
        socket.send(JSON.stringify({ type: "subscribe", channel }));
      };

      socket.onmessage = (event: MessageEvent<string>) => {
        const parsed = JSON.parse(event.data) as Partial<ChannelMessage<T>>;
        if (parsed.channel === channel && parsed.data !== undefined) {
          setData(parsed.data);
        }
      };

      socket.onerror = () => { socket.close(); };

      socket.onclose = () => {
        setConnected(false);
        if (!closedByEffect) {
          reconnectTimerRef.current = setTimeout(connect, 3_000);
        }
      };
    };

    connect();

    return () => {
      closedByEffect = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      socketRef.current?.close();
      socketRef.current = null;
      setConnected(false);
    };
  }, [channel]);

  return { data, connected };
}
