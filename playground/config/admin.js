module.exports = ({ env }) => ({
  auth: { secret: env('ADMIN_JWT_SECRET', 'test-admin-secret') },
  apiToken: { salt: env('API_TOKEN_SALT', 'test-api-salt') },
  transfer: { token: { salt: env('TRANSFER_TOKEN_SALT', 'test-transfer-salt') } },
  secrets: { encryptionKey: env('ENCRYPTION_KEY', 'test-encryption-key') },
});
