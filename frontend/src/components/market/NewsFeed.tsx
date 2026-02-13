"use client";

import { useState, useEffect } from "react";
import { ExternalLink, Newspaper } from "lucide-react";
import { Card } from "@/components/ui/card";
import { marketClient } from "@/lib/api/market-client";
import type { NewsItem } from "@/lib/api/types";

interface NewsFeedProps {
  symbol: string;
}

export function NewsFeed({ symbol }: NewsFeedProps) {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!symbol) {
      setNews([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    marketClient
      .getNews(symbol)
      .then((data) => {
        setNews(data.articles || []);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || "Failed to load news");
        setLoading(false);
      });
  }, [symbol]);

  if (loading) {
    return (
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <Newspaper className="h-5 w-5 text-blue-400" />
          <h2 className="text-lg font-semibold">Recent News</h2>
        </div>
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="animate-pulse">
              <div className="h-4 bg-muted rounded w-3/4 mb-2"></div>
              <div className="h-3 bg-muted rounded w-1/4"></div>
            </div>
          ))}
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <Newspaper className="h-5 w-5 text-blue-400" />
          <h2 className="text-lg font-semibold">Recent News</h2>
        </div>
        <div className="text-sm text-red-400">{error}</div>
      </Card>
    );
  }

  if (news.length === 0) {
    return (
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <Newspaper className="h-5 w-5 text-blue-400" />
          <h2 className="text-lg font-semibold">Recent News</h2>
        </div>
        <div className="text-sm text-muted-foreground">
          No recent news available for {symbol}
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <div className="flex items-center gap-2 mb-4">
        <Newspaper className="h-5 w-5 text-blue-400" />
        <h2 className="text-lg font-semibold">Recent News</h2>
        <span className="text-sm text-muted-foreground ml-auto">
          {news.length} articles
        </span>
      </div>

      <div className="space-y-4">
        {news.map((article, index) => (
          <div
            key={index}
            className="border-b border-border pb-3 last:border-b-0 last:pb-0"
          >
            <a
              href={article.link}
              target="_blank"
              rel="noopener noreferrer"
              className="group block"
            >
              <h3 className="text-sm font-medium text-foreground group-hover:text-blue-400 transition-colors mb-1">
                {article.title}
              </h3>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {article.publisher && (
                  <span className="font-medium">{article.publisher}</span>
                )}
                <span>•</span>
                <span>
                  {new Date(article.publishedAt).toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
                <ExternalLink className="h-3 w-3 ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </a>
          </div>
        ))}
      </div>
    </Card>
  );
}
