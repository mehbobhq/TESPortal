// Empty data store for TES.
// The application starts with no records so every workflow can be
// tested from a clean state.

export const expiringItems: Array<{
  item: string
  type: string
  jurisdiction: string
  due: string
  tone: "danger" | "warn" | "neutral"
}> = []

export const upcomingFilings: Array<{
  name: string
  period: string
  jurisdictions: number
  status: string
  tone: "warn" | "ok" | "neutral"
  due: string
}> = []

export const complianceTrend: Array<{
  month: string
  score: number
  incidents: number
}> = []

export const jurisdictionMileage: Array<{
  name: string
  miles: number
}> = []

export const recentActivity: Array<{
  who: string
  action: string
  target: string
  when: string
}> = []

export const vehicles: Array<{
  unit: string
  type: string
  make: string
  plate: string
  vin: string
  status: string
  tone: "ok" | "warn" | "danger"
  jurisdiction: string
}> = []

export const drivers: Array<{
  name: string
  cdl: string
  medical: string
  hos: string
  tone: "ok" | "warn" | "danger"
  trips: number
}> = []

export const companies: Array<{
  name: string
  kind: string
  contact: string
  region: string
  status: string
  tone: "ok" | "warn" | "danger"
}> = []

export const customers: Array<{
  name: string
  plan: string
  since: string
  contact: string
  value: string
  status: string
  tone: "ok" | "info" | "danger"
}> = []
