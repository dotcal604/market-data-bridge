"use client"

import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  CartesianGrid,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

interface ScoreScatterProps {
  data: Array<{
    id: string
    symbol: string
    trade_score: number
    r_multiple: number
    should_trade: boolean
  }>
}

interface CustomTooltipProps {
  active?: boolean
  payload?: Array<{
    payload: {
      symbol: string
      trade_score: number
      r_multiple: number
      should_trade: boolean
    }
  }>
}

function CustomTooltip({ active, payload }: CustomTooltipProps) {
  if (active && payload && payload.length > 0) {
    const data = payload[0].payload
    return (
      <div className="rounded-lg border bg-background p-3 shadow-lg">
        <p className="font-semibold text-foreground">{data.symbol}</p>
        <p className="text-sm text-muted-foreground">
          Score: {data.trade_score.toFixed(1)}
        </p>
        <p className="text-sm text-muted-foreground">
          R-Multiple: {data.r_multiple.toFixed(2)}
        </p>
        <p className="text-sm text-muted-foreground">
          Trade: {data.should_trade ? "Yes" : "No"}
        </p>
      </div>
    )
  }
  return null
}

export function ScoreScatter({ data }: ScoreScatterProps) {
  // Separate data by should_trade for different colors
  const tradeData = data.filter((d) => d.should_trade)
  const noTradeData = data.filter((d) => !d.should_trade)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Trade Score vs R-Multiple</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={400}>
          <ScatterChart
            margin={{ top: 20, right: 20, bottom: 20, left: 20 }}
          >
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis
              type="number"
              dataKey="trade_score"
              name="Trade Score"
              domain={[0, 10]}
              label={{
                value: "Trade Score",
                position: "insideBottom",
                offset: -10,
                className: "fill-muted-foreground",
              }}
              tick={{ fill: "hsl(var(--muted-foreground))" }}
            />
            <YAxis
              type="number"
              dataKey="r_multiple"
              name="R-Multiple"
              domain={[-3, 5]}
              label={{
                value: "R-Multiple",
                angle: -90,
                position: "insideLeft",
                className: "fill-muted-foreground",
              }}
              tick={{ fill: "hsl(var(--muted-foreground))" }}
            />
            <Tooltip content={<CustomTooltip />} />
            <ReferenceLine
              y={0}
              stroke="hsl(var(--muted-foreground))"
              strokeDasharray="3 3"
              label={{
                value: "Breakeven",
                position: "right",
                className: "fill-muted-foreground text-xs",
              }}
            />
            {/* Trade points (emerald-400) */}
            <Scatter
              name="Should Trade"
              data={tradeData}
              fill="rgb(52 211 153)"
              shape="circle"
            />
            {/* No trade points (red-400) */}
            <Scatter
              name="Should Not Trade"
              data={noTradeData}
              fill="rgb(248 113 113)"
              shape="circle"
            />
          </ScatterChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
