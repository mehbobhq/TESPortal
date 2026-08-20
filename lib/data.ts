// Static sample data for the UI scaffold. Replace with real data sources later.

export const expiringItems = [
  { item: "Cab Card — Unit 4471", type: "Credential", jurisdiction: "IRP / Ontario", due: "in 4 days", tone: "danger" as const },
  { item: "Liability Policy #INS-2290", type: "Insurance", jurisdiction: "Federal", due: "in 9 days", tone: "warn" as const },
  { item: "Medical Card — R. Alvarez", type: "Driver", jurisdiction: "FMCSA", due: "in 12 days", tone: "warn" as const },
  { item: "IFTA License 2026", type: "Tax", jurisdiction: "IFTA / Quebec", due: "in 21 days", tone: "warn" as const },
  { item: "CTPAT Revalidation", type: "Program", jurisdiction: "CBP", due: "in 34 days", tone: "neutral" as const },
]

export const upcomingFilings = [
  { name: "IFTA Q1 2026", period: "Jan – Mar", jurisdictions: 8, status: "In progress", tone: "warn" as const, due: "Apr 30" },
  { name: "IRP Renewal", period: "Annual", jurisdictions: 5, status: "Ready to file", tone: "ok" as const, due: "May 15" },
  { name: "HVUT Form 2290", period: "Annual", jurisdictions: 1, status: "Not started", tone: "neutral" as const, due: "Aug 31" },
  { name: "GST/HST Return", period: "Q1 2026", jurisdictions: 1, status: "In progress", tone: "warn" as const, due: "Apr 30" },
]

export const complianceTrend = [
  { month: "Sep", score: 92, incidents: 4 },
  { month: "Oct", score: 94, incidents: 3 },
  { month: "Nov", score: 91, incidents: 5 },
  { month: "Dec", score: 95, incidents: 2 },
  { month: "Jan", score: 97, incidents: 1 },
  { month: "Feb", score: 96, incidents: 2 },
]

export const jurisdictionMileage = [
  { name: "Ontario", miles: 48210 },
  { name: "Quebec", miles: 31980 },
  { name: "New York", miles: 27540 },
  { name: "Michigan", miles: 19870 },
  { name: "Ohio", miles: 14320 },
]

export const recentActivity = [
  { who: "R. Alvarez", action: "submitted trip log", target: "TRP-10482", when: "12m ago" },
  { who: "System", action: "flagged expiring", target: "Cab Card — Unit 4471", when: "1h ago" },
  { who: "M. Chen", action: "filed", target: "GST/HST Q4 2025", when: "3h ago" },
  { who: "Broker: NorthBridge", action: "renewed policy", target: "INS-2290", when: "Yesterday" },
  { who: "P. Osei", action: "added vehicle", target: "Unit 4490", when: "Yesterday" },
]

export const vehicles = [
  { unit: "4471", type: "Tractor", make: "Freightliner Cascadia", plate: "ON · CV-8842", vin: "1FUJGLDR…4471", status: "Active", tone: "ok" as const, jurisdiction: "IRP / ON" },
  { unit: "4472", type: "Tractor", make: "Kenworth T680", plate: "ON · CV-8845", vin: "1XKYD49X…4472", status: "Active", tone: "ok" as const, jurisdiction: "IRP / ON" },
  { unit: "T-220", type: "Dry Van", make: "Wabash 53'", plate: "QC · RT-2210", vin: "1JJV532B…T220", status: "Maintenance", tone: "warn" as const, jurisdiction: "IRP / QC" },
  { unit: "4488", type: "Tractor", make: "Volvo VNL 860", plate: "ON · CV-8890", vin: "4V4NC9EH…4488", status: "Active", tone: "ok" as const, jurisdiction: "IRP / ON" },
  { unit: "T-231", type: "Reefer", make: "Utility 3000R", plate: "NY · TR-9931", vin: "1UYVS253…T231", status: "Out of service", tone: "danger" as const, jurisdiction: "IRP / NY" },
  { unit: "4490", type: "Tractor", make: "Peterbilt 579", plate: "ON · CV-8901", vin: "1XPBD49X…4490", status: "Active", tone: "ok" as const, jurisdiction: "IRP / ON" },
]

export const drivers = [
  { name: "Ricardo Alvarez", cdl: "CDL-A · ON", medical: "Valid → Mar 2026", hos: "Compliant", tone: "ok" as const, trips: 42 },
  { name: "Maria Chen", cdl: "CDL-A · ON", medical: "Valid → Aug 2026", hos: "Compliant", tone: "ok" as const, trips: 38 },
  { name: "Paul Osei", cdl: "CDL-A · QC", medical: "Expiring → 12d", hos: "Compliant", tone: "warn" as const, trips: 29 },
  { name: "Dylan Reeves", cdl: "CDL-A · NY", medical: "Valid → Jun 2026", hos: "Violation", tone: "danger" as const, trips: 51 },
  { name: "Sana Malik", cdl: "CDL-A · ON", medical: "Valid → Nov 2026", hos: "Compliant", tone: "ok" as const, trips: 33 },
]

export const companies = [
  { name: "Canada Border Services Agency", kind: "Government Agency", contact: "Portal / e-manifest", region: "Federal · CA", status: "Active", tone: "ok" as const },
  { name: "NorthBridge Insurance Brokers", kind: "Insurance Broker", contact: "accounts@northbridge.example", region: "Ontario", status: "Active", tone: "ok" as const },
  { name: "Aurora Underwriting Co.", kind: "Insurance Company", contact: "claims@aurora.example", region: "National", status: "Active", tone: "ok" as const },
  { name: "U.S. Customs & Border Protection", kind: "Government Agency", contact: "ACE Portal", region: "Federal · US", status: "Active", tone: "ok" as const },
  { name: "IRP Clearinghouse", kind: "Registration Authority", contact: "support@irp.example", region: "Multi-jurisdiction", status: "Active", tone: "ok" as const },
]

export const customers = [
  { name: "Great Lakes Freight Co.", plan: "Monthly", since: "2023", contact: "ops@glfreight.example", value: "$14,200/mo", status: "Active", tone: "ok" as const },
  { name: "Maple Distribution", plan: "Monthly", since: "2022", contact: "logistics@maple.example", value: "$9,800/mo", status: "Active", tone: "ok" as const },
  { name: "Harbor Point Logistics", plan: "One-off", since: "2026", contact: "dispatch@harbor.example", value: "$3,450", status: "Project", tone: "info" as const },
  { name: "Cedar Valley Produce", plan: "Monthly", since: "2024", contact: "shipping@cedar.example", value: "$6,100/mo", status: "Past due", tone: "danger" as const },
  { name: "Summit Retail Group", plan: "One-off", since: "2026", contact: "supply@summit.example", value: "$5,900", status: "Project", tone: "info" as const },
]
