import { ChevronRight, Landmark, Settings2 } from "lucide-react"
import { EmptyState } from "@/src/components/shared/StateDisplays"
import { formatFrequency } from "@/src/components/tax-filing/tax-helpers"
import type {
  TaxCode,
  TaxDefinition,
  TaxProfile,
} from "@/src/components/tax-filing/types"

type TaxProgramListItem = {
  definition: TaxDefinition
  profile?: TaxProfile
  accountDisplayValue: string
}

function TaxProgramList({
  items,
  selectedTaxCode,
  onSelectTaxCode,
  onOpenCompanySettings,
}: {
  items: TaxProgramListItem[]
  selectedTaxCode: TaxCode | null
  onSelectTaxCode: (taxCode: TaxCode) => void
  onOpenCompanySettings: () => void
}) {
  return (
    <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
      <div className="border-b border-border/60 p-5">
        <h3 className="text-base font-bold text-foreground">Applicable Tax Programs</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Applicability is managed in Company Settings. Configure company accounts, filing frequencies, and verification details below.
        </p>
      </div>
      <div>
        {items.length === 0 ? (
          <EmptyState
            icon={<Landmark className="size-8 text-muted-foreground/50" />}
            title="No Applicable Tax Programs"
            description="No tax programs are currently marked 'Applies' for this carrier in Company Settings."
            action={{
              label: "Open Company Settings",
              onClick: onOpenCompanySettings,
              icon: <Settings2 className="size-3.5" />,
            }}
          />
        ) : (
          <div className="divide-y divide-border/60">
            {items.map(({ definition, profile, accountDisplayValue }) => {
              const isSelected = selectedTaxCode === definition.code
              return (
                <button
                  key={definition.code}
                  type="button"
                  onClick={() => onSelectTaxCode(definition.code)}
                  className={`grid w-full gap-4 p-4 text-left transition-colors md:grid-cols-12 ${
                    isSelected ? "bg-primary/[0.04]" : "hover:bg-muted/20"
                  }`}
                >
                  <div className="md:col-span-4 min-w-0">
                    <p className="text-sm font-semibold text-foreground">{definition.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{definition.jurisdiction}</p>
                  </div>
                  <div className="md:col-span-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Account</p>
                    <p className="mt-0.5 font-mono text-xs font-semibold select-text text-foreground">
                      {accountDisplayValue}
                    </p>
                  </div>
                  <div className="md:col-span-2">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Frequency</p>
                    <p className="mt-0.5 text-xs font-medium text-foreground">
                      {profile
                        ? formatFrequency(profile.filingFrequency)
                        : formatFrequency(definition.defaultFrequency)}
                    </p>
                  </div>
                  <div className="md:col-span-2">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Status</p>
                    <p className="mt-0.5 text-xs font-semibold text-foreground">
                      {profile?.accountStatus || "Needs setup"}
                    </p>
                  </div>
                  <div className="flex items-center justify-end md:col-span-1">
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export { TaxProgramList }
export type { TaxProgramListItem }
