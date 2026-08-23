// lib/audit.ts

export type AccessEvent = {
  actor: string;
  role: string;
  client: string;
  action: 'VIEW' | 'CREATE' | 'UPLOAD' | 'AMEND' | 'VERIFY' | 'ARCHIVE';
  resource: string; // e.g., "Driver -> David Smith"
  ipAddress: string;
  sessionId: string;
};

export type DataEvent = {
  entityId: string;
  entityType: 'Company' | 'Driver' | 'Vehicle' | 'Contact' | 'Document';
  previousState: any;
  newState: any;
  reason?: string;
};

/**
 * Immutable Master Register: Access Logger
 * Records who was looking at what, under what authority, and when.
 */
export async function logAccessEvent(event: AccessEvent) {
  const timestamp = new Date().toISOString();
  
  // In production, this writes directly to your append-only Master Register database table.
  // It CANNOT be edited or deleted by anyone, including the Super Admin.
  console.log(`[MASTER REGISTER - ACCESS] ${timestamp} | Actor: ${event.actor} | Role: ${event.role} | Action: ${event.action} | Resource: ${event.resource} | IP: ${event.ipAddress}`);
  
  // TODO: Insert into database
}

/**
 * Immutable Master Register: Data Logger
 * Records system changes. Never modifies original records.
 */
export async function logDataEvent(event: DataEvent, accessContext: AccessEvent) {
  const timestamp = new Date().toISOString();
  
  console.log(`[MASTER REGISTER - DATA] ${timestamp} | Entity: ${event.entityId} | Action: ${accessContext.action} | Reason: ${event.reason || 'N/A'}`);
  
  // TODO: Insert into database
}

// lib/audit.ts

/**
 * DEVELOPMENT ONLY: Hard Delete
 * This function bypasses the Master Register and deletes a record completely.
 * It will throw a fatal error if executed in a production environment.
 */
export async function devOnlyHardDelete(entityId: string, entityType: string) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`CRITICAL SECURITY VIOLATION: Hard deletion of ${entityType} ${entityId} attempted in production. Use archiveRecord instead.`);
  }

  console.warn(`[DEV MODE] ⚠️ Hard deleting ${entityType} record: ${entityId}`);
  
  // TODO: Execute your actual DB delete query here during development
  // db.delete(entityType).where(id === entityId)
  
  return { success: true, message: "Record permanently deleted (DEV MODE ONLY)." };
}
