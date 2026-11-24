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

// A fake GitHub for whole-run tests. Routes answer by method and path; every
// request is recorded, and a request without a route answers 418 and shows in
// the counts, so a test that lists the requests it expects fails on any extra.
function fakeGitHub () {
  const routes = []
  const calls = []
  const METHODS = ['get', 'put', 'post', 'patch', 'delete']

  const handle = method => function (uri, body) {
    const [path, qs] = uri.split('?')
    const query = Object.fromEntries(new URLSearchParams(qs || ''))
    const call = { method, path, query, body }
    calls.push(call)
    const route = routes.find(r => r.method === method && (r.path instanceof RegExp ? r.path.test(path) : r.path === path))
    if (!route) {
      return [418, { message: `no route in the test for ${method} ${path}` }]
    }
    const answer = typeof route.reply === 'function' ? route.reply(call) : route.reply
    const [status, payload, headers] = answer
    return [status, payload === undefined ? '' : payload, { 'content-type': 'application/json', ...headers }]
  }

  const scope = nock(API).persist()
  for (const method of METHODS) {
    scope.intercept(/.*/, method.toUpperCase()).reply(handle(method.toUpperCase()))
  }

  return {
    calls,
    // on('GET', '/repos/o/r', [200, body, headers]) or on(..., call => [status, body, headers])
    // A route registered later answers before an earlier one for the same request, so a test can
    // set up the common case and then override one answer.
    on (method, path, reply) {
      routes.unshift({ method, path, reply })
      return this
    },
    // { 'GET /repos/o/r': 1, ... } over every request made so far, query strings left out
    counts () {
      const counts = {}
      for (const { method, path } of calls) {
        counts[`${method} ${path}`] = (counts[`${method} ${path}`] || 0) + 1
      }
      return counts
    },
    writes () {
      return calls.filter(c => c.method !== 'GET')
    }
  }
}

// A Settings instance on a client, with the config files already loaded
// (as the existing archived-transport test does), ready for updateAll() or updateRepos().
function newSettings ({ config, nop = false, octokit, subOrgConfigs = {}, repoConfigs = {}, payload = {} }) {
  const Settings = require('../../../lib/settings')
  const log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  const admin = { owner: 'o', repo: 'admin' }
  const context = { payload: { installation: { id: 1 }, ...payload }, octokit, log, repo: () => admin }
  const settings = new Settings(nop, context, admin, config, 'main')
  settings.subOrgConfigs = subOrgConfigs
  settings.repoConfigs = repoConfigs
  return { settings, log }
}

// GET /installation/repositories, one page
function installationRepos (gh, repos) {
  gh.on('GET', '/installation/repositories', [200, {
    total_count: repos.length,
    repositories: repos.map(({ name, archived = false }) => ({ name, archived, owner: { login: 'o' } }))
  }])
}

module.exports.fakeGitHub = fakeGitHub
module.exports.newSettings = newSettings
module.exports.installationRepos = installationRepos
