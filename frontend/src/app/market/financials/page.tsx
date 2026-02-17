"use client";

import { useState } from "react";
import { SymbolSearch } from "@/components/market/SymbolSearch";
import { useFinancials } from "@/lib/hooks/use-market";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, TrendingUp, DollarSign, Percent, Scale } from "lucide-react";
import { formatCurrency, formatPercent, formatPrice } from "@/lib/utils/formatters";

export default function FinancialsPage() {
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const { data: financials, isLoading, error } = useFinancials(selectedSymbol);

  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <div className="border-b border-border bg-background px-6 py-4">
        <div>
          <h1 className="text-2xl font-bold">Financial Data</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            View key financial metrics, margins, and ratios
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-7xl space-y-6">
          {/* Search Bar */}
          <SymbolSearch onSelect={setSelectedSymbol} />

          {/* Loading State */}
          {isLoading && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
                {[1, 2, 3, 4].map((i) => (
                  <Card key={i}>
                    <CardHeader>
                      <Skeleton className="h-4 w-24" />
                    </CardHeader>
                    <CardContent>
                      <Skeleton className="h-8 w-32" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Error State */}
          {error && (
            <Card className="border-red-400/50 bg-red-400/5">
              <CardContent className="flex items-center gap-3 py-6">
                <AlertCircle className="h-5 w-5 text-red-400" />
                <div>
                  <p className="font-semibold text-red-400">Failed to load financials</p>
                  <p className="text-sm text-muted-foreground">
                    {(error as Error).message || "An error occurred"}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Success State - Display Financials */}
          {!isLoading && !error && financials && (
            <>
              {/* Key Metrics Cards */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
                {/* Revenue Growth */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                      <TrendingUp className="h-4 w-4" />
                      Revenue Growth
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="font-mono text-2xl font-bold">
                      {financials.revenueGrowth != null
                        ? formatPercent(financials.revenueGrowth)
                        : "—"}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">YoY growth</p>
                  </CardContent>
                </Card>

                {/* Earnings Growth */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                      <DollarSign className="h-4 w-4" />
                      Earnings Growth
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="font-mono text-2xl font-bold">
                      {financials.earningsGrowth != null
                        ? formatPercent(financials.earningsGrowth)
                        : "—"}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">YoY growth</p>
                  </CardContent>
                </Card>

                {/* Profit Margin */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                      <Percent className="h-4 w-4" />
                      Profit Margin
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="font-mono text-2xl font-bold">
                      {financials.profitMargins != null
                        ? formatPercent(financials.profitMargins)
                        : "—"}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">Net margin</p>
                  </CardContent>
                </Card>

                {/* Debt to Equity */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                      <Scale className="h-4 w-4" />
                      Debt/Equity
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="font-mono text-2xl font-bold">
                      {financials.debtToEquity != null
                        ? financials.debtToEquity.toFixed(2)
                        : "—"}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">Leverage ratio</p>
                  </CardContent>
                </Card>
              </div>

              {/* Tabbed Financial Details */}
              <Tabs defaultValue="metrics" className="w-full">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="metrics">Key Metrics</TabsTrigger>
                  <TabsTrigger value="margins">Margins</TabsTrigger>
                  <TabsTrigger value="balance">Balance Sheet</TabsTrigger>
                </TabsList>

                {/* Key Metrics Tab */}
                <TabsContent value="metrics">
                  <Card>
                    <CardHeader>
                      <CardTitle>Key Financial Metrics</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Metric</TableHead>
                            <TableHead className="text-right">Value</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          <TableRow>
                            <TableCell className="font-medium">Current Price</TableCell>
                            <TableCell className="text-right font-mono">
                              {formatPrice(financials.currentPrice)}
                            </TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell className="font-medium">Target Mean Price</TableCell>
                            <TableCell className="text-right font-mono">
                              {formatPrice(financials.targetMeanPrice)}
                            </TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell className="font-medium">Target High</TableCell>
                            <TableCell className="text-right font-mono">
                              {formatPrice(financials.targetHighPrice)}
                            </TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell className="font-medium">Target Low</TableCell>
                            <TableCell className="text-right font-mono">
                              {formatPrice(financials.targetLowPrice)}
                            </TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell className="font-medium">Total Revenue</TableCell>
                            <TableCell className="text-right font-mono">
                              {formatCurrency(financials.totalRevenue)}
                            </TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell className="font-medium">Revenue Per Share</TableCell>
                            <TableCell className="text-right font-mono">
                              {formatPrice(financials.revenuePerShare)}
                            </TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell className="font-medium">Revenue Growth (YoY)</TableCell>
                            <TableCell className="text-right font-mono">
                              {financials.revenueGrowth != null
                                ? formatPercent(financials.revenueGrowth)
                                : "—"}
                            </TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell className="font-medium">Earnings Growth (YoY)</TableCell>
                            <TableCell className="text-right font-mono">
                              {financials.earningsGrowth != null
                                ? formatPercent(financials.earningsGrowth)
                                : "—"}
                            </TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell className="font-medium">Return on Equity</TableCell>
                            <TableCell className="text-right font-mono">
                              {financials.returnOnEquity != null
                                ? formatPercent(financials.returnOnEquity)
                                : "—"}
                            </TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell className="font-medium">Free Cash Flow</TableCell>
                            <TableCell className="text-right font-mono">
                              {formatCurrency(financials.freeCashflow)}
                            </TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell className="font-medium">Operating Cash Flow</TableCell>
                            <TableCell className="text-right font-mono">
                              {formatCurrency(financials.operatingCashflow)}
                            </TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Margins Tab */}
                <TabsContent value="margins">
                  <Card>
                    <CardHeader>
                      <CardTitle>Profit Margins</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Margin Type</TableHead>
                            <TableHead className="text-right">Percentage</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          <TableRow>
                            <TableCell className="font-medium">Gross Margin</TableCell>
                            <TableCell className="text-right font-mono">
                              {financials.grossMargins != null
                                ? formatPercent(financials.grossMargins)
                                : "—"}
                            </TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell className="font-medium">Operating Margin</TableCell>
                            <TableCell className="text-right font-mono">
                              {financials.operatingMargins != null
                                ? formatPercent(financials.operatingMargins)
                                : "—"}
                            </TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell className="font-medium">Profit Margin</TableCell>
                            <TableCell className="text-right font-mono">
                              {financials.profitMargins != null
                                ? formatPercent(financials.profitMargins)
                                : "—"}
                            </TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell className="font-medium">EBITDA Margin</TableCell>
                            <TableCell className="text-right font-mono">
                              {financials.ebitdaMargins != null
                                ? formatPercent(financials.ebitdaMargins)
                                : "—"}
                            </TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Balance Sheet Tab */}
                <TabsContent value="balance">
                  <Card>
                    <CardHeader>
                      <CardTitle>Balance Sheet</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Item</TableHead>
                            <TableHead className="text-right">Amount</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          <TableRow>
                            <TableCell className="font-medium">Total Cash</TableCell>
                            <TableCell className="text-right font-mono">
                              {formatCurrency(financials.totalCash)}
                            </TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell className="font-medium">Total Debt</TableCell>
                            <TableCell className="text-right font-mono">
                              {formatCurrency(financials.totalDebt)}
                            </TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell className="font-medium">Debt to Equity</TableCell>
                            <TableCell className="text-right font-mono">
                              {financials.debtToEquity != null
                                ? financials.debtToEquity.toFixed(2)
                                : "—"}
                            </TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>

              {/* Analyst Recommendations */}
              {(financials.recommendationKey || financials.numberOfAnalystOpinions != null) && (
                <Card>
                  <CardHeader>
                    <CardTitle>Analyst Recommendations</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableBody>
                        {financials.recommendationKey && (
                          <TableRow>
                            <TableCell className="font-medium">Recommendation</TableCell>
                            <TableCell className="text-right font-mono uppercase">
                              {financials.recommendationKey}
                            </TableCell>
                          </TableRow>
                        )}
                        {financials.recommendationMean != null && (
                          <TableRow>
                            <TableCell className="font-medium">Average Rating</TableCell>
                            <TableCell className="text-right font-mono">
                              {financials.recommendationMean.toFixed(2)}
                            </TableCell>
                          </TableRow>
                        )}
                        {financials.numberOfAnalystOpinions != null && (
                          <TableRow>
                            <TableCell className="font-medium">Number of Analysts</TableCell>
                            <TableCell className="text-right font-mono">
                              {financials.numberOfAnalystOpinions}
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}
            </>
          )}

          {/* Empty State */}
          {!selectedSymbol && !isLoading && (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <DollarSign className="h-12 w-12 text-muted-foreground/50" />
                <p className="mt-4 text-sm text-muted-foreground">
                  Search for a symbol to view financial data
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
