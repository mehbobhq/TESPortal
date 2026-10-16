import React from "react"
export function ClerkProvider({ children }) { return React.createElement(React.Fragment, null, children) }
export function useClerk() { return { signOut() {} } }
