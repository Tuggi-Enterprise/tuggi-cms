/**
 * Preload of `npm run test:api`: console.log/info/debug go to stderr in every test child.
 *
 * Why: the parent runner parses child stdout as a stream of v8 frames. On Node 22.20 a stdout
 * line that starts with a non-ASCII byte (the engine logs `✅ [LocalOSMFetcher] …`) landing in
 * the same read as a report frame is read as a negative frame size, and the parent reports
 * "Unable to deserialize cloned data" on a file that passed — or dies mid-run. Measured
 * 2026-09-27: 3 of 6 full runs exited 1 this way, 0 of 10 runs of the same files alone.
 * Upstream: nodejs/node#64706 (backport to v22.x: #65934). stderr is not parsed as frames.
 * Remove once the project Node has the backport.
 */
import { Console } from 'node:console'

const toStderr = new Console({ stdout: process.stderr, stderr: process.stderr })
console.log = toStderr.log.bind(toStderr)
console.info = toStderr.info.bind(toStderr)
console.debug = toStderr.debug.bind(toStderr)
