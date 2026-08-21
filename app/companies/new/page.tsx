"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { AlertCircle, File, FileText, Save, Upload, X, ShieldAlert } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field, FieldGroup, FieldLabel, FieldDescription } from "@/components/ui/field"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Separator } from "@/components/ui/separator"
import { Checkbox } from "@/components/ui/checkbox"

// --- Helper Functions for Duplicate Detection ---

// Normalizes a name: removes punctuation, common suffixes, and converts to lowercase
function normalizeName(name: string): string {
  return name.toLowerCase()
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "") // Remove punctuation
    .replace(/\b(inc|llc|corp|ltd|co|incorporated|corporation|company)\b/gi, "") // Remove suffixes
    .replace(/\s+/g, " ") // Normalize spaces
    .trim()
}

// Calculates Levenshtein Distance (how many edits to turn string A into string B)
function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null));
  for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
  for (let j = 0; j <= b.length; j++) matrix[j][0] = j;
  for (let j = 1; j <= b.length; j++) {
    for (let i = 1; i <= a.length; i++) {
      const indicator = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1, 
        matrix[j - 1][i] + 1, 
        matrix[j - 1][i - 1] + indicator
      );
    }
  }
  return matrix[b.length][a.length];
}

const COMPANY_TYPES = [ /* ... keep existing array ... */ ]

export default function AddCompanyPage() {
  const router = useRouter()
  
  const [selectedType, setSelectedType] = useState<string>("")
  const [recordId, setRecordId] = useState("CMP-00001") 
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([])
  
  // Duplicate Detection State
  const [exactMatchError, setExactMatchError] = useState<string | null>(null)
  const [fuzzyWarning, setFuzzyWarning] = useState<string | null>(null)
  const [overrideFuzzy, setOverrideFuzzy] = useState(false)
  const [allExistingCompanies, setAllExistingCompanies] = useState<any[]>([])

  useEffect(() => {
    const existing = JSON.parse(localStorage.getItem("tes_companies") || "[]")
    setAllExistingCompanies(existing)
    const nextNum = existing.length + 1
    setRecordId(`CMP-${String(nextNum).padStart(5, '0')}`)
  }, [])

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    if (!value) {
      setExactMatchError(null);
      setFuzzyWarning(null);
      setOverrideFuzzy(false);
      return;
    }

    const normalizedInput = normalizeName(value)
    let foundExact = false
    let foundFuzzy = null

    for (const company of allExistingCompanies) {
      const normalizedExisting = normalizeName(company.name)
      
      // 1. Strict Uniqueness Enforcement
      if (normalizedInput === normalizedExisting || value.toLowerCase() === company.name.toLowerCase()) {
        foundExact = true
        setExactMatchError(`This company already exists: ${company.name} (${company.id}). Select from the list instead.`)
        setFuzzyWarning(null)
        break;
      }
      
      // 2. Fuzzy Matching Logic (threshold: distance of 1-3 depending on length)
      const distance = levenshteinDistance(normalizedInput, normalizedExisting)
      const maxLength = Math.max(normalizedInput.length, normalizedExisting.length)
      const similarity = ((maxLength - distance) / maxLength) * 100

      if (similarity >= 85) { // 85% match threshold
        foundFuzzy = `Did you mean '${company.name}' (${company.id})? A company with a similar name already exists.`
      }
    }

    if (!foundExact) {
      setExactMatchError(null)
      if (foundFuzzy) {
        setFuzzyWarning(foundFuzzy)
        setOverrideFuzzy(false) // Require user to check the box again if they changed the text
      } else {
        setFuzzyWarning(null)
      }
    }
  }

  // --- Keep your existing handleFileChange, removeFile, and renderAddressCard functions here ---

  const handleCreateCompany = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault() 
    
    // Safety check: Block save if exact match exists, or if fuzzy exists and override isn't checked
    if (exactMatchError || (fuzzyWarning && !overrideFuzzy)) {
      return;
    }

    if (!selectedType) {
      alert("Please select a Company Type before saving.")
      return
    }

    // ... Keep your existing formData logic and local storage saving here ...
  }

  // Determine if the submit button should be disabled
  const isSubmitDisabled = !!exactMatchError || (!!fuzzyWarning && !overrideFuzzy)

  return (
    <form onSubmit={handleCreateCompany} className="pb-10">
      <PageHeader
        title="Add Company"
        description="Create a new entity record in the master directory."
        actions={
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 flex flex-col gap-6">
          
          {/* EXACT MATCH BLOCK */}
          {exactMatchError && (
            <Alert variant="destructive" className="bg-destructive/10 text-destructive border-destructive/20">
              <ShieldAlert className="size-4" />
              <AlertTitle>Duplicate Blocked</AlertTitle>
              <AlertDescription>{exactMatchError}</AlertDescription>
            </Alert>
          )}

          {/* FUZZY MATCH WARNING & OVERRIDE */}
          {fuzzyWarning && !exactMatchError && (
            <Alert variant="destructive" className="bg-orange-500/10 text-orange-600 border-orange-500/20 dark:text-orange-400">
              <AlertCircle className="size-4" />
              <AlertTitle>Potential Duplicate Detected</AlertTitle>
              <AlertDescription className="flex flex-col gap-3 mt-2">
                <p>{fuzzyWarning}</p>
                <div className="flex items-center space-x-2 bg-orange-500/10 p-2 rounded-md w-fit">
                  <Checkbox 
                    id="overrideFuzzy" 
                    checked={overrideFuzzy} 
                    onCheckedChange={(checked) => setOverrideFuzzy(checked as boolean)}
                    className="border-orange-600 data-[state=checked]:bg-orange-600"
                  />
                  <label htmlFor="overrideFuzzy" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                    I confirm this is a separate, new entity. Add anyway.
                  </label>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {/* ... The rest of your form UI goes here ... */}
          
          {/* Bottom Actions Update */}
      <div className="bg-background/80 supports-[backdrop-filter]:bg-background/60 border-t sticky bottom-0 z-10 -mx-6 mt-6 flex items-center justify-end gap-4 px-6 py-4 backdrop-blur">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitDisabled}>
          <Save data-icon="inline-start" className="mr-2 size-4" />
          Create Company
        </Button>
      </div>
