import { Users, Repeat, CircleDollarSign, Plus, Search } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { StatCard } from "@/components/stat-card"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { InputGroup, InputGroupInput, InputGroupAddon } from "@/components/ui/input-group"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { customers } from "@/lib/data"

export default function CustomersPage() {
  const monthly = customers.filter((c) => c.plan === "Monthly").length
  const oneOff = customers.filter((c) => c.plan === "One-off").length
  const pastDue = customers.filter((c) => c.status === "Past due").length

  return (
    <>
      <PageHeader
        title="Customers"
        description="Your paying clients — recurring monthly accounts and one-off project engagements."
        actions={
          <Button>
            <Plus data-icon="inline-start" />
            Add customer
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total customers" value={String(customers.length)} icon={Users} hint="active accounts" />
        <StatCard label="Monthly clients" value={String(monthly)} icon={Repeat} hint="recurring revenue" />
        <StatCard label="One-off projects" value={String(oneOff)} icon={CircleDollarSign} hint="project-based" />
        <StatCard label="Past due" value={String(pastDue)} icon={CircleDollarSign} hint="needs follow-up" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Client accounts</CardTitle>
          <CardDescription>Monthly and one-off customers, their engagement value, and billing status.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 px-0">
          <div className="px-6">
            <InputGroup className="max-w-sm">
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
              <InputGroupInput placeholder="Search customers..." />
            </InputGroup>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Customer</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Client since</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Value</TableHead>
                <TableHead className="pr-6">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers.map((c) => (
                <TableRow key={c.name}>
                  <TableCell className="pl-6 font-medium">{c.name}</TableCell>
                  <TableCell>
                    <Badge variant={c.plan === "Monthly" ? "secondary" : "outline"}>{c.plan}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground font-mono tabular-nums">{c.since}</TableCell>
                  <TableCell className="text-muted-foreground font-mono text-xs">{c.contact}</TableCell>
                  <TableCell className="font-mono tabular-nums">{c.value}</TableCell>
                  <TableCell className="pr-6">
                    <StatusBadge tone={c.tone}>{c.status}</StatusBadge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  )
}
