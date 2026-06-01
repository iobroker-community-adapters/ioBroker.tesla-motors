'use strict';

const { expect } = require('chai');
const { getMissingScopesHint, isMissingScopesError } = require('./lib/oauthError');

describe('OAuth error helper', () => {
  it('detects Tesla missing-scope responses', () => {
    expect(
      isMissingScopesError({
        response: {
          status: 403,
          data: {
            response: null,
            error: 'Unauthorized missing scopes',
            error_description: '',
          },
        },
      }),
    ).to.equal(true);
  });

  it('does not treat unrelated authorization errors as missing scopes', () => {
    expect(isMissingScopesError({ response: { status: 403, data: { error: 'Forbidden' } } })).to.equal(false);
    expect(isMissingScopesError({ response: { status: 401, data: { error: 'Unauthorized missing scopes' } } })).to.equal(false);
  });

  it('explains that changing scopes requires a fresh OAuth authorization', () => {
    expect(getMissingScopesHint()).to.include('Reset Login/Token Information');
    expect(getMissingScopesHint()).to.include('authorize the app again');
  });
});
