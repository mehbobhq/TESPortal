"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Building2, Plus, Search, Users } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { StatCard } from "@/components/stat-card"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { InputGroup, InputGroupInput, InputGroupAddon } from "@/components/ui/input-group"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

type Customer = {
  id: string;
  organizationId: string;
  name: string;
  region: string;
  status: string;
  tone: "ok" | "warn" | "danger" | "info" | "neutral";
}

export default function CustomersPage() {
  const router = useRouter()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch("/api/customers", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to load customers.")
        return response.json() as Promise<{ customers: Customer[] }>
      })
      .then((payload) => {
        if (!cancelled) {
          setCustomers(payload.customers)
          setError(null)
        }
      })
      .catch(() => {
        if (!cancelled) setError("Customers could not be loaded from PostgreSQL.")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const activeCustomers = customers.filter((c) => c.status === "Active").length

  return (
    <div className="space-y-6 pb-10">
      <PageHeader
        title="Active Customers"
        description="Manage your active client base, service agreements, and overall fleet readiness."
        actions={
          <Button asChild className="bg-slate-900 hover:bg-slate-800 text-white shadow-sm">
            <Link href="/companies/new" className="flex items-center gap-2">
              <Plus className="size-4 text-slate-400" />
              Onboard Customer
            </Link>
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard label="Total Customers" value={String(customers.length)} icon={Users} hint="all time" />
        <StatCard label="Active Clients" value={String(activeCustomers)} icon={Building2} hint="currently servicing" />
      </div>

      <Card className="border-slate-100 shadow-sm">
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-4 bg-slate-50/50">
          <div>
            <CardTitle className="text-lg text-slate-800">Client Roster</CardTitle>
            <CardDescription className="text-slate-500">All entities actively receiving services.</CardDescription>
          </div>
          
          <div className="w-full sm:max-w-sm">
            <InputGroup>
              <InputGroupAddon className="bg-white border-slate-200">
                <Search className="size-4 text-slate-400" />
              </InputGroupAddon>
              <InputGroupInput placeholder="Search customers..." className="border-slate-200 focus:border-slate-300" />
            </InputGroup>
          </div>
        </CardHeader>
        
        <CardContent className="px-0 pt-0">
          <Table>
            <TableHeader className="bg-slate-50/50">
              <TableRow className="border-slate-100 hover:bg-transparent">
                <TableHead className="pl-6 text-slate-500 font-medium">Record ID</TableHead>
                <TableHead className="text-slate-500 font-medium">Customer Name</TableHead>
                <TableHead className="text-slate-500 font-medium">Region</TableHead>
                <TableHead className="text-slate-500 font-medium">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-32 text-center text-slate-500">
                    Loading customers from PostgreSQL...
                  </TableCell>
                </TableRow>
              ) : error ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-32 text-center text-red-600">
                    {error}
                  </TableCell>
                </TableRow>
              ) : customers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-32 text-center text-slate-500">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <Users className="size-8 text-slate-300 mb-2" />
                      <p>No customers found.</p>
                      <Button variant="link" asChild className="text-slate-900">
                        <Link href="/companies/new">Onboard your first client</Link>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                customers.map((c, idx) => (
                  <TableRow 
                    key={idx}
                    onClick={() => router.push(`/companies/${c.organizationId}/profile`)}
                    className="cursor-pointer hover:bg-slate-50/80 border-slate-100 transition-colors"
                  >
                    <TableCell className="pl-6 font-mono text-xs text-slate-400">{c.id}</TableCell>
                    <TableCell className="font-medium text-slate-800">
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-slate-100 rounded-md">
                          <Building2 className="size-3.5 text-slate-500" />
                        </div>
                        {c.name}
                      </div>
                    </TableCell>
                    <TableCell className="text-slate-600">{c.region}</TableCell>
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
    </div>
  )
}
