/**
 * The composer's "Destino no app" (#860, spec `design` §5): a closed list, required, and the
 * link it produces is the one the app routes. Pure module — no network, no mocks.
 *
 * Run with: npm run test:api
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  APP_DESTINATIONS,
  DESTINATION_CHOICES,
  destinationKey,
  destinationLink,
  isHttpsUrl,
} from '../../lib/notifications/app-destination';

test('#860 §5: the closed list is exactly the seven app routes plus the external link', () => {
  assert.deepEqual([...APP_DESTINATIONS], ['/map', '/guide-start', '/earn', '/stamps', '/ranking', '/plans', '/trips']);
  assert.equal(DESTINATION_CHOICES[DESTINATION_CHOICES.length - 1], 'external');
  assert.equal(DESTINATION_CHOICES.length, 8);
});

test('an app route travels as tuggi://<route>, the scheme the app remaps hostname → path', () => {
  assert.equal(destinationLink('/map', ''), 'tuggi://map');
  assert.equal(destinationLink('/guide-start', 'https://ignored.example'), 'tuggi://guide-start');
  assert.equal(destinationLink('/trips', ''), 'tuggi://trips');
});

test('no choice, or external without an http(s) URL, yields null — the send stays blocked', () => {
  assert.equal(destinationLink('', 'https://tuggi.app'), null);
  assert.equal(destinationLink('external', ''), null);
  assert.equal(destinationLink('external', 'tuggi.app/promo'), null);
  assert.equal(destinationLink('external', 'javascript:alert(1)'), null);
  assert.equal(destinationLink('external', '  https://tuggi.app/promo  '), 'https://tuggi.app/promo');
});

test('#860 §3.D: data.image_url is accepted only as https', () => {
  assert.equal(isHttpsUrl('https://cdn.example.com/a.png'), true);
  assert.equal(isHttpsUrl('http://cdn.example.com/a.png'), false);
  assert.equal(isHttpsUrl('data:image/png;base64,AAAA'), false);
  assert.equal(isHttpsUrl('not a url'), false);
});

test('every choice has an i18n key segment without slash or hyphen', () => {
  assert.deepEqual(
    DESTINATION_CHOICES.map(destinationKey),
    ['map', 'guide_start', 'earn', 'stamps', 'ranking', 'plans', 'trips', 'external']
  );
});
