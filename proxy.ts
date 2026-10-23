import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'

const isSpecialAccessRoute = createRouteMatcher([
  '/driver-application(.*)',
  '/api/driver-applications/session',
  '/api/driver-applications/application',
  '/api/driver-applications/draft',
  '/api/driver-applications/sensitive',
  '/api/driver-applications/consents/(.*)',
  '/api/driver-applications/uploads',
  '/api/driver-applications/submit',
])

export default clerkMiddleware(async (auth, request) => {
  // These routes enforce their own access boundary:
  // - /driver-application and the applicant API authenticate with a server-side applicant session opened from the invitation secret
  //   (HttpOnly cookie + CSRF header, enforced inside each handler by withApplicantSession). Staff routes remain behind Clerk.
  if (isSpecialAccessRoute(request)) return

  await auth.protect()
})

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
}
