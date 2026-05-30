import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Routes that REQUIRE auth. Everything else is public (landing + sign-in/up).
const isProtectedRoute = createRouteMatcher([
  "/buy(.*)",
  "/dashboard(.*)",
  "/api/parse(.*)",
  "/api/checkout(.*)",
  "/api/me(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Skip Next internals + static files
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
