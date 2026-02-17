import numpy as np
import pandas as pd
from hmmlearn.hmm import GaussianHMM
import joblib
import sys
import logging

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class MarketRegimeHMM:
    """
    Implements a 3-State Gaussian Hidden Markov Model for market regime detection.
    States:
    0: Low Volatility / Mean Reversion (The "Chop")
    1: High Volatility / Trending (The "Move")
    2: Extreme Volatility / Tail Risk (The "Crash/Melt-up")
    """
    
    def __init__(self, n_components=3, covariance_type="full", n_iter=1000):
        self.model = GaussianHMM(
            n_components=n_components, 
            covariance_type=covariance_type, 
            n_iter=n_iter,
            random_state=42
        )
        self.is_fitted = False

    def prepare_features(self, df: pd.DataFrame) -> np.ndarray:
        """
        Feature Engineering for HMM.
        We use Log Returns and Range Volatility as the primary observations.
        """
        df = df.copy()
        
        # 1. Log Returns
        df['log_ret'] = np.log(df['close'] / df['close'].shift(1))
        
        # 2. Parkinson Volatility (High-Low range based)
        # Using a rolling window to smooth it slightly
        window = 10
        df['parkinson_vol'] = np.sqrt(
            (1.0 / (4.0 * np.log(2.0))) * np.log(df['high'] / df['low'])**2
        ).rolling(window=window).mean()

        # Drop NaN
        df.dropna(inplace=True)

        # Standardization (Z-Score)
        # Critical for HMM convergence
        X = df[['log_ret', 'parkinson_vol']].values
        self.scaler_mean = X.mean(axis=0)
        self.scaler_std = X.std(axis=0)
        X_scaled = (X - self.scaler_mean) / self.scaler_std
        
        return X_scaled

    def fit(self, df: pd.DataFrame):
        logger.info("Preparing features...")
        X = self.prepare_features(df)
        
        logger.info(f"Fitting GaussianHMM with {self.model.n_components} states on {len(X)} samples...")
        self.model.fit(X)
        self.is_fitted = True
        
        logger.info("Model converged.")
        self.describe_states(X)

    def describe_states(self, X):
        """
        Analyze the hidden states to map them to semantic regimes.
        We sort states by volatility (variance of returns).
        """
        means = self.model.means_
        covars = self.model.covars_
        
        # We assume the second feature (index 1) is Volatility
        volatility_means = means[:, 1]
        
        # Sort indices by volatility: Low -> High
        sorted_idx = np.argsort(volatility_means)
        
        state_map = {
            sorted_idx[0]: "Low Vol / Mean Reversion",
            sorted_idx[1]: "Medium Vol / Trending",
            sorted_idx[2]: "High Vol / Tail Risk"
        }
        
        logger.info("State Interpretation:")
        for i in range(self.model.n_components):
            logger.info(f"State {i}: {state_map.get(i, 'Unknown')}")
            logger.info(f"  Mean (Ret, Vol): {means[i]}")
            logger.info(f"  Variance (Diag): {np.diag(covars[i])}")

    def predict(self, df: pd.DataFrame) -> np.ndarray:
        if not self.is_fitted:
            raise ValueError("Model not fitted yet.")
            
        X = self.prepare_features(df)
        hidden_states = self.model.predict(X)
        return hidden_states

    def save(self, path: str):
        joblib.dump(self.model, path)
        logger.info(f"Model saved to {path}")

    def load(self, path: str):
        self.model = joblib.load(path)
        self.is_fitted = True
        logger.info(f"Model loaded from {path}")

if __name__ == "__main__":
    # Example Usage for CLI
    if len(sys.argv) < 2:
        print("Usage: python markov_regime_model.py <csv_path>")
        sys.exit(1)
        
    csv_path = sys.argv[1]
    
    try:
        df = pd.read_csv(csv_path)
        # Ensure columns exist
        required_cols = ['timestamp', 'open', 'high', 'low', 'close', 'volume']
        if not all(col in df.columns for col in required_cols):
            # Try to rename or fail
            df.columns = df.columns.str.lower()
        
        hmm = MarketRegimeHMM()
        hmm.fit(df)
        
        states = hmm.predict(df)
        df_clean = df.iloc[-len(states):].copy() # Align with dropped NaNs
        df_clean['regime'] = states
        
        print(df_clean[['timestamp', 'close', 'regime']].tail(20))
        
        hmm.save("hmm_model.pkl")
        
    except Exception as e:
        logger.error(f"Failed to run HMM pipeline: {e}")
        sys.exit(1)
