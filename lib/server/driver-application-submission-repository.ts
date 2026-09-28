import "server-only"

import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"

export type ServerApplicantSubmission = {
  applicationId: string
  submittedAt: string
  receiptId: string
  completedSteps: string[]
  draft: unknown
}

type SubmissionDatabase = {
  version: 1
  submissions: Record<string, ServerApplicantSubmission>
}

const dataDirectory = path.join(process.cwd(), ".tes-data")
const dataFile = path.join(dataDirectory, "driver-application-submissions.json")

async function readDatabase(): Promise<SubmissionDatabase> {
  try {
    const raw = await readFile(dataFile, "utf8")
    const parsed = JSON.parse(raw) as SubmissionDatabase
    if (parsed?.version === 1 && parsed.submissions && typeof parsed.submissions === "object") return parsed
  } catch {
    // First run or unreadable development file: start with an empty repository.
  }
  return { version: 1, submissions: {} }
}

async function writeDatabase(database: SubmissionDatabase) {
  await mkdir(dataDirectory, { recursive: true })
  const temporaryFile = `${dataFile}.tmp`
  await writeFile(temporaryFile, JSON.stringify(database, null, 2), "utf8")
  await rename(temporaryFile, dataFile)
}

export async function saveApplicantSubmission(snapshot: ServerApplicantSubmission) {
  const database = await readDatabase()
  const existing = database.submissions[snapshot.applicationId]

  // Submission is immutable. Replays are allowed only for the same submission.
  if (existing) {
    if (
      existing.submittedAt !== snapshot.submittedAt ||
      existing.receiptId !== snapshot.receiptId ||
      JSON.stringify(existing.draft) !== JSON.stringify(snapshot.draft)
    ) {
      throw new Error("A different immutable submission already exists for this application.")
    }
    return existing
  }

  database.submissions[snapshot.applicationId] = snapshot
  await writeDatabase(database)
  return snapshot
}

export async function getApplicantSubmissions(applicationIds: string[]) {
  const database = await readDatabase()
  return applicationIds
    .map((applicationId) => database.submissions[applicationId])
    .filter((submission): submission is ServerApplicantSubmission => Boolean(submission))
}
