"""DuckDB query interface for Holly Exit Optimizer."""

import duckdb
import pandas as pd

from config.settings import DUCKDB_PATH


def get_db() -> duckdb.DuckDBPyConnection:
    """Get a DuckDB connection, creating the database file if needed."""
    DUCKDB_PATH.parent.mkdir(parents=True, exist_ok=True)
    return duckdb.connect(str(DUCKDB_PATH))


def ensure_schema(db: duckdb.DuckDBPyConnection) -> None:
    """Create tables and views if they don't exist."""

    db.execute("""
        CREATE TABLE IF NOT EXISTS trades (
            trade_id        INTEGER PRIMARY KEY,
            symbol          VARCHAR NOT NULL,
            strategy        VARCHAR NOT NULL,
            direction       VARCHAR NOT NULL,
            entry_time      TIMESTAMP NOT NULL,
            entry_price     DOUBLE NOT NULL,
            exit_time       TIMESTAMP,
            exit_price      DOUBLE,
            stop_price      DOUBLE,
            target_price    DOUBLE,
            mfe             DOUBLE,
            mae             DOUBLE,
            shares          INTEGER,
            holly_pnl       DOUBLE,
            stop_buffer_pct DOUBLE,
            real_entry_price DOUBLE,
            real_entry_time  TIMESTAMP,
            real_commission  DOUBLE
        )
    """)

    db.execute("""
        CREATE TABLE IF NOT EXISTS bars (
            symbol     VARCHAR NOT NULL,
            bar_time   TIMESTAMP NOT NULL,
            open       DOUBLE,
            high       DOUBLE,
            low        DOUBLE,
            close      DOUBLE,
            volume     BIGINT,
            vwap       DOUBLE,
            num_trades INTEGER,
            PRIMARY KEY (symbol, bar_time)
        )
    """)

    db.execute("""
        CREATE TABLE IF NOT EXISTS optimization_results (
            run_id          INTEGER PRIMARY KEY,
            run_timestamp   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            strategy_filter VARCHAR,
            exit_rule       VARCHAR NOT NULL,
            param_json      VARCHAR NOT NULL,
            total_trades    INTEGER,
            win_rate        DOUBLE,
            avg_pnl         DOUBLE,
            total_pnl       DOUBLE,
            max_drawdown    DOUBLE,
            profit_factor   DOUBLE,
            sharpe          DOUBLE,
            avg_hold_mins   DOUBLE
        )
    """)

    db.execute("""
        CREATE TABLE IF NOT EXISTS optimal_params (
            strategy    VARCHAR PRIMARY KEY,
            exit_rule   VARCHAR NOT NULL,
            params      VARCHAR NOT NULL,
            win_rate    DOUBLE,
            avg_pnl     DOUBLE,
            total_pnl   DOUBLE,
            profit_factor DOUBLE,
            validated   BOOLEAN DEFAULT FALSE,
            validated_at TIMESTAMP
        )
    """)

    db.execute("""
        CREATE OR REPLACE VIEW trade_summary AS
        SELECT
            strategy,
            direction,
            COUNT(*)                                                    AS trade_count,
            AVG(holly_pnl)                                              AS avg_pnl,
            SUM(holly_pnl)                                              AS total_pnl,
            COUNT(CASE WHEN holly_pnl > 0 THEN 1 END)::DOUBLE / COUNT(*) AS win_rate,
            AVG(mfe)                                                    AS avg_mfe,
            AVG(mae)                                                    AS avg_mae,
            AVG(stop_buffer_pct)                                        AS avg_stop_buffer
        FROM trades
        GROUP BY strategy, direction
        ORDER BY total_pnl DESC
    """)


def load_trades(db: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    """Load all trades as a DataFrame."""
    return db.execute("SELECT * FROM trades ORDER BY entry_time").fetchdf()


def load_bars_for_symbol_date(
    db: duckdb.DuckDBPyConnection, symbol: str, date_str: str
) -> pd.DataFrame:
    """Load 1-min bars for a specific symbol and date."""
    return db.execute(
        """
        SELECT * FROM bars
        WHERE symbol = ? AND CAST(bar_time AS DATE) = CAST(? AS DATE)
        ORDER BY bar_time
        """,
        [symbol, date_str],
    ).fetchdf()


def get_trade_summary(db: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    """Return the trade_summary view as a DataFrame."""
    return db.execute("SELECT * FROM trade_summary").fetchdf()
