"use client"

import { useState } from "react"
import { FileText, Plus, ShieldCheck, FileKey2, HardHat, Truck } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { StatCard } from "@/components/stat-card"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

// --- TYPES ---
type TransInsurance = {
  id: string;
  type: string;
  number: string;
  company: string;
  broker: string;
  effective: string;
  expiry: string;
  limits: string;
  status: string;
  tone: "ok" | "warn" | "danger" | "default" | "info" | "neutral";
}

type WorkersInsurance = {
  id: string;
  type: string;
  number: string;
  company: string;
  effective: string;
  expiry: string;
  status: string;
  tone: "ok" | "warn" | "danger" | "default" | "info" | "neutral";
}

type SuretyBond = {
  id: string;
  type: string;
  number: string;
  company: string;
  principal: string;
  obligee?: string;
  amount: string;
  effective: string;
  expiry: string;
  status: string;
  tone: "ok" | "warn" | "danger" | "default" | "info" | "neutral";
}

export default function InsurancePage() {
  // Empty states for dev environment
  const [transPolicies, setTransPolicies] = useState<TransInsurance[]>([])
  const [workersPolicies, setWorkersPolicies] = useState<WorkersInsurance[]>([])
  const [suretyBonds, setSuretyBonds] = useState<SuretyBond[]>([])

  return (
    <div className="space-y-6 pb-10">
      <PageHeader
        title="Insurance & Bonds"
        description="Manage transportation liability, workers' compensation, and surety bonds."
        actions={
          <Button className="bg-slate-900 hover:bg-slate-800 text-white shadow-sm">
            <Plus className="mr-2 size-4 text-slate-400" />
            Add Record
          </Button>
        }
      />

      {/* TOP-LEVEL KPIs */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Transportation Policies" value={String(transPolicies.length)} icon={Truck} hint="liability, cargo, physical damage" />
        <StatCard label="Workers Insurance" value={String(workersPolicies.length)} icon={HardHat} hint="WSIB / WCB / workers comp" />
        <StatCard label="Active Bonds" value={String(suretyBonds.length)} icon={FileKey2} hint="customs & performance bonds" />
      </div>

      {/* SECTION 1: TRANSPORTATION INSURANCE */}
      <Card className="border-slate-100 shadow-sm">
        <CardHeader className="bg-slate-50/50 border-b border-slate-100 pb-4">
          <CardTitle className="text-lg text-slate-800 flex items-center gap-2">
            <ShieldCheck className="size-5 text-slate-400" />
            Transportation Insurance
          </CardTitle>
          <CardDescription className="text-slate-500">Auto liability, general liability, and cargo coverage.</CardDescription>
        </CardHeader>
        <CardContent className="px-0 pt-0 overflow-x-auto">
          <Table>
            <TableHeader className="bg-slate-50/50">
              <TableRow className="border-slate-100 hover:bg-transparent">
                <TableHead className="pl-6 text-slate-500 font-medium whitespace-nowrap">Record ID</TableHead>
                <TableHead className="text-slate-500 font-medium whitespace-nowrap">Insurance Type</TableHead>
                <TableHead className="text-slate-500 font-medium whitespace-nowrap">Policy Number</TableHead>
                <TableHead className="text-slate-500 font-medium whitespace-nowrap">Company & Broker</TableHead>
                <TableHead className="text-slate-500 font-medium whitespace-nowrap">Effective Dates</TableHead>
                <TableHead className="text-slate-500 font-medium whitespace-nowrap">Coverage Limits</TableHead>
                <TableHead className="pr-6 text-slate-500 font-medium whitespace-nowrap text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transPolicies.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center text-slate-500">
                    <div className="flex flex-col items-center gap-2">
                      <Truck className="size-8 text-slate-300" />
                      <p>No transportation policies on file.</p>
                      <Button variant="link" className="text-slate-900 h-auto p-0">Add Transportation Policy</Button>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                transPolicies.map((p) => (
                  <TableRow key={p.id} className="hover:bg-slate-50/80 border-slate-100 cursor-pointer">
                    <TableCell className="pl-6 font-mono text-xs text-slate-400">{p.id}</TableCell>
                    <TableCell className="font-medium text-slate-800">{p.type}</TableCell>
                    <TableCell className="text-slate-600 font-mono text-xs">{p.number}</TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="text-slate-800">{p.company}</span>
                        <span className="text-xs text-slate-500">Broker: {p.broker}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col text-sm">
                        <span className="text-slate-600">{p.effective} to</span>
                        <span className="text-slate-800 font-medium">{p.expiry}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-slate-600 font-mono tabular-nums">{p.limits}</TableCell>
                    <TableCell className="pr-6 text-right">
                      <StatusBadge tone={p.tone}>{p.status}</StatusBadge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* SECTION 2: WORKERS INSURANCE */}
      <Card className="border-slate-100 shadow-sm">
        <CardHeader className="bg-slate-50/50 border-b border-slate-100 pb-4">
          <CardTitle className="text-lg text-slate-800 flex items-center gap-2">
            <HardHat className="size-5 text-slate-400" />
            Workers Insurance
          </CardTitle>
          <CardDescription className="text-slate-500">WSIB, WCB, and occupational accident coverage.</CardDescription>
        </CardHeader>
        <CardContent className="px-0 pt-0 overflow-x-auto">
          <Table>
            <TableHeader className="bg-slate-50/50">
              <TableRow className="border-slate-100 hover:bg-transparent">
                <TableHead className="pl-6 text-slate-500 font-medium whitespace-nowrap">Record ID</TableHead>
                <TableHead className="text-slate-500 font-medium whitespace-nowrap">Coverage Type</TableHead>
                <TableHead className="text-slate-500 font-medium whitespace-nowrap">Policy Number</TableHead>
                <TableHead className="text-slate-500 font-medium whitespace-nowrap">Insurance Company</TableHead>
                <TableHead className="text-slate-500 font-medium whitespace-nowrap">Effective Dates</TableHead>
                <TableHead className="pr-6 text-slate-500 font-medium whitespace-nowrap text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {workersPolicies.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center text-slate-500">
                    <div className="flex flex-col items-center gap-2">
                      <HardHat className="size-8 text-slate-300" />
                      <p>No workers insurance records on file.</p>
                      <Button variant="link" className="text-slate-900 h-auto p-0">Add Workers Insurance</Button>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                workersPolicies.map((p) => (
                  <TableRow key={p.id} className="hover:bg-slate-50/80 border-slate-100 cursor-pointer">
                    <TableCell className="pl-6 font-mono text-xs text-slate-400">{p.id}</TableCell>
                    <TableCell className="font-medium text-slate-800">{p.type}</TableCell>
                    <TableCell className="text-slate-600 font-mono text-xs">{p.number}</TableCell>
                    <TableCell className="text-slate-800">{p.company}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-slate-500">{p.effective}</span>
                        <span className="text-slate-300">→</span>
                        <span className="text-slate-800 font-medium">{p.expiry}</span>
                      </div>
                    </TableCell>
                    <TableCell className="pr-6 text-right">
                      <StatusBadge tone={p.tone}>{p.status}</StatusBadge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* SECTION 3: SURETY BONDS */}
      <Card className="border-slate-100 shadow-sm mt-8">
        <CardHeader className="bg-slate-50/50 border-b border-slate-100 pb-4">
          <CardTitle className="text-lg text-slate-800 flex items-center gap-2">
            <FileKey2 className="size-5 text-slate-400" />
            Surety Bonds
          </CardTitle>
          <CardDescription className="text-slate-500">Customs bonds, freight broker bonds, and performance guarantees.</CardDescription>
        </CardHeader>
        <CardContent className="px-0 pt-0 overflow-x-auto">
          <Table>
            <TableHeader className="bg-slate-50/50">
              <TableRow className="border-slate-100 hover:bg-transparent">
                <TableHead className="pl-6 text-slate-500 font-medium whitespace-nowrap">Record ID</TableHead>
                <TableHead className="text-slate-500 font-medium whitespace-nowrap">Bond Type</TableHead>
                <TableHead className="text-slate-500 font-medium whitespace-nowrap">Bond Number</TableHead>
                <TableHead className="text-slate-500 font-medium whitespace-nowrap">Surety & Parties</TableHead>
                <TableHead className="text-slate-500 font-medium whitespace-nowrap">Amount</TableHead>
                <TableHead className="text-slate-500 font-medium whitespace-nowrap">Effective Dates</TableHead>
                <TableHead className="pr-6 text-slate-500 font-medium whitespace-nowrap text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {suretyBonds.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center text-slate-500">
                    <div className="flex flex-col items-center gap-2">
                      <FileKey2 className="size-8 text-slate-300" />
                      <p>No surety bonds on file.</p>
                      <Button variant="link" className="text-slate-900 h-auto p-0">Add Surety Bond</Button>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                suretyBonds.map((b) => (
                  <TableRow key={b.id} className="hover:bg-slate-50/80 border-slate-100 cursor-pointer">
                    <TableCell className="pl-6 font-mono text-xs text-slate-400">{b.id}</TableCell>
                    <TableCell className="font-medium text-slate-800">{b.type}</TableCell>
                    <TableCell className="text-slate-600 font-mono text-xs">{b.number}</TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="text-slate-800 font-medium">{b.company}</span>
                        <span className="text-xs text-slate-500">Principal: {b.principal}</span>
                        {b.obligee && <span className="text-xs text-slate-500">Obligee: {b.obligee}</span>}
                      </div>
                    </TableCell>
                    <TableCell className="text-slate-800 font-mono tabular-nums font-medium">{b.amount}</TableCell>
                    <TableCell>
                      <div className="flex flex-col text-sm">
                        <span className="text-slate-600">{b.effective} to</span>
                        <span className="text-slate-800 font-medium">{b.expiry}</span>
                      </div>
                    </TableCell>
                    <TableCell className="pr-6 text-right">
                      <StatusBadge tone={b.tone}>{b.status}</StatusBadge>
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