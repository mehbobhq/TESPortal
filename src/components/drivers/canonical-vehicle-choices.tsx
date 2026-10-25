"use client";

import React, { createContext, useContext } from "react";

/**
 * When the detailed Driver Event wizards run against the canonical store (Record of Events), the power units and trailers they offer must be the company's
 * CANONICAL vehicle relationships - not whatever a browser happens to hold locally. The provider supplies them; without it the wizards keep reading the
 * browser-local vehicle store exactly as before.
 */
export type CanonicalVehicleChoice = { id: string; unitNumber: string; equipmentType: string };
export type CanonicalVehicleLists = { powerUnits: CanonicalVehicleChoice[]; trailers: CanonicalVehicleChoice[] };

const Context = createContext<CanonicalVehicleLists | null>(null);

export function CanonicalVehicleChoicesProvider({ value, children }: { value: CanonicalVehicleLists; children: React.ReactNode }) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export const useCanonicalVehicleChoices = () => useContext(Context);
