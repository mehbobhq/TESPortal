/**
 * Compile-time-only proof of the capability typing. Contains no runtime assertions and is not executed by
 * `node --test`: it is checked by `tsc --noEmit`, which must fail if any `@ts-expect-error` below stops being a real
 * type error (meaning the typo / scope protection silently broke).
 */

import type { withAuthorizedCustomer } from "@/lib/auth/tes-customer-context";
import type { withAuthorizedSystem } from "@/lib/auth/tes-system-context";
import type { TesCapability, TesCustomerCapability, TesSystemCapability } from "@/lib/auth/tes-capabilities";

type SystemParam = Parameters<typeof withAuthorizedSystem>[0];
type CustomerParam = Parameters<typeof withAuthorizedCustomer>[1];

// The wrappers accept exactly the capabilities declared for their scope.
const system: SystemParam = "ORGANIZATION_CREATE";
const customer: CustomerParam = "ORGANIZATION_READ";
const exactSystem: TesSystemCapability = system;
const exactCustomer: TesCustomerCapability = customer;

// @ts-expect-error - a typo'd capability name is a compile error.
const typo: TesCapability = "ORGANIZTION_UPDATE";

// @ts-expect-error - a plain string is not a capability.
const plainString: SystemParam = "ORGANIZATION_CREATE" as string;

// @ts-expect-error - a CUSTOMER-scoped capability cannot be passed to the SYSTEM wrapper.
const customerOnSystem: SystemParam = "ORGANIZATION_READ";

// @ts-expect-error - a SYSTEM-scoped capability cannot be passed to the CUSTOMER wrapper.
const systemOnCustomer: CustomerParam = "ORGANIZATION_CREATE";

// @ts-expect-error - CUSTOMER_CREATE was replaced by CUSTOMER_ESTABLISH and must not exist.
const removed: TesCapability = "CUSTOMER_CREATE";

// @ts-expect-error - there is deliberately no Organization delete capability.
const noDelete: TesCapability = "ORGANIZATION_DELETE";

// @ts-expect-error - lowercase is not a capability.
const lower: TesCapability = "organization_read";

void [exactSystem, exactCustomer, typo, plainString, customerOnSystem, systemOnCustomer, removed, noDelete, lower];
