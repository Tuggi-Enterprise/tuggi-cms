/**
 * `config.matcher` in `proxy.ts` — the line that decides whether the proxy runs at all — and
 * the locale redirect that depends on it.
 *
 * Why this file exists: a matcher that selects nothing makes Next skip the proxy and answer 404
 * on every localized route. The symptom reads like a broken `pathnames` map and sends the next
 * person to the wrong file entirely. Opening the home proves nothing, because `/` is a separate
 * entry in the array and survives a broken third entry. What proves it is a URL WITHOUT a locale
 * prefix, so that is what these cases exercise, in both halves of the trip:
 *
 *   1. the matcher selects the locale-less path — otherwise the proxy never runs;
 *   2. `proxy()` answers 307 to the same path under the default locale.
 *
 * Both halves are needed. Calling `proxy()` directly stays green even when the matcher selects
 * nothing, and the matcher alone does not prove the redirect.
 *
 * The matching half goes through `unstable_doesMiddlewareMatch`, Next's own testing entry point:
 * it is the same pair of functions the dev server and the build use to compile and apply the
 * matcher, so these cases move with the installed Next version instead of re-implementing its
 * regexp compilation — which is the only way the test could agree with a bug.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { unstable_doesMiddlewareMatch } from 'next/dist/experimental/testing/server/middleware-testing-utils'
import { config, proxy } from '@/proxy'

function reachesProxy(pathname: string): boolean {
  return unstable_doesMiddlewareMatch({
    config: { matcher: [...config.matcher] },
    url: `http://localhost${pathname}`,
  })
}

test('CMS proxy: routes with no locale prefix reach the proxy', () => {
  for (const pathname of ['/dashboard', '/login', '/pois/42', '/clients/7/contracts']) {
    assert.equal(reachesProxy(pathname), true, `${pathname} must reach the proxy, or Next 404s it`)
  }
})

test('CMS proxy: the root and the prefixed routes reach the proxy', () => {
  for (const pathname of ['/', '/en/dashboard', '/pt/login', '/es/pois/42']) {
    assert.equal(reachesProxy(pathname), true, `${pathname} must reach the proxy`)
  }
})

test('CMS proxy: api, framework and dotted paths do not reach the proxy', () => {
  // `/favicon.ico` and `/robots.txt` pin the shape of the dot lookahead: it has to be `.*[.].*`.
  // A lookahead anchored at the start (`[.].*`) only excludes paths that BEGIN with a dot, and
  // then next-intl redirects the favicon to `/en/favicon.ico`.
  for (const pathname of [
    '/api/pois',
    '/_next/static/chunks/main.js',
    '/_vercel/insights/view',
    '/favicon.ico',
    '/robots.txt',
    '/sitemap.xml',
  ]) {
    assert.equal(reachesProxy(pathname), false, `${pathname} must not reach the proxy`)
  }
})

test('CMS proxy: a locale-less URL answers 307 to the same path under the default locale', async () => {
  const response = await proxy(new NextRequest('http://localhost/dashboard'))

  assert.equal(response.status, 307, 'a direct link without a locale must redirect, not 404')
  assert.equal(response.headers.get('location'), 'http://localhost/en/dashboard')
})

test('CMS proxy: the locale redirect keeps the query string', async () => {
  // Links shared inside the team carry filters. Dropping them turns a precise link into a list
  // from page one, and nothing errors to say so.
  const response = await proxy(new NextRequest('http://localhost/pois?city=buzios&page=3'))

  assert.equal(response.status, 307)
  assert.equal(response.headers.get('location'), 'http://localhost/en/pois?city=buzios&page=3')
})
