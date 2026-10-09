import { after, afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cachedDownload } from '../../lib/services/dem/obstacle-prepare'

// TP engine, EP — the raw source cache `_sources/` is shared by the cells of a batch (#831):
// neighbouring cells read the same canopy tile and the same building zip. Two cells prepared at
// once used to write the same fixed `.part` and corrupt it. INV-EPb: a source that does not match
// its publisher never reaches the final name. No network: fetch is replaced.

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-ep-lock-'))
after(() => fs.rmSync(tmp, { recursive: true, force: true }))
const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

const BODY = Buffer.from('x'.repeat(256 * 1024))
const md5 = (b: Buffer) => createHash('md5').update(b).digest('hex')

/** Serves `body` in small chunks with a pause between them, counting the requests. */
function slowFetch(body: Buffer) {
  const calls = { n: 0 }
  globalThis.fetch = (async () => {
    calls.n++
    let i = 0
    const stream = new ReadableStream<Uint8Array>({
      async pull(ctrl) {
        if (i >= body.length) return ctrl.close()
        await new Promise(r => setTimeout(r, 5))
        ctrl.enqueue(new Uint8Array(body.subarray(i, i + 16 * 1024)))
        i += 16 * 1024
      },
    })
    return new Response(stream, { status: 200 })
  }) as typeof fetch
  return calls
}

const leftovers = (dir: string) => [
  ...fs.readdirSync(dir).filter(f => f.endsWith('.part')),
  ...(fs.existsSync(path.join(dir, '_locks')) ? fs.readdirSync(path.join(dir, '_locks')) : []),
]

describe('INV-EPb (#831) — the source cache is safe with cells prepared in parallel', () => {
  it('INV-EPb: two cells asking for the same tile at once download it once, whole, and leave no part or lock', async () => {
    const dir = path.join(tmp, 'meta-chm-a')
    const file = path.join(dir, '120210.tif')
    const calls = slowFetch(BODY)
    await Promise.all([
      cachedDownload('https://example.test/120210.tif', file, { size: BODY.length, md5: md5(BODY) }),
      cachedDownload('https://example.test/120210.tif', file, { size: BODY.length, md5: md5(BODY) }),
    ])
    assert.equal(calls.n, 1, 'the second cell waited for the first one and reused its file')
    assert.equal(md5(fs.readFileSync(file)), md5(BODY))
    assert.deepEqual(leftovers(dir), [])
  })

  it('INV-EPb: a download that does not match the publisher never takes the final name', async () => {
    const dir = path.join(tmp, 'meta-chm-b')
    const file = path.join(dir, '120211.tif')
    slowFetch(BODY.subarray(0, 1000))
    await assert.rejects(cachedDownload('https://example.test/120211.tif', file, { size: BODY.length }), /size or MD5 does not match/)
    assert.equal(fs.existsSync(file), false)
    assert.deepEqual(leftovers(dir), [])
  })

  it('INV-EPb: the lock of a worker that died is taken over', async () => {
    const dir = path.join(tmp, 'globfp-c')
    const file = path.join(dir, 'cell.zip')
    const dead = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))']).stdout.toString()
    fs.mkdirSync(path.join(dir, '_locks'), { recursive: true })
    fs.writeFileSync(path.join(dir, '_locks', 'cell.zip.lock'), JSON.stringify({ pid: Number(dead), host: os.hostname() }))
    const calls = slowFetch(BODY)
    await cachedDownload('https://example.test/cell.zip', file, { size: BODY.length })
    assert.equal(calls.n, 1)
    assert.equal(fs.statSync(file).size, BODY.length)
    assert.deepEqual(leftovers(dir), [])
  })
})
