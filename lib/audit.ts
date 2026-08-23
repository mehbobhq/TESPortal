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
