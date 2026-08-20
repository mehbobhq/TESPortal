import { Save } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Field, FieldGroup, FieldLabel, FieldDescription } from "@/components/ui/field"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

// Kept this array as it defines the settings UI options, but set all defaults to false
const notifications = [
  { id: "expiry", label: "Expiring credentials & documents", desc: "Alert when licenses, cards, or policies near expiry.", on: false },
  { id: "filings", label: "Tax filing deadlines", desc: "Reminders for IFTA, IRP, HVUT, and GST/HST due dates.", on: false },
  { id: "hos", label: "Hours-of-service violations", desc: "Notify when a driver logs an HOS violation.", on: false },
  { id: "customs", label: "Customs manifest status", desc: "Updates when ACE/ACI manifests are accepted or rejected.", on: false },
  { id: "billing", label: "Customer billing events", desc: "Past-due accounts and invoice activity.", on: false },
]

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        title="Settings"
        description="Configure your organization, notifications, and compliance defaults."
      />

      <Tabs defaultValue="organization" className="gap-6">
        <TabsList>
          <TabsTrigger value="organization">Organization</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="compliance">Compliance</TabsTrigger>
        </TabsList>

        <TabsContent value="organization" className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Organization details</CardTitle>
              <CardDescription>Company identity used across filings and documents.</CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="orgName">Legal name</FieldLabel>
                  <Input id="orgName" placeholder="Legal company name" />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="usdot">USDOT number</FieldLabel>
                    <Input id="usdot" placeholder="USDOT number" />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="mc">MC number</FieldLabel>
                    <Input id="mc" placeholder="MC number" />
                  </Field>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="baseJurisdiction">Base jurisdiction</FieldLabel>
                    <Select>
                      <SelectTrigger id="baseJurisdiction">
                        <SelectValue placeholder="Select jurisdiction" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="on">Ontario</SelectItem>
                          <SelectItem value="qc">Quebec</SelectItem>
                          <SelectItem value="ny">New York</SelectItem>
                          <SelectItem value="mi">Michigan</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <FieldDescription>Used as the IRP/IFTA base jurisdiction.</FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="currency">Default currency</FieldLabel>
                    <Select>
                      <SelectTrigger id="currency">
                        <SelectValue placeholder="Select currency" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="cad">CAD — Canadian Dollar</SelectItem>
                          <SelectItem value="usd">USD — US Dollar</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
              </FieldGroup>
            </CardContent>
            <CardFooter className="justify-end">
              <Button>
                <Save data-icon="inline-start" />
                Save changes
              </Button>
            </CardFooter>
          </Card>
        </TabsContent>

        <TabsContent value="notifications" className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Notification preferences</CardTitle>
              <CardDescription>Choose which compliance events send you alerts.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-1">
              {notifications.map((n, i) => (
                <div key={n.id}>
                  {i > 0 && <Separator className="my-1" />}
                  <div className="flex items-center justify-between gap-4 py-3">
                    <div className="flex flex-col gap-0.5">
                      <Label htmlFor={n.id} className="font-medium">
                        {n.label}
                      </Label>
                      <p className="text-muted-foreground text-sm">{n.desc}</p>
                    </div>
                    <Switch id={n.id} defaultChecked={n.on} />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="compliance" className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Compliance defaults</CardTitle>
              <CardDescription>Set lead times and thresholds for automated monitoring.</CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="leadTime">Expiry warning lead time</FieldLabel>
                    <Select>
                      <SelectTrigger id="leadTime">
                        <SelectValue placeholder="Select lead time" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="14">14 days</SelectItem>
                          <SelectItem value="30">30 days</SelectItem>
                          <SelectItem value="60">60 days</SelectItem>
                          <SelectItem value="90">90 days</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <FieldDescription>How early to flag expiring items.</FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="scoreTarget">Target compliance score</FieldLabel>
                    <Input id="scoreTarget" type="number" placeholder="e.g., 95" />
                    <FieldDescription>Alert if fleet score drops below this.</FieldDescription>
                  </Field>
                </div>
                <Separator />
                <div className="flex items-center justify-between gap-4">
                  <div className="flex flex-col gap-0.5">
                    <Label htmlFor="autoFile" className="font-medium">
                      Auto-prepare filings
                    </Label>
                    <p className="text-muted-foreground text-sm">Draft IFTA/IRP filings automatically each period.</p>
                  </div>
                  <Switch id="autoFile" />
                </div>
              </FieldGroup>
            </CardContent>
            <CardFooter className="justify-end">
              <Button>
                <Save data-icon="inline-start" />
                Save changes
              </Button>
            </CardFooter>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  )
}
