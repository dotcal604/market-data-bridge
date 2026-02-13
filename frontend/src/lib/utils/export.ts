/**
 * Export utility for client-side data downloads
 */

/**
 * Convert array of objects to CSV string and trigger download
 */
export function exportToCsv(data: Record<string, unknown>[], filename: string): void {
  if (!data || data.length === 0) return;

  // Extract all unique headers from all objects to ensure no data is missed
  const headers = Array.from(
    data.reduce((acc, obj) => {
      Object.keys(obj).forEach((key) => acc.add(key));
      return acc;
    }, new Set<string>())
  );

  // Create CSV rows
  const csvRows = [
    // Header row
    headers
      .map((header) => {
        let h = header;
        if (
          h.includes(",") ||
          h.includes('"') ||
          h.includes("\n") ||
          h.includes("\r")
        ) {
          h = `"${h.replace(/"/g, '""')}"`;
        }
        return h;
      })
      .join(","),
    // Data rows
    ...data.map((row) => {
      return headers
        .map((header) => {
          const value = row[header];
          let cellValue: string;

          if (value === null || value === undefined) {
            cellValue = "";
          } else if (typeof value === "object") {
            // Handle nested objects by stringifying them
            cellValue = JSON.stringify(value);
          } else {
            cellValue = String(value);
          }

          // Escape commas and quotes
          // If the value contains a comma, quote, or newline, it must be enclosed in double quotes.
          // Any existing double quotes must be escaped by doubling them.
          if (
            cellValue.includes(",") ||
            cellValue.includes('"') ||
            cellValue.includes("\n") ||
            cellValue.includes("\r")
          ) {
            cellValue = `"${cellValue.replace(/"/g, '""')}"`;
          }

          return cellValue;
        })
        .join(",");
    }),
  ];

  const csvString = csvRows.join("\n");
  const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
  triggerDownload(blob, `${filename}.csv`);
}

/**
 * Convert data to formatted JSON and trigger download
 */
export function exportToJson(data: unknown, filename: string): void {
  const jsonString = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonString], { type: "application/json" });
  triggerDownload(blob, `${filename}.json`);
}

/**
 * Internal helper to trigger browser download
 */
function triggerDownload(blob: Blob, fullFilename: string): void {
  // Only execute in browser environment
  if (typeof document === "undefined") return;

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", fullFilename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
