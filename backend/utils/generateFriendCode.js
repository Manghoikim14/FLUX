const crypto = require('crypto');

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateFriendCode(length = 8) {
  const bytes = crypto.randomBytes(length);
  let code = '';

  for (let index = 0; index < length; index += 1) {
    code += alphabet[bytes[index] % alphabet.length];
  }

  return code;
}

module.exports = generateFriendCode;
