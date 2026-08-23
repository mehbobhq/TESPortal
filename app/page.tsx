// app/companies/page.tsx

import { Building2, Download, Filter, Plus, Search } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { companies } from "@/lib/data"

export default function CompaniesPage() {
  return (
    <>
      <PageHeader
        title="Companies"
        description="Master directory of all business entities, including customers, insurance brokers, vendors, and government agencies."
        actions={
          <>
            <Button variant="outline">
              <Download data-icon="inline-start" className="mr-2 size-4" />
              Export Directory
            </Button>
            {/* This button will trigger the "Add Company" modal/form where our validation logic runs */}
            <Button>
              <Plus data-icon="inline-start" className="mr-2 size-4" />
              Add Company
            </Button>
          </>
        }
      />

      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b pb-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="text-muted-foreground size-5" />
              Entity Directory
            </CardTitle>
            <CardDescription>Manage your universal list of verified organizations.</CardDescription>
          </div>
          
          {/* Filters - Essential for the Master Directory */}
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search companies..."
                className="w-full pl-8 sm:w-[250px]"
              />
            </div>
            <Button variant="outline" size="icon">
              <Filter className="size-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="px-0 pt-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Company Name</TableHead>
                <TableHead>Entity Type</TableHead>
                <TableHead>Primary Contact</TableHead>
                <TableHead>Region</TableHead>
                <TableHead>Status</TableHead>
                {/* Notice: No Delete column here per our "No Deletion" master rule */}
                <TableHead className="pr-6 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {companies.map((company) => (
                <TableRow key={company.name} className="hover:bg-muted/50 cursor-pointer">
                  <TableCell className="pl-6 font-medium">{company.name}</TableCell>
                  <TableCell className="text-muted-foreground">{company.kind}</TableCell>
                  <TableCell className="text-muted-foreground">{company.contact}</TableCell>
                  <TableCell className="text-muted-foreground">{company.region}</TableCell>
                  <TableCell>
                    <StatusBadge tone={company.tone}>{company.status}</StatusBadge>
                  </TableCell>
                  <TableCell className="pr-6 text-right">
                    <Button variant="ghost" size="sm">View</Button>
                  </TableCell>
                </TableRow>
              ))}
              
              {/* Empty state fallback in case lib/data.ts is empty */}
              {companies.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    No companies found. Click "Add Company" to create your first entity.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  )
}
