"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useNews } from "@/lib/hooks/use-market";
import { ExternalLink, Newspaper } from "lucide-react";

interface NewsFeedProps {
  symbol: string | null;
}

function formatTimeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);

  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

export function NewsFeed({ symbol }: NewsFeedProps) {
  const { data, isLoading, error } = useNews(symbol);

  if (!symbol) {
    return null;
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Newspaper className="h-5 w-5" />
            News Feed
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-[300px] items-center justify-center">
            <p className="text-sm text-muted-foreground">
              Failed to load news: {error.message}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Newspaper className="h-5 w-5" />
            News Feed
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data || data.articles.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Newspaper className="h-5 w-5" />
            News Feed
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-[300px] items-center justify-center">
            <p className="text-sm text-muted-foreground">No news articles available</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Limit to 10 most recent articles
  const articles = data.articles.slice(0, 10);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Newspaper className="h-5 w-5" />
          News Feed
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {data.count} {data.count === 1 ? "article" : "articles"} found for {symbol}
        </p>
      </CardHeader>
      <CardContent>
        <div className="space-y-4 max-h-[500px] overflow-y-auto">
          {articles.map((article, idx) => (
            <a
              key={idx}
              href={article.link}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-lg border border-border bg-card p-4 transition-colors hover:bg-muted/50"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <h4 className="font-medium leading-tight text-foreground hover:text-primary">
                    {article.title}
                  </h4>
                  <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                    {article.publisher && (
                      <>
                        <span>{article.publisher}</span>
                        <span>•</span>
                      </>
                    )}
                    <span>{formatTimeAgo(article.publishedAt)}</span>
                  </div>
                  {article.relatedTickers.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {article.relatedTickers.slice(0, 5).map((ticker) => (
                        <span
                          key={ticker}
                          className="rounded bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground"
                        >
                          {ticker}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <ExternalLink className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
              </div>
            </a>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
