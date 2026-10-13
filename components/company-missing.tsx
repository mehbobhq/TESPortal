export function CompanyMissing({ failed }: { failed: boolean }) {
  return failed ? (
    <div role="alert" className="p-10 text-center">
      The company could not be opened. This is a temporary or permission problem, not a missing company. Reload the page to try again.
    </div>
  ) : (
    <div className="p-10 text-center">Company not found.</div>
  )
}
