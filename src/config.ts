import dotenv from "dotenv";
dotenv.config();

// IBKR config is optional — only needed when TWS/Gateway is running for account data.
// Market data comes from Yahoo Finance and works without IBKR.
export const config = {
  ibkr: {
    host: process.env.IBKR_HOST ?? "127.0.0.1",
    port: parseInt(process.env.IBKR_PORT ?? "7496", 10),
    clientId: parseInt(process.env.IBKR_CLIENT_ID ?? "0", 10),
    maxClientIdRetries: 5,
  },
  rest: {
    port: parseInt(process.env.REST_PORT ?? "3000", 10),
    apiKey: process.env.REST_API_KEY ?? "",
  },
};
