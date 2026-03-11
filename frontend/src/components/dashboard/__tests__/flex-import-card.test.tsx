import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FlexImportCard } from "../flex-import-card";

vi.mock("@/lib/hooks/use-flex", () => ({
  useFlexStats: vi.fn(),
  useFlexFetch: vi.fn(),
  useFlexImportContent: vi.fn(),
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

import { useFlexStats, useFlexFetch, useFlexImportContent } from "@/lib/hooks/use-flex";

describe("FlexImportCard", () => {
  let queryClient: QueryClient;
  const mockUseFlexStats = useFlexStats as ReturnType<typeof vi.fn>;
  const mockUseFlexFetch = useFlexFetch as ReturnType<typeof vi.fn>;
  const mockUseFlexImport = useFlexImportContent as ReturnType<typeof vi.fn>;

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

  function setupDefaults() {
    mockUseFlexFetch.mockReturnValue(defaultMutation);
    mockUseFlexImport.mockReturnValue(defaultMutation);
  }

  it("shows loading skeleton when stats are loading", () => {
    mockUseFlexStats.mockReturnValue({ data: undefined, isLoading: true });
    setupDefaults();

    const { container } = render(<FlexImportCard />, { wrapper });

    expect(screen.getByText("IBKR Flex Import")).toBeInTheDocument();
    expect(container.innerHTML).toContain("skeleton");
  });

  it("shows empty state when no trades exist", () => {
    mockUseFlexStats.mockReturnValue({
      data: {
        total_trades: 0, unique_symbols: 0, accounts: 0,
        total_commission: 0, total_realized_pnl: 0, total_net_cash: 0,
        first_trade: null, last_trade: null, import_batches: 0,
      },
      isLoading: false,
    });
    setupDefaults();

    render(<FlexImportCard />, { wrapper });

    expect(screen.getByText("No trades imported yet")).toBeInTheDocument();
  });

  it("shows stats when trades exist", () => {
    mockUseFlexStats.mockReturnValue({
      data: {
        total_trades: 47, unique_symbols: 12, accounts: 1,
        total_bought: 1000, total_sold: 800,
        total_commission: -142, total_realized_pnl: 2350, total_net_cash: 5000,
        first_trade: "2026-01-15", last_trade: "2026-03-10", import_batches: 5,
      },
      isLoading: false,
    });
    setupDefaults();

    render(<FlexImportCard />, { wrapper });

    expect(screen.getByText(/47/)).toBeInTheDocument();
    expect(screen.getByText(/12 symbols/)).toBeInTheDocument();
    expect(screen.getByText(/2,350/)).toBeInTheDocument();
    expect(screen.getByText(/2026-01-15/)).toBeInTheDocument();
  });

  it("shows spinner when fetching from IBKR", () => {
    mockUseFlexStats.mockReturnValue({ data: undefined, isLoading: false });
    mockUseFlexFetch.mockReturnValue({ ...defaultMutation, isPending: true });
    mockUseFlexImport.mockReturnValue(defaultMutation);

    render(<FlexImportCard />, { wrapper });

    expect(screen.getByText(/Fetching/)).toBeInTheDocument();
  });

  it("has both Fetch and Upload buttons", () => {
    mockUseFlexStats.mockReturnValue({ data: undefined, isLoading: false });
    setupDefaults();

    render(<FlexImportCard />, { wrapper });

    expect(screen.getByText(/Fetch from IBKR/)).toBeInTheDocument();
    // Upload button has only an icon, verify it exists
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBe(2);
  });

  it("calls fetchAndImport on Fetch button click", async () => {
    const mutateAsync = vi.fn().mockResolvedValue({
      batch_id: "abc", report_type: "trade_confirmations", account_id: "U123",
      from_date: "2026-03-01", to_date: "2026-03-10",
      total_rows: 10, inserted: 8, skipped: 2, errors: [],
    });

    mockUseFlexStats.mockReturnValue({ data: undefined, isLoading: false });
    mockUseFlexFetch.mockReturnValue({ ...defaultMutation, mutateAsync });
    mockUseFlexImport.mockReturnValue(defaultMutation);

    render(<FlexImportCard />, { wrapper });

    fireEvent.click(screen.getByText(/Fetch from IBKR/));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledOnce();
    });
  });

  it("shows success result after fetch", async () => {
    const mutateAsync = vi.fn().mockResolvedValue({
      batch_id: "abc", report_type: "trade_confirmations", account_id: "U123",
      from_date: "2026-03-01", to_date: "2026-03-10",
      total_rows: 10, inserted: 8, skipped: 2, errors: [],
    });

    mockUseFlexStats.mockReturnValue({ data: undefined, isLoading: false });
    mockUseFlexFetch.mockReturnValue({ ...defaultMutation, mutateAsync });
    mockUseFlexImport.mockReturnValue(defaultMutation);

    render(<FlexImportCard />, { wrapper });

    fireEvent.click(screen.getByText(/Fetch from IBKR/));

    await waitFor(() => {
      expect(screen.getByText(/Imported 8/)).toBeInTheDocument();
      expect(screen.getByText(/skipped 2/)).toBeInTheDocument();
    });
  });

  it("shows error message on fetch failure", () => {
    mockUseFlexStats.mockReturnValue({ data: undefined, isLoading: false });
    mockUseFlexFetch.mockReturnValue({ ...defaultMutation, error: new Error("No Flex token provided") });
    mockUseFlexImport.mockReturnValue(defaultMutation);

    render(<FlexImportCard />, { wrapper });

    expect(screen.getByText("No Flex token provided")).toBeInTheDocument();
  });

  it("shows green color for positive P&L", () => {
    mockUseFlexStats.mockReturnValue({
      data: {
        total_trades: 10, unique_symbols: 3, accounts: 1,
        total_bought: 100, total_sold: 100,
        total_commission: -50, total_realized_pnl: 500, total_net_cash: 0,
        first_trade: "2026-03-01", last_trade: "2026-03-10", import_batches: 1,
      },
      isLoading: false,
    });
    setupDefaults();

    const { container } = render(<FlexImportCard />, { wrapper });

    const pnlEl = container.querySelector(".text-green-500");
    expect(pnlEl).toBeInTheDocument();
    expect(pnlEl?.textContent).toContain("500");
  });

  it("shows red color for negative P&L", () => {
    mockUseFlexStats.mockReturnValue({
      data: {
        total_trades: 10, unique_symbols: 3, accounts: 1,
        total_bought: 100, total_sold: 100,
        total_commission: -50, total_realized_pnl: -300, total_net_cash: 0,
        first_trade: "2026-03-01", last_trade: "2026-03-10", import_batches: 1,
      },
      isLoading: false,
    });
    setupDefaults();

    const { container } = render(<FlexImportCard />, { wrapper });

    const pnlEl = container.querySelector(".text-red-500");
    expect(pnlEl).toBeInTheDocument();
  });

  it("has hidden file input accepting XML and CSV", () => {
    mockUseFlexStats.mockReturnValue({ data: undefined, isLoading: false });
    setupDefaults();

    render(<FlexImportCard />, { wrapper });

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.accept).toBe(".xml,.csv");
  });
});
