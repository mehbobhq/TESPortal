import { Building2, Landmark, ShieldCheck, Plus, Search } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { StatCard } from "@/components/stat-card"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { InputGroup, InputGroupInput, InputGroupAddon } from "@/components/ui/input-group"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { companies } from "@/lib/data"

export default function CompaniesPage() {
  const agencies = companies.filter((c) => c.kind === "Government Agency").length
  const insurers = companies.filter((c) => c.kind.includes("Insurance")).length

  return (
    <>
      <PageHeader
        title="Companies"
        description="Government agencies, insurance brokers and carriers, and registration authorities you work with."
        actions={
          <Button>
            <Plus data-icon="inline-start" />
            Add company
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total companies" value={String(companies.length)} icon={Building2} hint="all types" />
        <StatCard label="Government agencies" value={String(agencies)} icon={Landmark} hint="CBSA, CBP, etc." />
        <StatCard label="Insurance partners" value={String(insurers)} icon={ShieldCheck} hint="brokers + carriers" />
        <StatCard label="Active relationships" value={String(companies.length)} icon={Building2} hint="all current" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Companies</CardTitle>
          <CardDescription>Agencies, insurers, and authorities — distinct from paying customers.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 px-0">
          <div className="px-6">
            <InputGroup className="max-w-sm">
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
              <InputGroupInput placeholder="Search companies..." />
            </InputGroup>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Company</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Region</TableHead>
                <TableHead className="pr-6">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {companies.map((c) => (
                <TableRow key={c.name}>
                  <TableCell className="pl-6 font-medium">{c.name}</TableCell>
                  <TableCell className="text-muted-foreground">{c.kind}</TableCell>
                  <TableCell className="text-muted-foreground font-mono text-xs">{c.contact}</TableCell>
                  <TableCell className="text-muted-foreground">{c.region}</TableCell>
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
