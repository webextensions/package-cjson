/* globals describe, it */

const packageJson = require('../index.js');       // eslint-disable-line no-unused-vars

describe('package', function() {
    describe('package-json', function() {
        // If there would be an error in require, the code would not reach this point
        it('should load fine using require', function(done) {
            done();
        });
    });
});
