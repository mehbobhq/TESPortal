"use client"

import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"

const spendData = [
  { month: "Sep", fuel: 82000, tolls: 12400, permits: 5200 },
  { month: "Oct", fuel: 78500, tolls: 11800, permits: 4800 },
  { month: "Nov", fuel: 85200, tolls: 13100, permits: 6100 },
  { month: "Dec", fuel: 91000, tolls: 14200, permits: 5400 },
  { month: "Jan", fuel: 88300, tolls: 13600, permits: 7200 },
  { month: "Feb", fuel: 84900, tolls: 12900, permits: 5900 },
]

const spendConfig = {
  fuel: { label: "Fuel", color: "var(--chart-1)" },
  tolls: { label: "Tolls", color: "var(--chart-2)" },
  permits: { label: "Permits", color: "var(--chart-4)" },
} satisfies ChartConfig

const revenueData = [
  { month: "Sep", revenue: 218000, miles: 132000 },
  { month: "Oct", revenue: 205000, miles: 128000 },
  { month: "Nov", revenue: 231000, miles: 141000 },
  { month: "Dec", revenue: 248000, miles: 149000 },
  { month: "Jan", revenue: 239000, miles: 144000 },
  { month: "Feb", revenue: 226000, miles: 138000 },
]

const revenueConfig = {
  revenue: { label: "Revenue ($)", color: "var(--chart-1)" },
  miles: { label: "Miles", color: "var(--chart-3)" },
} satisfies ChartConfig

export function SpendChart() {
  return (
    <ChartContainer config={spendConfig} className="h-[260px] w-full">
      <BarChart data={spendData} margin={{ left: -8, right: 8, top: 8 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis tickLine={false} axisLine={false} tickMargin={8} width={48} tickFormatter={(v) => `$${v / 1000}k`} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="fuel" stackId="a" fill="var(--color-fuel)" radius={[0, 0, 0, 0]} />
        <Bar dataKey="tolls" stackId="a" fill="var(--color-tolls)" radius={[0, 0, 0, 0]} />
        <Bar dataKey="permits" stackId="a" fill="var(--color-permits)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ChartContainer>
  )
}

export function RevenueChart() {
  return (
    <ChartContainer config={revenueConfig} className="h-[260px] w-full">
      <LineChart data={revenueData} margin={{ left: -8, right: 8, top: 8 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis tickLine={false} axisLine={false} tickMargin={8} width={48} tickFormatter={(v) => `$${v / 1000}k`} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Line dataKey="revenue" type="monotone" stroke="var(--color-revenue)" strokeWidth={2} dot={false} />
      </LineChart>
    </ChartContainer>
  )
}
