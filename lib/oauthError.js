'use strict';

/**
 * Returns true when Tesla reports that the current OAuth token is missing one
 * or more scopes. This commonly happens after scopes were added in the Tesla
 * Developer App but the user did not run a fresh OAuth authorization yet.
 *
 * @param {any} error Axios-style error or plain Error.
 * @returns {boolean}
 */
function isMissingScopesError(error) {
  const status = error && error.response && error.response.status;
  const responseData = error && error.response && error.response.data;
  const message = [
    responseData && responseData.error,
    responseData && responseData.error_description,
    responseData && responseData.message,
    error && error.message,
  ]
    .filter(Boolean)
    .join(' ');

  return status === 403 && /missing scopes/i.test(message);
}

/**
 * Builds the log hint shown when Tesla rejects a request because the current
 * OAuth token was authorized without the required scopes.
 *
 * @returns {string}
 */
function getMissingScopesHint() {
  return 'Tesla Fleet API reports missing OAuth scopes. If scopes were changed in the Tesla Developer App, enable "Reset Login/Token Information", save once, then generate a new Auth Link and authorize the app again.';
}

module.exports = {
  getMissingScopesHint,
  isMissingScopesError,
};
