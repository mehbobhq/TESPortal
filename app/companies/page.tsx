"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Building2, Landmark, ShieldCheck, Plus, Search } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { StatCard } from "@/components/stat-card"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { InputGroup, InputGroupInput, InputGroupAddon } from "@/components/ui/input-group"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

type Company = {
  id: string;
  name: string;
  kind: string;
  region: string;
  status: string;
  tone: "ok" | "warn" | "danger" | "info" | "neutral";
}

export default function CompaniesPage() {
  const router = useRouter()
  const [companies, setCompanies] = useState<Company[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch("/api/companies", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to load companies.")
        return response.json() as Promise<{ companies: Company[] }>
      })
      .then((payload) => {
        if (!cancelled) {
          setCompanies(payload.companies)
          setError(null)
        }
      })
      .catch(() => {
        if (!cancelled) setError("Companies could not be loaded from PostgreSQL.")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const agencies = companies.filter((c) => c.kind === "Government Agency").length
  const insurers = companies.filter((c) => c.kind.includes("Insurance")).length

  return (
    <>
      <PageHeader
        title="Companies"
        description="Master directory of all entities including customers, government agencies, insurers, and service providers."
        actions={
          <Button asChild>
            <Link href="/companies/new" className="flex items-center gap-2">
              <Plus className="size-4" />
              Add company
            </Link>
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
                <TableHead className="pl-6">Record ID</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Region</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                    Loading companies from PostgreSQL...
                  </TableCell>
                </TableRow>
              ) : error ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-destructive">
                    {error}
                  </TableCell>
                </TableRow>
              ) : companies.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                    No companies found. Add one to get started.
                  </TableCell>
                </TableRow>
              ) : (
                companies.map((c, idx) => (
                  <TableRow 
                    key={idx} 
                    onClick={() => router.push(`/companies/${c.id}/profile`)}
                    className="cursor-pointer hover:bg-muted/50 transition-colors"
                  >
                    <TableCell className="pl-6 font-mono text-xs text-muted-foreground">{c.id}</TableCell>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell className="text-muted-foreground">{c.kind}</TableCell>
                    <TableCell className="text-muted-foreground">{c.region}</TableCell>
                    <TableCell>
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
