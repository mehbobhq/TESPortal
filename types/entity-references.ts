/**
 * Canonical Entity References & Linkage Interfaces
 * Supports loose coupling between compliance modules without duplicate data cloning.
 */

export type EntityType =
  | "Company"
  | "Contact"
  | "Driver"
  | "Vehicle"
  | "Insurer"
  | "Broker"
  | "Vendor"
  | "RepairShop"
  | "Authority";

export interface CanonicalEntityReference {
  entityType: EntityType;
  id: string;
  label: string;
  secondaryText?: string;
  status?: string;
  jurisdiction?: string;
}

export interface OrganizationReference {
  id: string;
  name: string;
  kind?: "Carrier" | "Customer" | "Broker" | "Insurer" | "Vendor";
  jurisdiction?: string;
  country?: "Canada" | "United States";
}

export interface ContactReference {
  id: string;
  organizationId: string;
  name: string;
  title?: string;
  email?: string;
  phone?: string;
}

export interface VehicleReference {
  id: string;
  companyId: string;
  unitNumber: string;
  vin: string;
  equipmentType: string;
  plateNumber?: string;
}
