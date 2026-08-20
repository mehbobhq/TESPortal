import Link from "next/link"
import { Building2, Landmark, ShieldCheck, Plus, Search } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { StatCard } from "@/components/stat-card"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { InputGroup, InputGroupInput, InputGroupAddon } from "@/components/ui/input-group"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

// Added type to ensure TypeScript stays happy with an empty array
type Company = {
  name: string;
  kind: string;
  contact: string;
  region: string;
  status: string;
  tone: "ok" | "warn" | "danger" | "default" | "info" | "neutral";
}

// Emptied the sample data
const companies: Company[] = []

export default function CompaniesPage() {
  const agencies = companies.filter((c) => c.kind === "Government Agency").length
  const insurers = companies.filter((c) => c.kind.includes("Insurance")).length

  return (
    <>
      <PageHeader
        title="Companies"
        description="Master directory of all entities including customers, government agencies, insurers, and service providers."
        actions={
          <Button asChild>
            {/* Added flex, items-center, and a gap to keep them aligned horizontally */}
            <Link href="/companies/new" className="flex items-center gap-2">
              <Plus className="size-4" />
              Add company
            </Link>
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {/* Reset hardcoded stat values */}
        <StatCard label="Total companies" value={String(companies.length)} icon={Building2} hint="all types" />
        <StatCard label="Government agencies" value={String(agencies)} icon={Landmark} hint="CBSA, CBP, etc." />
        <StatCard label="Insurance partners" value={String(insurers)} icon={ShieldCheck} hint="brokers + carriers" />
        <StatCard label="Active relationships" value={String(companies.length)} icon={Building2} hint="all current" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Companies</CardTitle>
          <CardDescription>Complete roster of all associated entities across your network.</CardDescription>
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
              {/* Added a fallback for when the array is empty */}
              {companies.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                    No companies found.
                  </TableCell>
                </TableRow>
              ) : (
                companies.map((c) => (
                  <TableRow key={c.name}>
                    <TableCell className="pl-6 font-medium">{c.name}</TableCell>
                    <TableCell className="text-muted-foreground">{c.kind}</TableCell>
                    <TableCell className="text-muted-foreground font-mono text-xs">{c.contact}</TableCell>
                    <TableCell className="text-muted-foreground">{c.region}</TableCell>
                    <TableCell className="pr-6">
                      <StatusBadge tone={c.tone}>{c.status}</StatusBadge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  )
}
