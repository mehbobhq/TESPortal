import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'

const isSpecialAccessRoute = createRouteMatcher([
  '/driver-application(.*)',
  '/api/driver-applications/submissions',
])

export default clerkMiddleware(async (auth, request) => {
  // These routes enforce their own access boundary:
  // - /driver-application uses a signed TES invitation token.
  // - submissions POST uses that invitation token; GET requires Clerk in the route handler.
  if (isSpecialAccessRoute(request)) return

  await auth.protect()
})

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
}
