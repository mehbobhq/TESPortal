"use client"

import { EventsWorkspace } from "./events-workspace"

// Driver Events are canonical (PostgreSQL) records: server-validated, versioned, evidence-linked and tenant-isolated. Nothing is read from or written to the browser.
export default function RecordOfEventsPage() {
  return <EventsWorkspace />
}
