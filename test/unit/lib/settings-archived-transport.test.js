/* eslint-disable no-undef */
// Real ProbotOctokit (paginate, rest methods, request serialization) with a stubbed fetch:
// proves per_page reaches the URL, Link pagination is followed, and the `archived`
// flag survives paginate's unwrapping of { total_count, repositories }.
const { ProbotOctokit } = require('probot')
const Settings = require('../../../lib/settings')

describe('archived repositories over a real Octokit (fetch stubbed)', () => {
  it('lists at 100 per page across pages, and only the active repo gets a GET', async () => {
    const requests = []
    const page1 = [{ name: 'old', owner: { login: 'org' }, archived: true }]
    const page2 = [{ name: 'live', owner: { login: 'org' }, archived: false }]
    const fetch = async (url, options) => {
      const u = new URL(url)
      requests.push(`${options.method} ${u.pathname}${u.search}`)
      let body
      const headers = { 'content-type': 'application/json' }
      if (u.pathname === '/installation/repositories') {
        if (u.searchParams.get('page') === '2') {
          body = { total_count: 2, repositories: page2 }
        } else {
          body = { total_count: 2, repositories: page1 }
          headers.link = '<https://api.github.com/installation/repositories?per_page=100&page=2>; rel="next"'
        }
      } else if (options.method === 'GET' && u.pathname === '/repos/org/live') {
        body = { name: 'live', archived: false }
      } else {
        throw new Error(`unexpected request ${options.method} ${url}`)
      }
      return new Response(JSON.stringify(body), { status: 200, headers })
    }
    const octokit = new ProbotOctokit({ auth: { token: 't' }, request: { fetch }, throttle: { enabled: false }, retry: { enabled: false } })
    const log = { debug () {}, info () {}, warn () {}, error: jest.fn() }
    const settings = new Settings(false, { payload: { installation: { id: 1 } }, octokit, log },
      { owner: 'org', repo: 'admin' }, { restrictedRepos: { exclude: [] }, repository: { has_wiki: false } }, 'main')
    settings.subOrgConfigs = {}
    settings.repoConfigs = {}
    const origRepo = Settings.PLUGINS.repository
    Settings.PLUGINS.repository = jest.fn().mockImplementation(() => ({ sync: jest.fn().mockResolvedValue([]) }))
    try {
      await settings.updateAll()
    } finally {
      Settings.PLUGINS.repository = origRepo
    }
    expect(requests).toEqual([
      'GET /installation/repositories?per_page=100',
      'GET /installation/repositories?per_page=100&page=2',
      'GET /repos/org/live'
    ])
    expect(settings.archivedSkipped.size).toBe(1)
    expect(log.error).not.toHaveBeenCalled()
  })
})
