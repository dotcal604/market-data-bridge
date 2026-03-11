import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TraderSyncImportCard } from "../tradersync-import-card";

vi.mock("@/lib/hooks/use-tradersync", () => ({
  useTraderSyncStats: vi.fn(),
  useTraderSyncImport: vi.fn(),
}));

vi.mock("@/lib/hooks/use-drop-zone", () => ({
  useDropZone: vi.fn(() => ({
    isDragging: false,
    dropZoneProps: {
      onDragOver: vi.fn(),
      onDragEnter: vi.fn(),
      onDragLeave: vi.fn(),
      onDrop: vi.fn(),
    },
  })),
}));

import { useTraderSyncStats, useTraderSyncImport } from "@/lib/hooks/use-tradersync";

describe("TraderSyncImportCard", () => {
  let queryClient: QueryClient;
  const mockStats = useTraderSyncStats as ReturnType<typeof vi.fn>;
  const mockImport = useTraderSyncImport as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.clearAllMocks();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  const defaultMutation = {
    mutateAsync: vi.fn(),
    isPending: false,
    error: null,
  };

  /** Stub readFile that returns controlled CSV content */
  const stubReadFile = (csv: string) => vi.fn().mockResolvedValue(csv);

  /** Trigger file selection via the hidden input */
  function selectFile(content = "csv") {
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    // Create a minimal file-like for the change event target
    const file = new File([content], "trades.csv", { type: "text/csv" });
    // fireEvent sets event.target to the DOM element; we override files via getter
    const fileList = { 0: file, length: 1, item: () => file };
    Object.defineProperty(input, "files", { get: () => fileList, configurable: true });
    fireEvent.change(input);
  }

  it("shows loading skeleton", () => {
    mockStats.mockReturnValue({ data: undefined, isLoading: true });
    mockImport.mockReturnValue(defaultMutation);

    const { container } = render(<TraderSyncImportCard />, { wrapper });

    expect(screen.getByText("TraderSync Import")).toBeInTheDocument();
    expect(container.innerHTML).toContain("skeleton");
  });

  it("shows empty state when no trades", () => {
    mockStats.mockReturnValue({
      data: {
        total_trades: 0, wins: 0, losses: 0, win_rate: null, avg_r: null,
        total_pnl: null, avg_pnl: null, total_net: null, unique_symbols: 0,
        first_trade: null, last_trade: null, import_batches: 0,
      },
      isLoading: false,
    });
    mockImport.mockReturnValue(defaultMutation);

    render(<TraderSyncImportCard />, { wrapper });

    expect(screen.getByText("No trades imported yet")).toBeInTheDocument();
  });

  it("shows stats with win rate and P&L", () => {
    mockStats.mockReturnValue({
      data: {
        total_trades: 120, wins: 72, losses: 48, win_rate: 0.6,
        avg_r: 1.35, total_pnl: 4500, avg_pnl: 37.5, total_net: 4200,
        unique_symbols: 25, first_trade: "2026-01-02", last_trade: "2026-03-10",
        import_batches: 3,
      },
      isLoading: false,
    });
    mockImport.mockReturnValue(defaultMutation);

    render(<TraderSyncImportCard />, { wrapper });

    expect(screen.getByText(/120/)).toBeInTheDocument();
    expect(screen.getByText(/25 symbols/)).toBeInTheDocument();
    expect(screen.getByText(/60.0%/)).toBeInTheDocument();
    expect(screen.getByText(/72W/)).toBeInTheDocument();
    expect(screen.getByText(/\$4,500/)).toBeInTheDocument();
    expect(screen.getByText(/1\.35R/)).toBeInTheDocument();
  });

  it("shows spinner when importing", () => {
    mockStats.mockReturnValue({ data: undefined, isLoading: false });
    mockImport.mockReturnValue({ ...defaultMutation, isPending: true });

    render(<TraderSyncImportCard />, { wrapper });

    expect(screen.getByText(/Importing/)).toBeInTheDocument();
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("reads file and calls mutateAsync with CSV content", async () => {
    const csvContent = "Status,Symbol,Size\nWIN,AAPL,100";
    const readFile = stubReadFile(csvContent);
    const mutateAsync = vi.fn().mockResolvedValue({
      batch_id: "abc", total_parsed: 15, inserted: 12, skipped: 3, errors: [],
    });

    mockStats.mockReturnValue({ data: undefined, isLoading: false });
    mockImport.mockReturnValue({ ...defaultMutation, mutateAsync });

    render(<TraderSyncImportCard readFile={readFile} />, { wrapper });

    selectFile(csvContent);

    await waitFor(() => {
      expect(readFile).toHaveBeenCalled();
      expect(mutateAsync).toHaveBeenCalledWith(csvContent);
    });
  });

  it("shows success result after import", async () => {
    const mutateAsync = vi.fn().mockResolvedValue({
      batch_id: "abc", total_parsed: 15, inserted: 12, skipped: 3, errors: [],
    });

    mockStats.mockReturnValue({ data: undefined, isLoading: false });
    mockImport.mockReturnValue({ ...defaultMutation, mutateAsync });

    render(<TraderSyncImportCard readFile={stubReadFile("csv")} />, { wrapper });

    selectFile();

    await waitFor(() => {
      expect(screen.getByText(/imported 12/)).toBeInTheDocument();
      expect(screen.getByText(/skipped 3/)).toBeInTheDocument();
    });
  });

  it("shows error message on failure", () => {
    mockStats.mockReturnValue({ data: undefined, isLoading: false });
    mockImport.mockReturnValue({
      ...defaultMutation,
      error: new Error("CSV parse error: unexpected column"),
    });

    render(<TraderSyncImportCard />, { wrapper });

    expect(screen.getByText("CSV parse error: unexpected column")).toBeInTheDocument();
  });

  it("shows red for negative P&L", () => {
    mockStats.mockReturnValue({
      data: {
        total_trades: 10, wins: 3, losses: 7, win_rate: 0.3,
        avg_r: -0.5, total_pnl: -1200, avg_pnl: -120, total_net: -1300,
        unique_symbols: 5, first_trade: "2026-03-01", last_trade: "2026-03-10",
        import_batches: 1,
      },
      isLoading: false,
    });
    mockImport.mockReturnValue(defaultMutation);

    const { container } = render(<TraderSyncImportCard />, { wrapper });

    const redPnl = container.querySelector(".text-red-500");
    expect(redPnl).toBeInTheDocument();
  });

  it("shows warning count when errors present", async () => {
    const mutateAsync = vi.fn().mockResolvedValue({
      batch_id: "abc", total_parsed: 20, inserted: 17, skipped: 1,
      errors: ["Row 5: missing symbol", "Row 12: missing symbol"],
    });

    mockStats.mockReturnValue({ data: undefined, isLoading: false });
    mockImport.mockReturnValue({ ...defaultMutation, mutateAsync });

    render(<TraderSyncImportCard readFile={stubReadFile("csv")} />, { wrapper });

    selectFile();

    await waitFor(() => {
      expect(screen.getByText(/2 warnings/)).toBeInTheDocument();
    });
  });

  it("has hidden CSV file input with correct accept attribute", () => {
    mockStats.mockReturnValue({ data: undefined, isLoading: false });
    mockImport.mockReturnValue(defaultMutation);

    render(<TraderSyncImportCard />, { wrapper });

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.accept).toBe(".csv");
    expect(input.className).toContain("hidden");
  });
});
