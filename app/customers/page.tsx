"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Building2, Plus, Search, Trash2 } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { StatCard } from "@/components/stat-card"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { InputGroup, InputGroupInput, InputGroupAddon } from "@/components/ui/input-group"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

type Customer = {
  id: string;
  name: string;
  contact: string;
  region: string;
  status: string;
  tone: "ok" | "warn" | "danger" | "default" | "info" | "neutral";
}

export default function CustomersPage() {
  const router = useRouter()
  const [customers, setCustomers] = useState<Customer[]>([])

  useEffect(() => {
    const savedCustomers = localStorage.getItem("tes_customers")
    if (savedCustomers) {
      setCustomers(JSON.parse(savedCustomers))
    }
  }, [])

  const handleDelete = (e: React.MouseEvent, idToDelete: string) => {
    e.stopPropagation(); 
    if (!confirm("Are you sure you want to delete this customer?")) return;

    const updatedCustomers = customers.filter(c => c.id !== idToDelete);
    setCustomers(updatedCustomers);
    localStorage.setItem("tes_customers", JSON.stringify(updatedCustomers));

    const savedCompanies = JSON.parse(localStorage.getItem("tes_companies") || "[]");
    const updatedCompanies = savedCompanies.filter((c: any) => c.id !== idToDelete);
    localStorage.setItem("tes_companies", JSON.stringify(updatedCompanies));
  }

  const activeCustomers = customers.filter((c) => c.status === "Active").length

  return (
    <>
      <PageHeader
        title="Customers"
        description="Manage your active client base and service agreements."
        actions={
          <Button asChild>
            <Link href="/companies/new" className="flex items-center gap-2">
              <Plus className="size-4" />
              Add Customer
            </Link>
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard label="Total Customers" value={String(customers.length)} icon={Building2} hint="all time" />
        <StatCard label="Active Clients" value={String(activeCustomers)} icon={Building2} hint="currently servicing" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Client Roster</CardTitle>
          <CardDescription>All entities actively receiving services.</CardDescription>
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
                <TableHead className="pl-6">Record ID</TableHead>
                <TableHead>Customer Name</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Region</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="pr-6 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    No customers found. Add a company with the type "Customer".
                  </TableCell>
                </TableRow>
              ) : (
                customers.map((c, idx) => (
                  <TableRow 
                    key={idx}
                    // Fixed the routing path here!
                    onClick={() => router.push(`/companies/${c.id}/profile`)}
                    className="cursor-pointer hover:bg-muted/50 transition-colors"
                  >
                    <TableCell className="pl-6 font-mono text-xs text-muted-foreground">{c.id}</TableCell>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell className="text-muted-foreground font-mono text-xs">{c.contact}</TableCell>
                    <TableCell className="text-muted-foreground">{c.region}</TableCell>
                    <TableCell>
                      <StatusBadge tone={c.tone}>{c.status}</StatusBadge>
                    </TableCell>
                    <TableCell className="pr-6 text-right">
                      <Button variant="ghost" size="icon" onClick={(e) => handleDelete(e, c.id)}>
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
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
