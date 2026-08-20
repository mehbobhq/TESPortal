import { ArrowRight, BadgeCheck, Plus } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"

// Added type for Programs to ensure TypeScript stays happy with an empty array
type Program = {
  name: string;
  full: string;
  authority: string;
  members: string;
  renewal: string;
  status: string;
  tone: "ok" | "warn" | "danger" | "default" | "info" | "neutral";
  desc: string;
}

// Emptied the sample data array
const programs: Program[] = []

export default function ProgramsPage() {
  return (
    <>
      <PageHeader
        title="Programs"
        description="Trusted-trader and safety programs — FAST, CTPAT, PIP, and more."
        actions={
          <Button>
            <Plus data-icon="inline-start" />
            Enroll in program
          </Button>
        }
      />

      {/* Added a fallback for when the programs array is empty */}
      {programs.length === 0 ? (
        <div className="flex h-32 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
          No programs enrolled or available.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {programs.map((p) => (
            <Card key={p.name} className="flex flex-col">
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <span className="bg-primary/10 text-primary flex size-10 items-center justify-center rounded-md">
                    <BadgeCheck className="size-5" />
                  </span>
                  <StatusBadge tone={p.tone}>{p.status}</StatusBadge>
                </div>
                <CardTitle className="mt-2 flex items-baseline gap-2">
                  {p.name}
                  <span className="text-muted-foreground text-xs font-normal">{p.full}</span>
                </CardTitle>
                <CardDescription className="leading-relaxed">{p.desc}</CardDescription>
              </CardHeader>
              <CardContent className="mt-auto grid grid-cols-3 gap-2 text-sm">
                <div className="flex flex-col">
                  <span className="text-muted-foreground text-xs">Authority</span>
                  <span className="font-medium">{p.authority}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-muted-foreground text-xs">Scope</span>
                  <span className="font-medium">{p.members}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-muted-foreground text-xs">Renewal</span>
                  <span className="font-medium">{p.renewal}</span>
                </div>
              </CardContent>
              <CardFooter>
                <Button variant="ghost" size="sm" className="w-full">
                  {p.status === "Eligible" ? "Learn more" : "Manage"}
                  <ArrowRight data-icon="inline-end" />
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </>
  )
}
