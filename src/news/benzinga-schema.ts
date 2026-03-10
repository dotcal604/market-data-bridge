import { z } from "zod";

// ── Massive v2 Benzinga News API Response Schemas ─────────────────────────

export const BenzingaPublisherSchema = z.object({
  name: z.string(),
  homepage_url: z.string().optional(),
  logo_url: z.string().optional(),
});

export const BenzingaArticleSchema = z.object({
  id: z.string(),
  publisher: BenzingaPublisherSchema.optional(),
  title: z.string(),
  author: z.string().optional().nullable(),
  published_utc: z.string(),
  article_url: z.string().optional().nullable(),
  tickers: z.array(z.string()),
  channels: z.array(z.string()).optional().nullable(),
  tags: z.array(z.string()).optional().nullable(),
  keywords: z.array(z.string()).optional().nullable(),
  description: z.string().optional().nullable(),
  image_url: z.string().optional().nullable(),
});

export const BenzingaResponseSchema = z.object({
  results: z.array(BenzingaArticleSchema),
  next_url: z.string().optional().nullable(),
  count: z.number().optional(),
  status: z.string().optional(),
});

export type BenzingaArticle = z.infer<typeof BenzingaArticleSchema>;
export type BenzingaResponse = z.infer<typeof BenzingaResponseSchema>;
export type BenzingaPublisher = z.infer<typeof BenzingaPublisherSchema>;
