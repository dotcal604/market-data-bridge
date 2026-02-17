import pandas as pd
import numpy as np
import sys
import argparse
from typing import Dict, Any

class VectorizedBacktester:
    """
    High-Performance Vectorized Backtesting Engine.
    Uses numpy broadcasting for zero-loop execution simulation.
    """

    def __init__(self, 
                 initial_capital: float = 100000.0,
                 commission_per_share: float = 0.0035, # IBKR Tiered
                 slippage_bps: float = 1.0):           # 1 basis point
        self.initial_capital = initial_capital
        self.commission = commission_per_share
        self.slippage_pct = slippage_bps / 10000.0

    def run(self, df: pd.DataFrame, signals: pd.Series) -> Dict[str, Any]:
        """
        Executes the backtest.
        
        Args:
            df: DataFrame with 'open', 'high', 'low', 'close', 'volume'
            signals: Series of {-1, 0, 1} aligned with df index.
                     1 = Long, -1 = Short, 0 = Flat
                     Signal at t is executed at Open of t+1 (or Close of t if immediate).
                     Here we assume execution at Close of t for simplicity in vectorization, 
                     or we shift returns.
                     Standard practice: Signal t uses Close t, enters at Open t+1.
        """
        # Ensure alignment
        data = df.copy()
        data['signal'] = signals
        
        # Calculate Log Returns
        # Strategy Return = Signal(t-1) * Return(t)
        # We shift signal by 1 to align "decision at close t" with "return at t+1"
        data['log_ret'] = np.log(data['close'] / data['close'].shift(1))
        data['strat_ret'] = data['signal'].shift(1) * data['log_ret']
        
        # Apply Transaction Costs
        # Trade occurs when signal changes: |signal_t - signal_{t-1}|
        # If signal changes from 0 to 1 -> 1 trade
        # From 1 to -1 -> 2 trades (Sell 1, Sell 1 more) -> Actually handled as position flip
        data['trades'] = data['signal'].diff().abs().fillna(0)
        
        # Cost = Trades * (Commission + Slippage)
        # Slippage is approx proportional to price volatility, but fixed bps is standard approx
        # Commission is per share. We need to estimate share count.
        # Approx shares = Equity / Price
        # This breaks pure vectorization if Equity is dynamic.
        # Solution: Calculate returns in % first, then deduct cost in %
        
        # Cost in % approx = (Commission / Price) + Slippage
        # We use a simplified avg price for the whole period or rolling avg for better acc?
        # Vectorized approach: Use current price for cost estimate
        cost_pct = (self.commission / data['close']) + self.slippage_pct
        data['cost'] = data['trades'] * cost_pct
        
        # Net Strategy Return
        data['net_ret'] = data['strat_ret'] - data['cost']
        
        # Equity Curve
        # Cumulative Sum of Log Returns = Log(Total Return)
        data['equity_curve'] = self.initial_capital * np.exp(data['net_ret'].cumsum())
        
        return self.calculate_metrics(data)

    def calculate_metrics(self, data: pd.DataFrame) -> Dict[str, Any]:
        """
        Computes Sharpe, Sortino, Max Drawdown, etc.
        """
        # Drop NaN from shift/diff
        clean_ret = data['net_ret'].dropna()
        if len(clean_ret) == 0:
            return {}

        # Annualization Factor (assuming intraday 1-min bars? or daily?)
        # If daily: 252. If 1-min: 252 * 390
        # Let's infer from index
        if isinstance(data.index, pd.DatetimeIndex):
            # Estimate frequency
            timediffs = data.index.to_series().diff().dropna()
            median_diff = timediffs.median()
            
            if median_diff < pd.Timedelta(minutes=5):
                ann_factor = 252 * 390 # 1 min
            elif median_diff < pd.Timedelta(hours=1):
                ann_factor = 252 * 13  # 30 min?
            else:
                ann_factor = 252       # Daily
        else:
            ann_factor = 252 # Default to daily if no datetime index
            
        # 1. Total Return
        total_ret = (data['equity_curve'].iloc[-1] / self.initial_capital) - 1
        
        # 2. Sharpe Ratio
        # R_f assumed 0 for intraday
        mean_ret = clean_ret.mean()
        std_ret = clean_ret.std()
        sharpe = (mean_ret / std_ret) * np.sqrt(ann_factor) if std_ret > 0 else 0
        
        # 3. Sortino Ratio (Downside Deviation)
        downside_ret = clean_ret[clean_ret < 0]
        std_down = downside_ret.std()
        sortino = (mean_ret / std_down) * np.sqrt(ann_factor) if std_down > 0 else 0
        
        # 4. Maximum Drawdown
        # cummax = running max of equity
        roll_max = data['equity_curve'].cummax()
        drawdown = (data['equity_curve'] - roll_max) / roll_max
        max_dd = drawdown.min()
        
        # 5. Win Rate
        # A "trade" is hard to define in vector (continuous signal).
        # We define a "winning period" (bar)
        win_rate = (clean_ret > 0).mean()

        return {
            "Total Return": f"{total_ret*100:.2f}%",
            "Sharpe Ratio": f"{sharpe:.2f}",
            "Sortino Ratio": f"{sortino:.2f}",
            "Max Drawdown": f"{max_dd*100:.2f}%",
            "Win Rate (Bars)": f"{win_rate*100:.2f}%",
            "Equity Final": f"${data['equity_curve'].iloc[-1]:.2f}"
        }

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument('csv_path', type=str)
    args = parser.parse_args()

    # Load Data
    df = pd.read_csv(args.csv_path)
    if 'timestamp' in df.columns:
        df['timestamp'] = pd.to_datetime(df['timestamp'])
        df.set_index('timestamp', inplace=True)
    
    # Generate Dummy Signals for Demo (Replace with Bayesian/HMM Output)
    # Simple Moving Average Crossover
    df['sma_fast'] = df['close'].rolling(20).mean()
    df['sma_slow'] = df['close'].rolling(50).mean()
    
    # Signal: 1 if Fast > Slow, -1 if Fast < Slow
    signals = np.where(df['sma_fast'] > df['sma_slow'], 1, -1)
    signals = pd.Series(signals, index=df.index)
    
    bt = VectorizedBacktester()
    results = bt.run(df, signals)
    
    print("-" * 30)
    print("BACKTEST RESULTS")
    print("-" * 30)
    for k, v in results.items():
        print(f"{k}: {v}")
    print("-" * 30)
