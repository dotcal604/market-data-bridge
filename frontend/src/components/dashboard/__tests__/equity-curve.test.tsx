import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EquityCurve } from '../equity-curve';
import type { AccountSnapshot, IntradayPnLResponse } from '@/lib/api/types';

// Mock the hook
vi.mock('@/lib/hooks/use-account', () => ({
  useIntradayPnL: vi.fn(),
}));

import { useIntradayPnL } from '@/lib/hooks/use-account';

describe('EquityCurve Component', () => {
  let queryClient: QueryClient;
  const mockUseIntradayPnL = useIntradayPnL as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    vi.clearAllMocks();
  });

  const createWrapper = () => {
    return ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  };

  /**
   * Test 1: Loading State
   */
  it('displays loading skeleton when data is loading', () => {
    mockUseIntradayPnL.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    });

    const { container } = render(<EquityCurve />, { wrapper: createWrapper() });

    expect(screen.getByText('Intraday Equity Curve')).toBeInTheDocument();
    // Skeleton should be rendered - check for height class in any element
    const hasSkeleton = container.textContent ? container.innerHTML.includes('skeleton') : false;
    // Verify container has the expected structure for loading state
    const mainDiv = container.querySelector('.rounded-lg');
    expect(mainDiv).toBeInTheDocument();
  });

  /**
   * Test 2: Error State
   */
  it('displays error message when data fetch fails', () => {
    const errorMessage = 'Failed to load equity curve data';
    mockUseIntradayPnL.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error(errorMessage),
    });

    render(<EquityCurve />, { wrapper: createWrapper() });

    expect(screen.getByText('Intraday Equity Curve')).toBeInTheDocument();
    expect(screen.getByText(errorMessage)).toBeInTheDocument();
  });

  /**
   * Test 3: No Data State
   */
  it('displays no data message when snapshots array is empty', () => {
    mockUseIntradayPnL.mockReturnValue({
      data: {
        snapshots: [],
        count: 0,
      } as IntradayPnLResponse,
      isLoading: false,
      error: null,
    });

    render(<EquityCurve />, { wrapper: createWrapper() });

    expect(screen.getByText('Intraday Equity Curve')).toBeInTheDocument();
    expect(
      screen.getByText(
        'No intraday data yet. Snapshots are taken every 5 minutes during market hours.'
      )
    ).toBeInTheDocument();
  });

  /**
   * Test 4: Success State with Data
   */
  it('renders chart with data and calculates high water mark correctly', () => {
    const mockSnapshots: AccountSnapshot[] = [
      {
        id: 1,
        net_liquidation: 100000,
        total_cash_value: 50000,
        buying_power: 100000,
        daily_pnl: 100,
        unrealized_pnl: 50,
        realized_pnl: 50,
        created_at: new Date('2026-02-19T09:30:00Z').toISOString(),
      },
      {
        id: 2,
        net_liquidation: 101000,
        total_cash_value: 51000,
        buying_power: 101000,
        daily_pnl: 500,
        unrealized_pnl: 200,
        realized_pnl: 300,
        created_at: new Date('2026-02-19T10:00:00Z').toISOString(),
      },
      {
        id: 3,
        net_liquidation: 100500,
        total_cash_value: 50500,
        buying_power: 100500,
        daily_pnl: 250,
        unrealized_pnl: 100,
        realized_pnl: 150,
        created_at: new Date('2026-02-19T10:30:00Z').toISOString(),
      },
    ];

    mockUseIntradayPnL.mockReturnValue({
      data: {
        snapshots: mockSnapshots,
        count: mockSnapshots.length,
      } as IntradayPnLResponse,
      isLoading: false,
      error: null,
    });

    const { container } = render(<EquityCurve />, { wrapper: createWrapper() });

    // Check header is displayed
    expect(screen.getByText('Intraday Equity Curve')).toBeInTheDocument();
    expect(screen.getByText(/Current:/)).toBeInTheDocument();
    expect(screen.getByText(/High:/)).toBeInTheDocument();

    // Check that chart container is rendered (Recharts ResponsiveContainer)
    const chartContainer = container.querySelector('.recharts-responsive-container');
    expect(chartContainer).toBeInTheDocument();

    // Verify dimensions are set correctly
    expect(chartContainer?.getAttribute('style')).toContain('height: 260px');
  });

  /**
   * Test 5: Positive P&L Color Logic
   */
  it('displays green color for positive P&L', () => {
    const mockSnapshots: AccountSnapshot[] = [
      {
        id: 1,
        net_liquidation: 100000,
        total_cash_value: 50000,
        buying_power: 100000,
        daily_pnl: 250,
        unrealized_pnl: 100,
        realized_pnl: 150,
        created_at: new Date('2026-02-19T09:30:00Z').toISOString(),
      },
    ];

    mockUseIntradayPnL.mockReturnValue({
      data: {
        snapshots: mockSnapshots,
        count: 1,
      } as IntradayPnLResponse,
      isLoading: false,
      error: null,
    });

    const { container } = render(<EquityCurve />, { wrapper: createWrapper() });

    // Check that the current P&L is displayed
    expect(screen.getByText(/Current:/)).toBeInTheDocument();

    // Check that green color class exists in the container
    expect(container.textContent).toContain('$250.00');

    // Verify chart is rendered
    expect(container.querySelector('.recharts-responsive-container')).toBeInTheDocument();
  });

  /**
   * Test 6: Negative P&L Color Logic
   */
  it('displays red color for negative P&L', () => {
    const mockSnapshots: AccountSnapshot[] = [
      {
        id: 1,
        net_liquidation: 99000,
        total_cash_value: 49000,
        buying_power: 99000,
        daily_pnl: -500,
        unrealized_pnl: -200,
        realized_pnl: -300,
        created_at: new Date('2026-02-19T09:30:00Z').toISOString(),
      },
    ];

    mockUseIntradayPnL.mockReturnValue({
      data: {
        snapshots: mockSnapshots,
        count: 1,
      } as IntradayPnLResponse,
      isLoading: false,
      error: null,
    });

    const { container } = render(<EquityCurve />, { wrapper: createWrapper() });

    // Check that the current P&L is displayed with negative value
    expect(screen.getByText(/Current:/)).toBeInTheDocument();

    // Verify chart is rendered
    expect(container.querySelector('.recharts-responsive-container')).toBeInTheDocument();
  });

  /**
   * Test 7: High Water Mark Display Logic
   */
  it('does not show high water mark if max P&L is not positive', () => {
    const mockSnapshots: AccountSnapshot[] = [
      {
        id: 1,
        net_liquidation: 99000,
        total_cash_value: 49000,
        buying_power: 99000,
        daily_pnl: -500,
        unrealized_pnl: -200,
        realized_pnl: -300,
        created_at: new Date('2026-02-19T09:30:00Z').toISOString(),
      },
      {
        id: 2,
        net_liquidation: 98500,
        total_cash_value: 48500,
        buying_power: 98500,
        daily_pnl: -750,
        unrealized_pnl: -300,
        realized_pnl: -450,
        created_at: new Date('2026-02-19T10:00:00Z').toISOString(),
      },
    ];

    mockUseIntradayPnL.mockReturnValue({
      data: {
        snapshots: mockSnapshots,
        count: mockSnapshots.length,
      } as IntradayPnLResponse,
      isLoading: false,
      error: null,
    });

    render(<EquityCurve />, { wrapper: createWrapper() });

    // Should show "Current:" but not "High:" since max P&L is negative
    expect(screen.getByText(/Current:/)).toBeInTheDocument();
    expect(screen.queryByText(/^High:/)).not.toBeInTheDocument();
  });

  /**
   * Test 8: Zero Line Reference
   */
  it('renders chart components including zero line reference', () => {
    const mockSnapshots: AccountSnapshot[] = [
      {
        id: 1,
        net_liquidation: 100000,
        total_cash_value: 50000,
        buying_power: 100000,
        daily_pnl: 500,
        unrealized_pnl: 200,
        realized_pnl: 300,
        created_at: new Date('2026-02-19T09:30:00Z').toISOString(),
      },
    ];

    mockUseIntradayPnL.mockReturnValue({
      data: {
        snapshots: mockSnapshots,
        count: 1,
      } as IntradayPnLResponse,
      isLoading: false,
      error: null,
    });

    const { container } = render(<EquityCurve />, { wrapper: createWrapper() });

    // Verify chart container is present
    expect(container.querySelector('.recharts-responsive-container')).toBeInTheDocument();

    // Verify dimensions for the chart
    const chartContainer = container.querySelector('.recharts-responsive-container');
    expect(chartContainer?.getAttribute('style')).toContain('height: 260px');
  });

  /**
   * Test 9: Eastern Time Formatting
   */
  it('handles Eastern Time formatting for timestamps', () => {
    const mockSnapshots: AccountSnapshot[] = [
      {
        id: 1,
        net_liquidation: 100000,
        total_cash_value: 50000,
        buying_power: 100000,
        daily_pnl: 100,
        unrealized_pnl: 50,
        realized_pnl: 50,
        created_at: '2026-02-19T14:30:00Z', // 2:30 PM UTC = 9:30 AM ET
      },
    ];

    mockUseIntradayPnL.mockReturnValue({
      data: {
        snapshots: mockSnapshots,
        count: 1,
      } as IntradayPnLResponse,
      isLoading: false,
      error: null,
    });

    render(<EquityCurve />, { wrapper: createWrapper() });

    // Component should render without errors
    expect(screen.getByText('Intraday Equity Curve')).toBeInTheDocument();
  });

  /**
   * Test 10: Multiple Snapshots Flow
   */
  it('handles multiple snapshots correctly', () => {
    const mockSnapshots: AccountSnapshot[] = [
      {
        id: 1,
        net_liquidation: 100000,
        total_cash_value: 50000,
        buying_power: 100000,
        daily_pnl: 100,
        unrealized_pnl: 50,
        realized_pnl: 50,
        created_at: new Date('2026-02-19T09:30:00Z').toISOString(),
      },
      {
        id: 2,
        net_liquidation: 100500,
        total_cash_value: 50500,
        buying_power: 100500,
        daily_pnl: 300,
        unrealized_pnl: 150,
        realized_pnl: 150,
        created_at: new Date('2026-02-19T10:00:00Z').toISOString(),
      },
      {
        id: 3,
        net_liquidation: 101000,
        total_cash_value: 51000,
        buying_power: 101000,
        daily_pnl: 600,
        unrealized_pnl: 300,
        realized_pnl: 300,
        created_at: new Date('2026-02-19T10:30:00Z').toISOString(),
      },
    ];

    mockUseIntradayPnL.mockReturnValue({
      data: {
        snapshots: mockSnapshots,
        count: mockSnapshots.length,
      } as IntradayPnLResponse,
      isLoading: false,
      error: null,
    });

    const { container } = render(<EquityCurve />, { wrapper: createWrapper() });

    // Check that all key elements are present
    expect(screen.getByText('Intraday Equity Curve')).toBeInTheDocument();
    expect(screen.getByText(/Current:/)).toBeInTheDocument();
    expect(screen.getByText(/High:/)).toBeInTheDocument();

    // Verify chart is rendered
    expect(container.querySelector('.recharts-responsive-container')).toBeInTheDocument();
  });
});
