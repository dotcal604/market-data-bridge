"use client";

import { useState, useRef, useCallback } from "react";

interface UseDropZoneOptions {
  accept?: string[];
  onDrop: (file: File) => void;
  disabled?: boolean;
}

interface UseDropZoneResult {
  isDragging: boolean;
  dropZoneProps: {
    onDragOver: (e: React.DragEvent) => void;
    onDragEnter: (e: React.DragEvent) => void;
    onDragLeave: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
  };
}

export function useDropZone({ accept, onDrop, disabled }: UseDropZoneOptions): UseDropZoneResult {
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);

  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (disabled) return;
      dragCounter.current++;
      setIsDragging(true);
    },
    [disabled],
  );

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter.current--;
      if (dragCounter.current === 0) setIsDragging(false);
    },
    [],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    },
    [],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter.current = 0;
      setIsDragging(false);
      if (disabled) return;

      const file = e.dataTransfer.files[0];
      if (!file) return;

      if (accept && accept.length > 0) {
        const ext = "." + file.name.split(".").pop()?.toLowerCase();
        if (!accept.includes(ext)) return;
      }

      onDrop(file);
    },
    [accept, onDrop, disabled],
  );

  return {
    isDragging,
    dropZoneProps: {
      onDragOver: handleDragOver,
      onDragEnter: handleDragEnter,
      onDragLeave: handleDragLeave,
      onDrop: handleDrop,
    },
  };
}
