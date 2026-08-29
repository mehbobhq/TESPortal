/**
 * Generic Permission & Access Control Interface for TES Compliance Portal.
 * Pure interface and type contract for future server authorization.
 *
 * NOTE: Client-side evaluation is for UI visual affordance only and DOES NOT provide security.
 * Full authorization enforcement must execute on backend API routes and secure databases.
 */

export type TESRole =
  | "SafetyDirector"
  | "ComplianceOfficer"
  | "Dispatcher"
  | "FleetManager"
  | "Accountant"
  | "Auditor"
  | "ReadOnlyViewer";

export type ComplianceAction =
  | "VIEW"
  | "CREATE"
  | "UPDATE"
  | "ARCHIVE"
  | "DELETE"
  | "VERIFY_EVIDENCE"
  | "REJECT_EVIDENCE"
  | "OVERRIDE_OCR"
  | "EXPORT_AUDIT_PACKAGE"
  | "VIEW_SENSITIVE_FIELD";

export interface PermissionActor {
  id: string;
  name: string;
  email: string;
  role: TESRole;
  department?: string;
  companyId?: string;
  assignedJurisdictions?: string[];
}

export interface PermissionContext {
  actor: PermissionActor;
  targetCompanyId?: string;
  targetEntityType: string;
  targetEntityId?: string;
  action: ComplianceAction;
  fieldKey?: string;
  isSensitiveField?: boolean;
}

export interface AuthorizationResult {
  isAllowed: boolean;
  reason?: string;
}

export interface AuthorizationService {
  canPerformAction: (context: PermissionContext) => Promise<AuthorizationResult> | AuthorizationResult;
  canViewSensitiveField: (actor: PermissionActor, entityType: string, fieldKey: string) => boolean;
}
