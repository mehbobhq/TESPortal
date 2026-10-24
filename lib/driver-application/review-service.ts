import "server-only"
import type { PoolClient } from "pg"
import { withAuthorizedSystem, type SystemAuthorizationDecision } from "@/lib/auth/tes-system-context"
import { PostgresMasterRegisterRepository } from "@/lib/master-register/postgres-repository"
import type { ProspectContext } from "@/lib/driver-prospects/operations"
import * as review from "./review"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { buildDossierInput } from "./dossier"
import { renderApplicationPdf } from "./pdf/render"

const context = (client: PoolClient, decision: SystemAuthorizationDecision): ProspectContext => ({
  client,
  actor: { id: decision.actor.id, actorType: decision.actor.actorType },
  masterRegister: new PostgresMasterRegisterRepository(client),
})

export const getApplicationReview = (input: { organizationId: string; prospectId: string }) =>
  withAuthorizedSystem("DRIVER_READ", (c, d) => review.getApplicationReview(context(c, d), d, input))
export const recordVerification = (input: Parameters<typeof review.recordVerification>[1]) =>
  withAuthorizedSystem("DRIVER_MANAGE", (c, d) => review.recordVerification(context(c, d), input))
export const recordDecision = (input: Parameters<typeof review.recordDecision>[1]) =>
  withAuthorizedSystem("DRIVER_MANAGE", (c, d) => review.recordDecision(context(c, d), input))
export const recordCorrection = (input: Parameters<typeof review.recordCorrection>[1]) =>
  withAuthorizedSystem("DRIVER_MANAGE", (c, d) => review.recordCorrection(context(c, d), input))
export const revealSensitive = (input: Parameters<typeof review.revealSensitive>[2]) =>
  withAuthorizedSystem("DRIVER_READ", (c, d) => review.revealSensitive(context(c, d), d, input))
export const authorizeDocumentView = (input: Parameters<typeof review.authorizeDocumentView>[2]) =>
  withAuthorizedSystem("DRIVER_READ", (c, d) => review.authorizeDocumentView(context(c, d), d, input))
export const getHrProfile = (organizationId: string) => withAuthorizedSystem("DRIVER_READ", (c, d) => review.getHrProfile(context(c, d), organizationId))
export const saveHrProfile = (input: Parameters<typeof review.saveHrProfile>[1]) => withAuthorizedSystem("DRIVER_MANAGE", (c, d) => review.saveHrProfile(context(c, d), input))

/** The carrier dossier PDF of one submitted application: the applicant's declaration unchanged plus the carrier's separate review record. Generated on demand and never stored as the applicant's copy. */
export const getCarrierDossierPdf = (input: { organizationId: string; prospectId: string; applicationId: string }) =>
  withAuthorizedSystem("DRIVER_READ", async (c, d) => {
    const ctx = context(c, d)
    const reviewed = await review.getApplicationReview(ctx, d, { organizationId: input.organizationId, prospectId: input.prospectId })
    const app = reviewed.applications.find((a) => a.id === input.applicationId)
    if (!app) throw new Error("Application not found.")
    const extra = await review.loadDossierContext(ctx, input.organizationId, input.applicationId)
    const logoPng = await readFile(join(process.cwd(), "public", "branding", "TES-Logo.png")).then((b) => new Uint8Array(b)).catch(() => null)
    const bytes = await renderApplicationPdf(buildDossierInput(app, { ...extra, canSeeSensitive: reviewed.canSeeSensitive, preparedAt: new Date().toISOString(), preparedBy: `Staff actor ${d.actor.id}`, logoPng }))
    return { bytes, receiptId: app.receiptId }
  })
