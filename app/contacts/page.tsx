import { Contact, Building2, Users, Plus, Search, Mail, Phone } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { StatCard } from "@/components/stat-card"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { InputGroup, InputGroupInput, InputGroupAddon } from "@/components/ui/input-group"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"

// Define the type so TypeScript doesn't complain about an empty array
type ContactData = {
  name: string;
  role: string;
  org: string;
  orgType: string;
  email: string;
  phone: string;
  status: string;
  tone: "ok" | "warn" | "error" | "default" | "info" | "neutral";
}

// Emptied the sample data
const contacts: ContactData[] = []

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
}

export default function ContactsPage() {
  const companyContacts = contacts.filter((c) => c.orgType === "Company").length
  const customerContacts = contacts.filter((c) => c.orgType === "Customer").length

  return (
    <>
      <PageHeader
        title="Contacts"
        description="People across your companies and customer accounts — adjusters, brokers, agency reps, and client leads."
        actions={
          <Button>
            <Plus data-icon="inline-start" />
            Add contact
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {/* These will dynamically show 0 now */}
        <StatCard label="Total contacts" value={String(contacts.length)} icon={Contact} hint="all organizations" />
        <StatCard label="At companies" value={String(companyContacts)} icon={Building2} hint="agencies + insurers" />
        <StatCard label="At customers" value={String(customerContacts)} icon={Users} hint="client accounts" />
        <StatCard label="Primary contacts" value={String(contacts.filter((c) => c.status === "Primary").length)} icon={Contact} hint="main point of contact" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Directory</CardTitle>
          <CardDescription>Every person linked to a company or customer, with their role and reach.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 px-0">
          <div className="px-6">
            <InputGroup className="max-w-sm">
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
              <InputGroupInput placeholder="Search contacts..." />
            </InputGroup>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Organization</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead className="pr-6">Type</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* Added a fallback row for when the list is empty */}
              {contacts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    No contacts found.
                  </TableCell>
                </TableRow>
              ) : (
                contacts.map((c) => (
                  <TableRow key={c.name}>
                    <TableCell className="pl-6">
                      <div className="flex items-center gap-3">
                        <Avatar className="size-8">
                          <AvatarFallback className="text-xs">{initials(c.name)}</AvatarFallback>
                        </Avatar>
                        <span className="font-medium">{c.name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{c.role}</TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span>{c.org}</span>
                        <span className="text-muted-foreground text-xs">
                          <Badge variant="outline" className="mt-1">
                            {c.orgType}
                          </Badge>
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-muted-foreground flex items-center gap-1.5 font-mono text-xs">
                        <Mail className="size-3.5 shrink-0" />
                        {c.email}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-muted-foreground flex items-center gap-1.5 font-mono text-xs">
                        <Phone className="size-3.5 shrink-0" />
                        {c.phone}
                      </span>
                    </TableCell>
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
