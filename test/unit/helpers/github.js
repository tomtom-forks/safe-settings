// Test seam for plugin and whole-run tests: Probot's own ProbotOctokit, with
// throttling and retries turned off, on nock. Nock intercepts the client's
// fetch, so a test lists the requests it expects and fails on any other.
const nock = require('nock')
const { ProbotOctokit } = require('probot')

const API = 'https://api.github.com'

function createOctokit (options = {}) {
  return new ProbotOctokit({
    auth: { token: 'test-token' },
    baseUrl: API,
    throttle: { enabled: false },
    retry: { enabled: false },
    log: { debug () {}, info () {}, warn () {}, error () {}, trace () {}, fatal () {}, child () { return this } },
    ...options
  })
}

// Every logical request the client makes, as { method, url, status }, in order.
function recordRequests (octokit) {
  const requests = []
  octokit.hook.after('request', (response, options) => {
    requests.push({ method: options.method, url: options.url, status: response.status })
  })
  octokit.hook.error('request', (error, options) => {
    requests.push({ method: options.method, url: options.url, status: error.status })
    throw error
  })
  return requests
}

function api () {
  return nock(API)
}

module.exports = { API, createOctokit, recordRequests, api }
