const path = require('path');

module.exports = () => ({
  'backfill-db-migrations': {
    enabled: true,
    // Pointing at package.json (not the directory) so Strapi's plugin loader,
    // which calls `require.resolve` and then `path.dirname`, lands on the
    // repo root rather than on the dist entrypoint's parent.
    resolve: path.resolve(__dirname, '..', '..', 'package.json'),
    config: {
      // Tests toggle this and inject migrations directly under
      // playground/database/migrations-post.
      autoRun: true,
    },
  },
});
