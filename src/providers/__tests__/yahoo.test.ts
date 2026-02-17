import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock yahoo-finance2 module
vi.mock("yahoo-finance2", () => {
  // Create shared mock functions inside the factory
  const mockQuote = vi.fn();
  const mockChart = vi.fn();
  const mockOptions = vi.fn();
  const mockQuoteSummary = vi.fn();
  const mockSearch = vi.fn();
  const mockScreener = vi.fn();
  const mockTrendingSymbols = vi.fn();
  
  return {
    default: class MockYahooFinance {
      quote: any;
      chart: any;
      options: any;
      quoteSummary: any;
      search: any;
      screener: any;
      trendingSymbols: any;
      
      constructor() {
        this.quote = mockQuote;
        this.chart = mockChart;
        this.options = mockOptions;
        this.quoteSummary = mockQuoteSummary;
        this.search = mockSearch;
        this.screener = mockScreener;
        this.trendingSymbols = mockTrendingSymbols;
      }
    },
  };
});

import {
  getQuote,
  getHistoricalBars,
  getOptionsChain,
  searchSymbols,
  getStockDetails,
  type QuoteData,
  type BarData,
  type OptionsChainData,
  type SearchResult,
  type StockDetails,
} from "../yahoo.js";

// Import the mocked module to get access to the instance
import YahooFinance from "yahoo-finance2";

describe("Yahoo Finance Provider", () => {
  let mockYF: any;
  
  beforeEach(() => {
    // Create a new instance to get access to the mocked methods
    mockYF = new YahooFinance();
    vi.clearAllMocks();
  });

  describe("getQuote", () => {
    it("should return quote data for valid symbol", async () => {
      const mockQuoteResponse = {
        symbol: "AAPL",
        bid: 150.25,
        ask: 150.30,
        regularMarketPrice: 150.27,
        regularMarketOpen: 149.50,
        regularMarketDayHigh: 151.00,
        regularMarketDayLow: 149.00,
        regularMarketPreviousClose: 149.75,
        regularMarketVolume: 50000000,
        regularMarketChange: 0.52,
        regularMarketChangePercent: 0.35,
        marketCap: 2500000000000,
      };

      mockYF.quote.mockResolvedValue(mockQuoteResponse);

      const result = await getQuote("AAPL");

      expect(result).toMatchObject({
        symbol: "AAPL",
        bid: 150.25,
        ask: 150.30,
        last: 150.27,
        open: 149.50,
        high: 151.00,
        low: 149.00,
        close: 149.75,
        volume: 50000000,
        change: 0.52,
        changePercent: 0.35,
        marketCap: 2500000000000,
      });
      expect(result.timestamp).toBeDefined();
      expect(mockYF.quote).toHaveBeenCalledWith("AAPL");
    });

    it("should handle null/missing values in quote response", async () => {
      const mockQuoteResponse = {
        symbol: "TEST",
        regularMarketPrice: 10.50,
        // Missing bid, ask, volume, etc.
      };

      mockYF.quote.mockResolvedValue(mockQuoteResponse);

      const result = await getQuote("TEST");

      expect(result).toMatchObject({
        symbol: "TEST",
        bid: null,
        ask: null,
        last: 10.50,
        open: null,
        high: null,
        low: null,
        close: null,
        volume: null,
        change: null,
        changePercent: null,
        marketCap: null,
      });
    });

    it("should throw error for invalid symbol", async () => {
      mockYF.quote.mockRejectedValue(new Error("Not Found"));

      await expect(getQuote("INVALID")).rejects.toThrow("Not Found");
    });

    it("should retry on transient errors", async () => {
      let attempts = 0;
      mockYF.quote.mockImplementation(async () => {
        attempts++;
        if (attempts < 2) {
          throw new Error("Network error");
        }
        return {
          symbol: "AAPL",
          regularMarketPrice: 150.00,
        };
      });

      const result = await getQuote("AAPL");
      expect(result.last).toBe(150.00);
      expect(attempts).toBe(2);
    });

    it("should not retry on client errors", async () => {
      let attempts = 0;
      mockYF.quote.mockImplementation(async () => {
        attempts++;
        throw new Error("Invalid symbol");
      });

      await expect(getQuote("INVALID")).rejects.toThrow("Invalid");
      expect(attempts).toBe(1);
    });
  });

  describe("getHistoricalBars", () => {
    it("should return historical bars for valid symbol", async () => {
      const mockChartResponse = {
        quotes: [
          {
            date: new Date("2024-01-01T00:00:00Z"),
            open: 100,
            high: 105,
            low: 99,
            close: 103,
            volume: 1000000,
          },
          {
            date: new Date("2024-01-02T00:00:00Z"),
            open: 103,
            high: 106,
            low: 102,
            close: 105,
            volume: 1200000,
          },
        ],
      };

      mockYF.chart.mockResolvedValue(mockChartResponse);

      const result = await getHistoricalBars("AAPL", "1mo", "1d");

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        open: 100,
        high: 105,
        low: 99,
        close: 103,
        volume: 1000000,
      });
      expect(result[0].time).toContain("2024-01-01");
      expect(result[1].close).toBe(105);
    });

    it("should return empty array when no quotes available", async () => {
      mockYF.chart.mockResolvedValue({ quotes: [] });

      const result = await getHistoricalBars("AAPL");

      expect(result).toEqual([]);
    });

    it("should handle missing quotes field", async () => {
      mockYF.chart.mockResolvedValue({});

      const result = await getHistoricalBars("AAPL");

      expect(result).toEqual([]);
    });

    it("should handle null/missing OHLCV values", async () => {
      const mockChartResponse = {
        quotes: [
          {
            date: new Date("2024-01-01T00:00:00Z"),
            open: null,
            high: 105,
            close: null,
            volume: null,
          },
        ],
      };

      mockYF.chart.mockResolvedValue(mockChartResponse);

      const result = await getHistoricalBars("AAPL");

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        open: 0,
        high: 105,
        low: 0,
        close: 0,
        volume: 0,
      });
    });

    it("should accept different period values", async () => {
      mockYF.chart.mockResolvedValue({ quotes: [] });

      await getHistoricalBars("AAPL", "1d");
      await getHistoricalBars("AAPL", "5d");
      await getHistoricalBars("AAPL", "1mo");
      await getHistoricalBars("AAPL", "3mo");
      await getHistoricalBars("AAPL", "6mo");
      await getHistoricalBars("AAPL", "1y");
      await getHistoricalBars("AAPL", "ytd");
      await getHistoricalBars("AAPL", "max");

      expect(mockYF.chart).toHaveBeenCalledTimes(8);
    });

    it("should accept different interval values", async () => {
      mockYF.chart.mockResolvedValue({ quotes: [] });

      await getHistoricalBars("AAPL", "1d", "1m");
      await getHistoricalBars("AAPL", "1d", "5m");
      await getHistoricalBars("AAPL", "1d", "1h");
      await getHistoricalBars("AAPL", "1mo", "1d");

      expect(mockYF.chart).toHaveBeenCalledTimes(4);
    });

    it("should default to 1d interval for invalid interval", async () => {
      mockYF.chart.mockResolvedValue({ quotes: [] });

      await getHistoricalBars("AAPL", "1mo", "invalid");

      const callArgs = mockYF.chart.mock.calls[0];
      expect(callArgs[1].interval).toBe("1d");
    });

    it("should throw error for invalid symbol", async () => {
      mockYF.chart.mockRejectedValue(new Error("Not Found"));

      await expect(getHistoricalBars("INVALID")).rejects.toThrow("Not Found");
    });
  });

  describe("getOptionsChain", () => {
    it("should return options chain for valid symbol", async () => {
      const mockOptionsResponse = {
        expirationDates: [
          new Date("2024-03-15T00:00:00Z"),
          new Date("2024-06-21T00:00:00Z"),
        ],
        strikes: [140, 145, 150, 155, 160],
        options: [
          {
            calls: [
              {
                contractSymbol: "AAPL240315C00150000",
                strike: 150,
                expiration: new Date("2024-03-15T00:00:00Z"),
                lastPrice: 5.25,
                bid: 5.20,
                ask: 5.30,
                volume: 1000,
                openInterest: 5000,
                impliedVolatility: 0.25,
                inTheMoney: true,
              },
            ],
            puts: [
              {
                contractSymbol: "AAPL240315P00150000",
                strike: 150,
                expiration: new Date("2024-03-15T00:00:00Z"),
                lastPrice: 2.15,
                bid: 2.10,
                ask: 2.20,
                volume: 800,
                openInterest: 3000,
                impliedVolatility: 0.22,
                inTheMoney: false,
              },
            ],
          },
        ],
      };

      mockYF.options.mockResolvedValue(mockOptionsResponse);

      const result = await getOptionsChain("AAPL");

      expect(result.symbol).toBe("AAPL");
      expect(result.expirations).toHaveLength(2);
      expect(result.strikes).toEqual([140, 145, 150, 155, 160]);
      expect(result.calls).toHaveLength(1);
      expect(result.calls[0]).toMatchObject({
        contractSymbol: "AAPL240315C00150000",
        strike: 150,
        type: "C",
        lastPrice: 5.25,
        bid: 5.20,
        ask: 5.30,
        volume: 1000,
        openInterest: 5000,
        impliedVolatility: 0.25,
        inTheMoney: true,
      });
      expect(result.puts).toHaveLength(1);
      expect(result.puts[0].type).toBe("P");
    });

    it("should return empty arrays when no options data available", async () => {
      mockYF.options.mockResolvedValue({
        expirationDates: [],
        strikes: [],
        options: [],
      });

      const result = await getOptionsChain("AAPL");

      expect(result.expirations).toEqual([]);
      expect(result.strikes).toEqual([]);
      expect(result.calls).toEqual([]);
      expect(result.puts).toEqual([]);
    });

    it("should handle missing options field", async () => {
      mockYF.options.mockResolvedValue({
        expirationDates: [new Date("2024-03-15T00:00:00Z")],
        strikes: [150],
      });

      const result = await getOptionsChain("AAPL");

      expect(result.calls).toEqual([]);
      expect(result.puts).toEqual([]);
    });

    it("should handle null/missing option contract values", async () => {
      const mockOptionsResponse = {
        expirationDates: [],
        strikes: [],
        options: [
          {
            calls: [
              {
                contractSymbol: null,
                strike: null,
                lastPrice: null,
                volume: null,
              },
            ],
            puts: [],
          },
        ],
      };

      mockYF.options.mockResolvedValue(mockOptionsResponse);

      const result = await getOptionsChain("AAPL");

      expect(result.calls).toHaveLength(1);
      expect(result.calls[0]).toMatchObject({
        contractSymbol: "",
        strike: 0,
        lastPrice: null,
        volume: null,
      });
    });

    it("should accept expiration parameter", async () => {
      mockYF.options.mockResolvedValue({
        expirationDates: [],
        strikes: [],
        options: [],
      });

      await getOptionsChain("AAPL", "20240315");

      expect(mockYF.options).toHaveBeenCalledWith("AAPL", {
        date: expect.any(Date),
      });
    });

    it("should throw error for invalid symbol", async () => {
      mockYF.options.mockRejectedValue(new Error("Not Found"));

      await expect(getOptionsChain("INVALID")).rejects.toThrow("Not Found");
    });
  });

  describe("searchSymbols", () => {
    it("should return search results for valid query", async () => {
      const mockSearchResponse = {
        quotes: [
          {
            symbol: "AAPL",
            shortname: "Apple Inc.",
            longname: "Apple Inc.",
            exchDisp: "NASDAQ",
            typeDisp: "Equity",
            sectorDisp: "Technology",
            industryDisp: "Consumer Electronics",
          },
          {
            symbol: "AAPLW",
            shortname: "Apple Warrants",
            longname: "Apple Inc. Warrants",
            exchange: "NASDAQ",
            quoteType: "WARRANT",
            sector: "Technology",
            industry: "Consumer Electronics",
          },
        ],
      };

      mockYF.search.mockResolvedValue(mockSearchResponse);

      const result = await searchSymbols("apple");

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        symbol: "AAPL",
        shortName: "Apple Inc.",
        longName: "Apple Inc.",
        exchange: "NASDAQ",
        quoteType: "Equity",
        sector: "Technology",
        industry: "Consumer Electronics",
      });
      expect(result[1].symbol).toBe("AAPLW");
      expect(mockYF.search).toHaveBeenCalledWith("apple");
    });

    it("should return empty array when no results found", async () => {
      mockYF.search.mockResolvedValue({ quotes: [] });

      const result = await searchSymbols("zzznonexistent");

      expect(result).toEqual([]);
    });

    it("should handle missing quotes field", async () => {
      mockYF.search.mockResolvedValue({});

      const result = await searchSymbols("test");

      expect(result).toEqual([]);
    });

    it("should handle null/missing values in search results", async () => {
      const mockSearchResponse = {
        quotes: [
          {
            symbol: "TEST",
            shortname: null,
            longname: null,
            exchDisp: null,
            exchange: null,
          },
        ],
      };

      mockYF.search.mockResolvedValue(mockSearchResponse);

      const result = await searchSymbols("test");

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        symbol: "TEST",
        shortName: null,
        longName: null,
        exchange: null,
        quoteType: null,
        sector: null,
        industry: null,
      });
    });

    it("should throw error on search failure", async () => {
      mockYF.search.mockRejectedValue(new Error("Search failed"));

      await expect(searchSymbols("test")).rejects.toThrow("Search failed");
    });
  });

  describe("getStockDetails", () => {
    it("should return stock details for valid symbol", async () => {
      const mockQuoteSummaryResponse = {
        assetProfile: {
          sector: "Technology",
          industry: "Consumer Electronics",
          website: "https://www.apple.com",
          longBusinessSummary: "Apple designs and manufactures consumer electronics.",
          fullTimeEmployees: 164000,
        },
        summaryDetail: {
          dividendYield: 0.0052,
        },
      };

      const mockQuoteResponse = {
        symbol: "AAPL",
        longName: "Apple Inc.",
        shortName: "Apple",
        fullExchangeName: "NASDAQ",
        currency: "USD",
        quoteType: "EQUITY",
        marketCap: 2800000000000,
        trailingPE: 28.5,
        forwardPE: 25.3,
        fiftyTwoWeekHigh: 198.23,
        fiftyTwoWeekLow: 124.17,
      };

      mockYF.quoteSummary.mockResolvedValue(mockQuoteSummaryResponse);
      mockYF.quote.mockResolvedValue(mockQuoteResponse);

      const result = await getStockDetails("AAPL");

      expect(result).toMatchObject({
        symbol: "AAPL",
        longName: "Apple Inc.",
        shortName: "Apple",
        exchange: "NASDAQ",
        currency: "USD",
        quoteType: "EQUITY",
        sector: "Technology",
        industry: "Consumer Electronics",
        website: "https://www.apple.com",
        longBusinessSummary: "Apple designs and manufactures consumer electronics.",
        fullTimeEmployees: 164000,
        marketCap: 2800000000000,
        trailingPE: 28.5,
        forwardPE: 25.3,
        dividendYield: 0.0052,
        fiftyTwoWeekHigh: 198.23,
        fiftyTwoWeekLow: 124.17,
      });
    });

    it("should handle null/missing values in stock details", async () => {
      const mockQuoteSummaryResponse = {
        assetProfile: {
          sector: null,
          industry: null,
        },
        summaryDetail: {},
      };

      const mockQuoteResponse = {
        symbol: "TEST",
        longName: "Test Company",
      };

      mockYF.quoteSummary.mockResolvedValue(mockQuoteSummaryResponse);
      mockYF.quote.mockResolvedValue(mockQuoteResponse);

      const result = await getStockDetails("TEST");

      expect(result).toMatchObject({
        symbol: "TEST",
        longName: "Test Company",
        shortName: null,
        exchange: null,
        currency: null,
        quoteType: null,
        sector: null,
        industry: null,
        website: null,
        longBusinessSummary: null,
        fullTimeEmployees: null,
        marketCap: null,
        trailingPE: null,
        forwardPE: null,
        dividendYield: null,
        fiftyTwoWeekHigh: null,
        fiftyTwoWeekLow: null,
      });
    });

    it("should handle missing assetProfile field", async () => {
      const mockQuoteSummaryResponse = {
        summaryDetail: {
          dividendYield: 0.02,
        },
      };

      const mockQuoteResponse = {
        symbol: "TEST",
        longName: "Test Company",
      };

      mockYF.quoteSummary.mockResolvedValue(mockQuoteSummaryResponse);
      mockYF.quote.mockResolvedValue(mockQuoteResponse);

      const result = await getStockDetails("TEST");

      expect(result.sector).toBeNull();
      expect(result.industry).toBeNull();
      expect(result.website).toBeNull();
      expect(result.dividendYield).toBe(0.02);
    });

    it("should handle missing summaryDetail field", async () => {
      const mockQuoteSummaryResponse = {
        assetProfile: {
          sector: "Technology",
        },
      };

      const mockQuoteResponse = {
        symbol: "TEST",
        longName: "Test Company",
      };

      mockYF.quoteSummary.mockResolvedValue(mockQuoteSummaryResponse);
      mockYF.quote.mockResolvedValue(mockQuoteResponse);

      const result = await getStockDetails("TEST");

      expect(result.sector).toBe("Technology");
      expect(result.dividendYield).toBeNull();
    });

    it("should throw error for invalid symbol", async () => {
      mockYF.quoteSummary.mockRejectedValue(new Error("Not Found"));

      await expect(getStockDetails("INVALID")).rejects.toThrow("Not Found");
    });

    it("should use exchange field when fullExchangeName is missing", async () => {
      const mockQuoteSummaryResponse = {
        assetProfile: {},
        summaryDetail: {},
      };

      const mockQuoteResponse = {
        symbol: "TEST",
        exchange: "NASDAQ",
        // fullExchangeName missing
      };

      mockYF.quoteSummary.mockResolvedValue(mockQuoteSummaryResponse);
      mockYF.quote.mockResolvedValue(mockQuoteResponse);

      const result = await getStockDetails("TEST");

      expect(result.exchange).toBe("NASDAQ");
    });
  });

  describe("Error Handling", () => {
    it("should not retry on 'Not Found' errors", async () => {
      let attempts = 0;
      mockYF.quote.mockImplementation(async () => {
        attempts++;
        throw new Error("Not Found");
      });

      await expect(getQuote("NOTFOUND")).rejects.toThrow("Not Found");
      expect(attempts).toBe(1);
    });

    it("should not retry on 'Invalid' errors", async () => {
      let attempts = 0;
      mockYF.quote.mockImplementation(async () => {
        attempts++;
        throw new Error("Invalid parameter");
      });

      await expect(getQuote("INVALID")).rejects.toThrow("Invalid");
      expect(attempts).toBe(1);
    });

    it("should not retry on 'no data' errors", async () => {
      let attempts = 0;
      mockYF.quote.mockImplementation(async () => {
        attempts++;
        throw new Error("no data available");
      });

      await expect(getQuote("NODATA")).rejects.toThrow("no data");
      expect(attempts).toBe(1);
    });

    it("should retry up to MAX_RETRIES on transient errors", async () => {
      let attempts = 0;
      mockYF.quote.mockImplementation(async () => {
        attempts++;
        throw new Error("Temporary failure");
      });

      await expect(getQuote("TEST")).rejects.toThrow("Temporary failure");
      // Initial attempt + 2 retries = 3 total attempts
      expect(attempts).toBe(3);
    });

    it("should succeed after retries if error resolves", async () => {
      let attempts = 0;
      mockYF.quote.mockImplementation(async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error("Temporary failure");
        }
        return {
          symbol: "AAPL",
          regularMarketPrice: 150.00,
        };
      });

      const result = await getQuote("AAPL");
      expect(result.last).toBe(150.00);
      expect(attempts).toBe(3);
    });
  });

  describe("Rate Limiting", () => {
    it("should call yahoo-finance2 functions without errors", async () => {
      mockYF.quote.mockResolvedValue({
        symbol: "AAPL",
        regularMarketPrice: 150.00,
      });

      // Make multiple rapid calls
      await getQuote("AAPL");
      await getQuote("AAPL");
      await getQuote("AAPL");

      expect(mockYF.quote).toHaveBeenCalledTimes(3);
    });

    it("should handle different symbols in rapid succession", async () => {
      mockYF.quote.mockImplementation(async (symbol: string) => ({
        symbol,
        regularMarketPrice: 100.00,
      }));

      await Promise.all([
        getQuote("AAPL"),
        getQuote("GOOGL"),
        getQuote("MSFT"),
      ]);

      expect(mockYF.quote).toHaveBeenCalledTimes(3);
    });
  });
});
