import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { splitOnLineFeed } from '../../lib/services/osm-local-data-service';

async function collect(chunks: Array<Buffer | string>): Promise<string[]> {
  const lines: string[] = [];
  for await (const line of splitOnLineFeed(Readable.from(chunks))) lines.push(line);
  return lines;
}

test('GeoJSON Sequence: U+2028/U+2029 inside a JSON string do not end the line (#833, Portugal node 5616265535)', async () => {
  const feature = JSON.stringify({ properties: { name: 'Guiga ortodontics Clinica x' } });
  const lines = await collect([`${feature}\n${feature}\n`]);
  assert.equal(lines.length, 2);
  for (const line of lines) assert.equal(JSON.parse(line).properties.name, 'Guiga ortodontics Clinica x');
});

test('GeoJSON Sequence: a multi-byte character split across chunks survives, CRLF is trimmed, last line without newline is kept', async () => {
  const bytes = Buffer.from('{"n":"Évora"}\r\n{"n":"ok"}', 'utf8');
  const lines = await collect([bytes.subarray(0, 7), bytes.subarray(7)]);
  assert.deepEqual(lines, ['{"n":"Évora"}', '{"n":"ok"}']);
});
