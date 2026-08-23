"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "motion/react"
import { ShieldAlert, FileText, CheckCircle2, ChevronRight, UploadCloud } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

// Simulated Discovery Loop Data
const initialInsights = [
  {
    id: "insight-1",
    entity: "Driver: David Smith",
    type: "Documentation Gap",
    description: "Medical Certificate expires in 12 days. Uploading the renewal will boost fleet readiness by 2%.",
    tone: "warn",
    action: "Upload Medical",
  },
  {
    id: "insight-2",
    entity: "Vehicle: Unit 104",
    type: "Compliance Risk",
    description: "Annual CVIP Inspection is missing. This exposes operations to a potential roadside violation.",
    tone: "danger",
    action: "Log Inspection",
  }
]

export function DiscoveryFeed() {
  const [insights, setInsights] = useState(initialInsights)

  // The "Inbox Zero" satisfaction interaction
  const handleResolve = (id: string) => {
    setInsights((prev) => prev.filter((item) => item.id !== id))
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-slate-800 tracking-tight">Actionable Insights</h2>
          <p className="text-slate-500 text-sm mt-1">Discover opportunities to improve your compliance posture.</p>
        </div>
        <div className="flex items-center gap-2 bg-emerald-50 text-emerald-700 px-4 py-2 rounded-full text-sm font-medium border border-emerald-100">
          <CheckCircle2 className="size-4" />
          <span>Fleet Readiness: {insights.length === 0 ? "100%" : "94%"}</span>
        </div>
      </div>

      <div className="space-y-4">
        <AnimatePresence>
          {insights.length === 0 ? (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }} 
              animate={{ opacity: 1, scale: 1 }} 
              className="bg-slate-50 border border-slate-200 rounded-2xl p-12 text-center flex flex-col items-center justify-center"
            >
              <div className="bg-white p-4 rounded-full shadow-sm mb-4">
                <CheckCircle2 className="size-8 text-emerald-500" />
              </div>
              <h3 className="text-lg font-medium text-slate-800">You are entirely up to date</h3>
              <p className="text-slate-500 text-sm mt-2 max-w-md">Your fleet is operating at peak compliance. The system will continuously monitor for emerging patterns or risks.</p>
            </motion.div>
          ) : (
            insights.map((insight) => (
              <motion.div
                key={insight.id}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -20, scale: 0.98 }}
                transition={{ duration: 0.2 }}
              >
                <Card className="overflow-hidden border-slate-100 shadow-sm hover:shadow-md transition-shadow duration-200">
                  <CardContent className="p-0">
                    <div className="flex flex-col sm:flex-row sm:items-center">
                      {/* Left: Soft Status Indicator */}
                      <div className={`p-6 flex items-center justify-center border-b sm:border-b-0 sm:border-r border-slate-100 ${insight.tone === 'warn' ? 'bg-amber-50/50' : 'bg-red-50/50'}`}>
                        {insight.tone === 'warn' ? (
                          <FileText className="size-6 text-amber-600" />
                        ) : (
                          <ShieldAlert className="size-6 text-red-600" />
                        )}
                      </div>
                      
                      {/* Middle: Clear Explanation */}
                      <div className="p-6 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">{insight.type}</span>
                          <span className="text-slate-300">•</span>
                          <span className="text-sm font-medium text-slate-700">{insight.entity}</span>
                        </div>
                        <p className="text-slate-600 text-sm leading-relaxed">{insight.description}</p>
                      </div>

                      {/* Right: Low-Friction Action */}
                      <div className="p-6 bg-slate-50/50 flex items-center justify-end sm:border-l border-slate-100">
                        <Button 
                          onClick={() => handleResolve(insight.id)}
                          className="bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 hover:text-slate-900 shadow-sm w-full sm:w-auto"
                        >
                          <UploadCloud className="mr-2 size-4 text-slate-400" />
                          {insight.action}
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
