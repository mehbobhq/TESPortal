"use client"

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"

import { complianceTrend } from "@/lib/data"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"

const config = {
  score: { label: "Compliance score", color: "var(--chart-1)" },
} satisfies ChartConfig

export function ComplianceChart() {
  return (
    <ChartContainer config={config} className="h-[220px] w-full">
      <AreaChart data={complianceTrend} margin={{ left: -12, right: 8, top: 8 }}>
        <defs>
          <linearGradient id="fillScore" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-score)" stopOpacity={0.3} />
            <stop offset="95%" stopColor="var(--color-score)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis domain={[80, 100]} tickLine={false} axisLine={false} tickMargin={8} width={32} />
        <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
        <Area
          dataKey="score"
          type="monotone"
          fill="url(#fillScore)"
          stroke="var(--color-score)"
          strokeWidth={2}
        />
      </AreaChart>
    </ChartContainer>
  )
}
