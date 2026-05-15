/* globals describe, it */

import '../index.js';

describe('package', function() {
    describe('package-json', function() {
        // If there would be an error in import, the code would not reach this point
        it('should load fine using import', function(done) {
            done();
        });
    });
});
