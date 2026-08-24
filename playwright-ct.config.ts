import { defineConfig, devices } from '@playwright/experimental-ct-react'
import path from 'path'

/**
 * Component tests for the partnerships pipeline (#359) — real Chromium, real Tailwind output
 * (this config points at the SAME `postcss.config.js` / `tailwind.config.js` the app builds
 * with, so `text-primary-800` resolves to the actual `#00719F` the operator sees), real
 * `axe-core`, but WITHOUT going through `proxy.ts`.
 *
 * WHY NOT A FULL PAGE NAVIGATION. `proxy.ts` calls `supabase.auth.getUser()` against the real
 * project on every request to `/admin/*` and redirects to `/login` with no session — that call
 * happens on the Next.js SERVER, so `page.route` (a BROWSER network hook) cannot intercept it,
 * and this suite has no CMS credential to sign in with for real. Manufacturing one, or teaching
 * `proxy.ts`/`lib/roles.ts` to recognise a test bypass, is an auth-code change the security
 * gate (CLAUDE.md §2) has to see BEFORE merge — out of reach for a same-branch QA pass. Mounting
 * `PartnershipsQueue` / `PartnershipDetail` directly is the same components, the same CSS, the
 * same DOM the operator gets; what is absent is the unrelated question "is this session valid",
 * which criteria 7/23/24/25/26/27/28 never asked.
 */
export default defineConfig({
  testDir: './tests/ct',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  timeout: 30_000,
  use: {
    trace: 'retain-on-failure',
    ctViteConfig: {
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        },
      },
      // `PartnershipDetail` pulls in `PlaceFormModal`, which builds a Supabase browser client
      // at module scope (`lib/core/supabase-client.ts`) even though this suite never opens the
      // modal or calls a Supabase method. Vite does not read `.env`'s `NEXT_PUBLIC_*` names on
      // its own (that convention is Next's), so without this the client constructor throws
      // before React ever renders. The values are throwaway — no request carrying them is ever
      // made, mocked or otherwise.
      define: {
        'process.env.NEXT_PUBLIC_SUPABASE_URL': JSON.stringify('https://ct-fixture.supabase.co'),
        'process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY': JSON.stringify('ct-fixture-key'),
      },
    },
  },
  projects: [
    {
      name: 'chromium',
      // The mobile suite states its own viewport as the whole point of its assertions; running
      // it here too would measure a 1280px window against a 390px expectation.
      testIgnore: /\.mobile\.spec\.tsx$/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      /**
       * THE PHONE, and it is a project rather than a `page.setViewportSize` inside the tests.
       *
       * `ClientBoard` chooses its tree from `window.matchMedia('(min-width: 1024px)')` at mount
       * — `@dnd-kit` mounts on a monitor and does not on a phone — so the viewport has to be
       * right BEFORE the component mounts, not resized after it. A project fixes it for the
       * whole run.
       *
       * 390×844 is the iPhone 14/15/16 logical viewport, which is the narrow end of what the
       * commercial team actually carries. `hasTouch` matters for the same reason the width
       * does: `pointer: coarse` is what tells the browser which hover styles to skip.
       */
      name: 'mobile-390',
      testMatch: /\.mobile\.spec\.tsx$/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
      },
    },
  ],
})
