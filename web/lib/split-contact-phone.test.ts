import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { splitDeviceContactPhone } from '@/lib/split-contact-phone';

describe('splitDeviceContactPhone', () => {
  it('uses an explicit international dial code from a device contact', () => {
    assert.deepEqual(splitDeviceContactPhone('+60 12-345 6789', '+62'), {
      countryCode: '+60',
      phone: '123456789',
    });
  });

  it('uses the signed-in user country for a national number', () => {
    assert.deepEqual(splitDeviceContactPhone('0812-3456-7890', '+62'), {
      countryCode: '+62',
      phone: '081234567890',
    });
  });

  it('does not duplicate the fallback dial code when it is already present', () => {
    assert.deepEqual(splitDeviceContactPhone('6281234567890', '+62'), {
      countryCode: '+62',
      phone: '81234567890',
    });
  });
});
