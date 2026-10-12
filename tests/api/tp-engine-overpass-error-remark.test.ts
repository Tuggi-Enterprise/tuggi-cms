import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isOverpassErrorBody } from '../../lib/services/trigger-points-google/core/boundary-detector';

// BR-POI-010 / INV-E1c: an overloaded Overpass answers 200 with an error remark and no elements.
// Read as an answer, the own-id lookup says "gone" and the regen overwrites good TPs.
describe('Overpass 200 with an error remark is a failed try, not an answer (BR-POI-010)', () => {
  it('BR-POI-010: a runtime-error timeout remark is an error body', () => {
    const body = '{"version":0.6,"elements":[],"remark":"runtime error: Query timed out in \\"query\\" at line 3 after 31 seconds."}';
    assert.equal(isOverpassErrorBody(body), true);
  });

  it('BR-POI-010: an out-of-memory remark is an error body', () => {
    const body = '{"elements":[],"remark":"runtime error: Query run out of memory using about 2048 MB of RAM."}';
    assert.equal(isOverpassErrorBody(body), true);
  });

  it('BR-POI-010: an empty answer without a remark is a real answer (the element is gone)', () => {
    assert.equal(isOverpassErrorBody('{"version":0.6,"elements":[]}'), false);
  });

  it('BR-POI-010: an answer with elements is a real answer', () => {
    assert.equal(isOverpassErrorBody('{"elements":[{"type":"way","id":178591256}]}'), false);
  });
});
