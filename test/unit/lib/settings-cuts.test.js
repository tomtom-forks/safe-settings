/* eslint-disable no-undef */
// Whole runs of the real Settings against a fake GitHub on nock: every request of a run is
// counted, and its NOP rows are read. Slice 1's cuts: no write that changes nothing, and one
// read per repo, per security-manager list and per team's grants.
const nock = require('nock')
const { createOctokit, fakeGitHub, newSettings, installationRepos } = require('../helpers/github')

const flag = enabled => ({ url: 'https://api.github.com/x', enabled })

// What GET protection returns on GitHub, for a branch that matches protection() below
const liveProtection = (overrides = {}) => ({
  url: 'https://api.github.com/x',
  required_pull_request_reviews: { url: 'https://api.github.com/x', dismiss_stale_reviews: false, require_code_owner_reviews: false, required_approving_review_count: 1 },
  enforce_admins: flag(true),
  required_linear_history: flag(false),
  allow_force_pushes: flag(false),
  allow_deletions: flag(false),
  block_creations: flag(false),
  required_conversation_resolution: flag(false),
  lock_branch: flag(false),
  allow_fork_syncing: flag(false),
  ...overrides
})

const protection = (overrides = {}) => ({
  required_status_checks: null,
  required_pull_request_reviews: { required_approving_review_count: 1 },
  enforce_admins: true,
  restrictions: null,
  required_linear_history: false,
  allow_force_pushes: false,
  allow_deletions: false,
  block_creations: false,
  required_conversation_resolution: false,
  lock_branch: false,
  allow_fork_syncing: false,
  ...overrides
})

const restrictedRepos = { exclude: ['.github'] }
const repoBody = (name, extra = {}) => ({ name, owner: { login: 'o' }, default_branch: 'main', archived: false, topics: [], ...extra })
const nextPage = path => ({ link: `<https://api.github.com${path}?page=2>; rel="next"` })

describe('slice 1: whole runs of the real Settings', () => {
  let octokit
  let gh

  beforeAll(() => nock.disableNetConnect())
  afterAll(() => nock.enableNetConnect())
  beforeEach(() => {
    // One repo at a time, so the order of reads is the order of the repos
    process.env.SS_REPO_CONCURRENCY = '1'
    octokit = createOctokit()
    gh = fakeGitHub()
  })
  afterEach(() => {
    delete process.env.SS_REPO_CONCURRENCY
    nock.cleanAll()
  })

  const run = (options, listing = true) => {
    const { settings, log } = newSettings({ octokit, ...options })
    return { settings, log, done: listing ? settings.updateAll() : null }
  }

  // The repo's team list shows a configured team and an org-role team that the config does not list
  function teamLists (repos) {
    for (const name of repos) {
      gh.on('GET', `/repos/o/${name}/teams`, [200, [
        { id: 1, slug: 'keep', name: 'keep', permission: 'push' },
        { id: 2, slug: 'orgrole', name: 'orgrole', permission: 'pull' }
      ]])
    }
  }

  const grantList = (names, headers) => [200, names.map(name => ({ name, full_name: `o/${name}`, owner: { login: 'o' } })), headers]
  const teamsOnly = { restrictedRepos, teams: [{ name: 'keep', permission: 'push' }] }

  describe('team grants', () => {
    it('P-B-4: in a run that walks the listing, the grant list decides: one DELETE for the repo that is listed, none for the other', async () => {
      installationRepos(gh, [{ name: 'r1' }, { name: 'r2' }])
      teamLists(['r1', 'r2'])
      gh.on('GET', '/orgs/o/security-managers', [200, []])
      gh.on('GET', '/orgs/o/teams/orgrole/repos', grantList(['r1']))
      gh.on('DELETE', /^\/orgs\/o\/teams\/orgrole\/repos\/o\/r[12]$/, [204])

      await run({ config: teamsOnly }).done

      expect(gh.counts()).toEqual({
        'GET /installation/repositories': 1,
        'GET /repos/o/r1/teams': 1,
        'GET /repos/o/r2/teams': 1,
        'GET /orgs/o/security-managers': 1,
        'GET /orgs/o/teams/orgrole/repos': 1,
        'DELETE /orgs/o/teams/orgrole/repos/o/r1': 1
      })
    })

    it('P-B-6: when the grant list cannot be read, the run checks the team per repo, once for each, and removes only the grant that exists', async () => {
      installationRepos(gh, [{ name: 'r1' }, { name: 'r2' }])
      teamLists(['r1', 'r2'])
      gh.on('GET', '/orgs/o/security-managers', [200, []])
      gh.on('GET', '/orgs/o/teams/orgrole/repos', [403, { message: 'Resource not accessible by integration' }])
      gh.on('GET', '/orgs/o/teams/orgrole/repos/o/r1', [204])
      gh.on('GET', '/orgs/o/teams/orgrole/repos/o/r2', [404, { message: 'Not Found' }])
      gh.on('DELETE', /^\/orgs\/o\/teams\/orgrole\/repos\/o\/r[12]$/, [204])

      await run({ config: teamsOnly }).done

      expect(gh.counts()).toEqual({
        'GET /installation/repositories': 1,
        'GET /repos/o/r1/teams': 1,
        'GET /repos/o/r2/teams': 1,
        'GET /orgs/o/security-managers': 1,
        'GET /orgs/o/teams/orgrole/repos': 1,
        'GET /orgs/o/teams/orgrole/repos/o/r1': 1,
        'GET /orgs/o/teams/orgrole/repos/o/r2': 1,
        'DELETE /orgs/o/teams/orgrole/repos/o/r1': 1
      })
    })
  })

  describe('P-B-7: the grant list is read once per run', () => {
    it('P-B-7: three repos list the same org-role team: one paginated grant list, one DELETE for each repo that is in it', async () => {
      installationRepos(gh, [{ name: 'r1' }, { name: 'r2' }, { name: 'r3' }])
      teamLists(['r1', 'r2', 'r3'])
      gh.on('GET', '/orgs/o/security-managers', [200, []])
      gh.on('GET', '/orgs/o/teams/orgrole/repos', call => call.query.page === '2'
        ? grantList(['r3'])
        : grantList(['r1'], nextPage('/orgs/o/teams/orgrole/repos')))
      gh.on('DELETE', /^\/orgs\/o\/teams\/orgrole\/repos\/o\/r\d$/, [204])

      await run({ config: teamsOnly }).done

      const counts = gh.counts()
      expect(counts['GET /orgs/o/teams/orgrole/repos']).toBe(2) // two pages of one listing
      expect(Object.keys(counts).filter(k => /^GET \/orgs\/o\/teams\/orgrole\/repos\/o\//.test(k))).toEqual([])
      expect(gh.calls.filter(c => c.method === 'DELETE').map(c => c.path).sort()).toEqual([
        '/orgs/o/teams/orgrole/repos/o/r1',
        '/orgs/o/teams/orgrole/repos/o/r3'
      ])
    })

    it('P-B-7: no grant list is read when no listed team is about to lose a grant', async () => {
      installationRepos(gh, [{ name: 'r1' }, { name: 'r2' }])
      for (const name of ['r1', 'r2']) {
        gh.on('GET', `/repos/o/${name}/teams`, [200, [{ id: 1, slug: 'keep', name: 'keep', permission: 'push' }]])
      }
      gh.on('GET', '/orgs/o/security-managers', [200, []])

      await run({ config: teamsOnly }).done

      expect(Object.keys(gh.counts()).filter(k => k.startsWith('GET /orgs/o/teams/'))).toEqual([])
      expect(gh.writes()).toEqual([])
    })

    it('P-B-7: a single-repo sync makes one per-repo check and reads no grant list', async () => {
      gh.on('GET', '/repos/o/r1', [200, repoBody('r1')])
      teamLists(['r1'])
      gh.on('GET', '/orgs/o/security-managers', [200, []])
      gh.on('GET', '/orgs/o/teams/orgrole/repos/o/r1', [204])
      gh.on('DELETE', '/orgs/o/teams/orgrole/repos/o/r1', [204])
      const { settings } = newSettings({ octokit, config: teamsOnly })

      await settings.updateRepos({ owner: 'o', repo: 'r1' })

      const counts = gh.counts()
      expect(counts['GET /orgs/o/teams/orgrole/repos']).toBeUndefined()
      expect(counts['GET /orgs/o/teams/orgrole/repos/o/r1']).toBe(1)
      expect(counts['DELETE /orgs/o/teams/orgrole/repos/o/r1']).toBe(1)
    })
  })

  describe('one unchanged repo', () => {
    const fullConfig = {
      restrictedRepos,
      repository: { topics: [], security: { enableVulnerabilityAlerts: true } },
      branches: [{ name: 'main', protection: protection() }],
      teams: [{ name: 'keep', permission: 'push' }]
    }

    function unchangedRepo (name) {
      gh.on('GET', `/repos/o/${name}`, [200, repoBody(name)])
      gh.on('GET', `/repos/o/${name}/branches/main/protection`, [200, liveProtection()])
      gh.on('GET', `/repos/o/${name}/vulnerability-alerts`, [204])
      gh.on('GET', `/repos/o/${name}/teams`, call => call.query.page === '2'
        ? [200, [{ id: 2, slug: 'orgrole', name: 'orgrole', permission: 'pull' }]]
        : [200, [{ id: 1, slug: 'keep', name: 'keep', permission: 'push' }], nextPage(`/repos/o/${name}/teams`)])
    }

    it('P-B-8: costs one repo read, one protection read, one alerts read, the team pages, and no write', async () => {
      installationRepos(gh, [{ name: 'r' }])
      unchangedRepo('r')
      gh.on('GET', '/orgs/o/security-managers', [200, []])
      gh.on('GET', '/orgs/o/teams/orgrole/repos', grantList([]))

      await run({ config: fullConfig }).done

      expect(gh.counts()).toEqual({
        'GET /installation/repositories': 1,
        'GET /repos/o/r': 1,
        'GET /repos/o/r/branches/main/protection': 1,
        'GET /repos/o/r/vulnerability-alerts': 1,
        'GET /repos/o/r/teams': 2,
        'GET /orgs/o/security-managers': 1,
        'GET /orgs/o/teams/orgrole/repos': 1
      })
    })

    describe('P-B-9: in NOP mode', () => {
      // r1 matches its config. r2 differs in a protection flag, in its alerts, and holds a grant for the org-role team.
      function twoRepos () {
        installationRepos(gh, [{ name: 'r1' }, { name: 'r2' }])
        unchangedRepo('r1')
        unchangedRepo('r2')
        gh.on('GET', '/repos/o/r2/branches/main/protection', [200, liveProtection({ lock_branch: flag(true) })])
        gh.on('GET', '/repos/o/r2/vulnerability-alerts', [404, { message: 'Vulnerability alerts are disabled.' }])
        gh.on('GET', '/orgs/o/security-managers', [200, []])
        gh.on('GET', '/orgs/o/teams/orgrole/repos', grantList(['r2']))
      }

      const rowsOf = (settings, repo) => settings.results.filter(row => row.repo === repo)

      it('P-B-9: makes the same reads and no write', async () => {
        twoRepos()
        await run({ config: fullConfig, nop: true }).done

        expect(gh.writes()).toEqual([])
        expect(gh.counts()).toEqual({
          'GET /installation/repositories': 1,
          'GET /repos/o/r1': 1,
          'GET /repos/o/r1/branches/main/protection': 1,
          'GET /repos/o/r1/vulnerability-alerts': 1,
          'GET /repos/o/r1/teams': 2,
          'GET /repos/o/r2': 1,
          'GET /repos/o/r2/branches/main/protection': 1,
          'GET /repos/o/r2/vulnerability-alerts': 1,
          'GET /repos/o/r2/teams': 2,
          'GET /orgs/o/security-managers': 1,
          'GET /orgs/o/teams/orgrole/repos': 1
        })
      })

      it('P-B-9: a repo that matches its config gets no protection, alert or team row', async () => {
        twoRepos()
        const { settings, done } = run({ config: fullConfig, nop: true })
        await done

        expect(rowsOf(settings, 'r1')).toEqual([])
      })

      it('P-B-9: a repo with a real difference gets exactly its three rows', async () => {
        twoRepos()
        const { settings, done } = run({ config: fullConfig, nop: true })
        await done

        const withEndpoint = rowsOf(settings, 'r2').filter(row => row.endpoint)
        expect(withEndpoint.map(row => row.plugin).sort()).toEqual(['Branches', 'Repository', 'Teams'])
        const endpointOf = plugin => withEndpoint.find(row => row.plugin === plugin).endpoint
        expect(endpointOf('Branches')).toMatch(/\/repos\/o\/r2\/branches\/main\/protection$/)
        expect(endpointOf('Repository')).toMatch(/\/repos\/o\/r2\/vulnerability-alerts$/)
        expect(endpointOf('Teams')).toMatch(/\/orgs\/o\/teams\/orgrole\/repos\/o\/r2$/)
      })

      it('P-B-9: the check-run update of a dry run names r2 and its plugins, nothing for the unchanged r1, and no collaborators for the archived r3', async () => {
        twoRepos()
        installationRepos(gh, [{ name: 'r1' }, { name: 'r2' }, { name: 'r3', archived: true }])
        // r3 is archived, lists a team that it holds and a collaborator it does not have: both only add, so neither is a row
        gh.on('GET', '/repos/o/r3/teams', [200, [{ id: 1, slug: 'keep', name: 'keep', permission: 'push' }]])
        gh.on('GET', '/repos/o/r3/collaborators', [200, []])
        gh.on('GET', '/repos/o/r3/invitations', [200, []])
        gh.on('GET', /^\/orgs\/o\/memberships\/[a-z]+$/, [200, { state: 'active' }])
        gh.on('POST', '/repos/o/admin/issues/7/comments', [201, {}])
        let checkRun
        gh.on('PATCH', '/repos/o/admin/check-runs/5', call => { checkRun = call.body; return [200, {}] })
        const payload = {
          check_run: { id: 5, check_suite: { pull_requests: [{ number: 7 }] } },
          repository: { owner: { login: 'o' }, name: 'admin' }
        }
        // r2 also differs in a repo setting, so its Repository plugin has a change to show
        const repoConfigs = {
          'r2.yml': { repository: { description: 'new' } },
          'r3.yml': { collaborators: [{ username: 'alice', permission: 'push' }] }
        }
        const { settings } = newSettings({ octokit, config: fullConfig, nop: true, payload, repoConfigs })

        await settings.updateAll()
        await settings.handleResults()

        expect(gh.writes().map(c => `${c.method} ${c.path}`).sort()).toEqual([
          'PATCH /repos/o/admin/check-runs/5',
          'POST /repos/o/admin/issues/7/comments'
        ])
        const summary = checkRun.output.summary
        const [header, , r2Row] = summary.split('\n').filter(line => line.startsWith('|'))
        expect(header.split('|').map(cell => cell.trim()).filter(Boolean).sort()).toEqual(['Branches settings', 'Repo', 'Repository settings', 'Teams settings'])
        expect(r2Row.split('|').map(cell => cell.trim()).filter(Boolean)).toEqual(['r2', ':hand:', ':hand:', ':hand:'])
        expect(summary).not.toMatch(/\br1\b/)
        expect(summary).not.toMatch(/\br3\b/)
        expect(summary).not.toMatch(/Collaborators/)
        expect(checkRun.conclusion).toBe('success')
      })
    })
  })

  describe('P-B-9: the NOP rows that name an endpoint', () => {
    it('P-B-9: disabling alerts and security updates are rows of their repo, with their endpoint', async () => {
      installationRepos(gh, [{ name: 'r' }])
      gh.on('GET', '/repos/o/r', [200, repoBody('r', { description: 'old' })])
      gh.on('GET', '/repos/o/r/vulnerability-alerts', [204])
      const config = {
        restrictedRepos,
        repository: { topics: [], description: 'new', security: { enableVulnerabilityAlerts: false, enableAutomatedSecurityFixes: false } }
      }
      const { settings, done } = run({ config, nop: true })
      await done

      expect(gh.writes()).toEqual([])
      const rows = settings.results.filter(row => row.endpoint)
      expect(rows.map(row => [row.plugin, row.repo, row.endpoint.replace('https://api.github.com', '')]).sort()).toEqual([
        ['Repository', 'r', '/repos/o/r'],
        ['Repository', 'r', '/repos/o/r/automated-security-fixes'],
        ['Repository', 'r', '/repos/o/r/vulnerability-alerts']
      ])
    })

    describe('P-B-9: what a PR dry run shows for a row that is a text message', () => {
      const alertsOnly = { restrictedRepos, repository: { topics: [], security: { enableVulnerabilityAlerts: true } } }
      const prPayload = {
        check_run: { id: 5, check_suite: { pull_requests: [{ number: 7 }] } },
        repository: { owner: { login: 'o' }, name: 'admin' }
      }

      // Runs a dry run with a check run, and returns what it wrote to the check run and to the PR
      async function dryRun (config) {
        let checkRun
        let comment
        gh.on('PATCH', '/repos/o/admin/check-runs/5', call => { checkRun = call.body; return [200, {}] })
        gh.on('POST', '/repos/o/admin/issues/7/comments', call => { comment = call.body; return [201, {}] })
        const { settings } = newSettings({ octokit, config, nop: true, payload: prPayload })
        await settings.updateAll()
        await settings.handleResults()
        return { settings, summary: checkRun.output.summary, comment: comment.body }
      }

      // r1 matches its config, r2 differs only in its Dependabot alerts
      function alertRepos () {
        installationRepos(gh, [{ name: 'r1' }, { name: 'r2' }])
        gh.on('GET', '/repos/o/r1', [200, repoBody('r1')])
        gh.on('GET', '/repos/o/r2', [200, repoBody('r2')])
        gh.on('GET', '/repos/o/r1/vulnerability-alerts', [204])
        gh.on('GET', '/repos/o/r2/vulnerability-alerts', [404, { message: 'Vulnerability alerts are disabled.' }])
      }

      it('P-B-9: the check-run summary shows a repo whose only difference is its alert state, in its Repository column, and nothing for the matching repo', async () => {
        alertRepos()
        const { summary } = await dryRun(alertsOnly)

        const [header, , r2Row] = summary.split('\n').filter(line => line.startsWith('|'))
        expect(header.split('|').map(cell => cell.trim()).filter(Boolean).sort()).toEqual(['Repo', 'Repository settings'])
        expect(r2Row.split('|').map(cell => cell.trim()).filter(Boolean)).toEqual(['r2', ':hand:'])
        expect(summary).not.toMatch(/\br1\b/)
      })

      it('P-B-9: the PR comment names the alert change of that repo, and nothing for the matching repo', async () => {
        alertRepos()
        const { comment } = await dryRun(alertsOnly)

        expect(comment).toMatch(/<td> "r2" <\/td>/)
        expect(comment).toMatch(/Enabling Dependabot alerts/)
        expect(comment).not.toMatch(/<td> "r1" <\/td>/)
      })

      it('P-B-9: a text row that names no endpoint (the repo to create is skipped without force_create) stays out of the summary and the comment', async () => {
        installationRepos(gh, [{ name: 'r' }])
        gh.on('GET', '/repos/o/r', [404, { message: 'Not Found' }])
        const config = { restrictedRepos, repository: { topics: [], description: 'new' } }
        const { settings, summary, comment } = await dryRun(config)

        // The row exists: it is a text message that names no endpoint
        expect(settings.results.map(row => [row.plugin, row.endpoint, row.action.msg])).toEqual([['Repository', '', 'Force_create is false. Skipping repo creation']])
        expect(summary).toMatch(/Number of repos that were considered: `1 `/)
        expect(summary).not.toMatch(/Repository settings/)
        expect(comment).not.toMatch(/Force_create/)
        expect(comment).not.toMatch(/<td> "r" <\/td>/)
      })
    })

    it('P-B-9: a dry run waits for its pending changes: a rejection reaches the plugin that made it, not the process', async () => {
      installationRepos(gh, [{ name: 'r' }])
      gh.on('GET', '/repos/o/r/teams', [200, [{ id: 2, slug: 'orgrole', name: 'orgrole', permission: 'pull' }]])
      gh.on('GET', '/orgs/o/security-managers', [200, []])
      gh.on('GET', '/orgs/o/teams/orgrole/repos', grantList(['r']))
      const unhandled = jest.fn()
      process.on('unhandledRejection', unhandled)
      const { settings, done } = run({ config: teamsOnly, nop: true })
      const remove = jest.spyOn(require('../../../lib/plugins/teams').prototype, 'remove')
        .mockImplementation(() => Promise.reject(new Error('boom')))
      try {
        await done
        await new Promise(resolve => setImmediate(resolve))
      } finally {
        remove.mockRestore()
        process.removeListener('unhandledRejection', unhandled)
      }

      expect(unhandled).not.toHaveBeenCalled()
      expect(settings.results.filter(row => row.type === 'ERROR').map(row => row.plugin)).toEqual(['Teams'])
    })

    it('P-B-9: a NOP run without a check run ends without a PR comment or a check-run update', async () => {
      installationRepos(gh, [{ name: 'r' }])
      gh.on('GET', '/repos/o/r/teams', [200, []])
      gh.on('GET', '/orgs/o/security-managers', [200, []])
      gh.on('PUT', '/orgs/o/teams/keep/repos/o/r', [204])
      gh.on('GET', '/orgs/o/teams/keep', [200, { id: 1, slug: 'keep' }])
      const { settings, done } = run({ config: teamsOnly, nop: true })
      await done
      const before = gh.calls.length

      await settings.handleResults()

      expect(gh.calls.length).toBe(before)
      expect(gh.writes()).toEqual([])
    })
  })

  describe('one repo read per run', () => {
    it('P-B-10: three repos (settings and labels, branches, only teams) cost two repo reads in all', async () => {
      installationRepos(gh, [{ name: 'a' }, { name: 'b' }, { name: 'c' }])
      for (const name of ['a', 'b']) {
        gh.on('GET', `/repos/o/${name}`, [200, repoBody(name)])
      }
      gh.on('GET', '/repos/o/a/labels', [200, []])
      gh.on('POST', '/repos/o/a/labels', [201, {}])
      gh.on('GET', '/repos/o/b/branches/main/protection', [200, liveProtection()])
      gh.on('GET', '/repos/o/c/teams', [200, [{ id: 1, slug: 'keep', name: 'keep', permission: 'push' }]])
      gh.on('GET', '/orgs/o/security-managers', [200, []])
      const repoConfigs = {
        'a.yml': { repository: { topics: [] }, labels: [{ name: 'bug', color: 'ff0000' }] },
        'b.yml': { branches: [{ name: 'main', protection: protection() }] },
        'c.yml': { teams: [{ name: 'keep', permission: 'push' }] }
      }

      await run({ config: { restrictedRepos }, repoConfigs }).done

      const repoReads = Object.entries(gh.counts()).filter(([k]) => /^GET \/repos\/o\/[abc]$/.test(k))
      expect(Object.fromEntries(repoReads)).toEqual({ 'GET /repos/o/a': 1, 'GET /repos/o/b': 1 })
    })

    it.each([
      ['P-B-12: a rename of the default branch', trunk => {
        gh.on('GET', '/repos/o/r/branches/trunk', [404, { message: 'Branch not found' }])
        gh.on('POST', '/repos/o/r/branches/main/rename', [201, { name: 'trunk' }])
        // The PATCH after the rename answers 422, so only the rename itself can tell the run the new name
        gh.on('PATCH', '/repos/o/r', [422, { message: 'Validation Failed' }])
      }],
      ['P-B-12: a PATCH of the default branch', trunk => {
        gh.on('GET', '/repos/o/r/branches/trunk', [200, { name: 'trunk' }])
        gh.on('PATCH', '/repos/o/r', call => [200, repoBody('r', { default_branch: call.body.default_branch || 'main' })])
      }]
    ])('%s: the branches plugin of the same run reads and PUTs protection on the new name, after one repo read', async (name, arrange) => {
      installationRepos(gh, [{ name: 'r' }])
      gh.on('GET', '/repos/o/r', [200, repoBody('r')]) // the answer before the change
      arrange()
      gh.on('GET', '/repos/o/r/branches/trunk/protection', [404, { message: 'Branch not protected' }])
      gh.on('PUT', '/repos/o/r/branches/trunk/protection', [200, {}])
      const config = {
        restrictedRepos,
        repository: { topics: [], default_branch: 'trunk' },
        branches: [{ name: 'default', protection: protection() }]
      }

      await run({ config }).done

      const counts = gh.counts()
      expect(counts['GET /repos/o/r']).toBe(1)
      expect(counts['GET /repos/o/r/branches/trunk/protection']).toBe(1)
      expect(counts['PUT /repos/o/r/branches/trunk/protection']).toBe(1)
      expect(Object.keys(counts).filter(k => k.includes('/branches/main/protection'))).toEqual([])
    })
  })

  describe('P-B-12: a repo entry after an archive change', () => {
    it('P-B-12: an archived repo whose config says archived: false costs one repo read and one PATCH; the repository plugin then compares against the PATCH answer', async () => {
      installationRepos(gh, [{ name: 'r', archived: true }])
      gh.on('GET', '/repos/o/r', [200, repoBody('r', { archived: true, description: 'old' })])
      // The unarchive answers with the repo as it is now, and that already has the configured description
      gh.on('PATCH', '/repos/o/r', call => [200, repoBody('r', { archived: call.body.archived, description: 'new' })])
      const config = { restrictedRepos, repository: { topics: [], archived: false, description: 'new' } }

      await run({ config }).done

      expect(gh.counts()).toEqual({
        'GET /installation/repositories': 1,
        'GET /repos/o/r': 1,
        'PATCH /repos/o/r': 1
      })
      expect(gh.writes().map(c => c.body)).toEqual([{ archived: false }])
    })
  })

  describe('P-B-11: the security managers are read once per run', () => {
    const threeRepos = () => {
      installationRepos(gh, [{ name: 'r1' }, { name: 'r2' }, { name: 'r3' }])
      for (const name of ['r1', 'r2', 'r3']) {
        gh.on('GET', `/repos/o/${name}/teams`, [200, [{ id: 1, slug: 'keep', name: 'keep', permission: 'push' }]])
      }
    }

    it.each([
      ['succeeds', [200, [{ name: 'sec' }]]],
      ['answers 404', [404, { message: 'Not Found' }]],
      ['answers 410', [410, { message: 'Gone' }]]
    ])('P-B-11: when the read %s, three repos with teams read it once', async (_, reply) => {
      threeRepos()
      gh.on('GET', '/orgs/o/security-managers', reply)

      await run({ config: teamsOnly }).done

      expect(gh.counts()['GET /orgs/o/security-managers']).toBe(1)
    })

    it('P-B-11: a failed read is not kept: the next repo reads again, and the first repo still passes the grant check', async () => {
      installationRepos(gh, [{ name: 'r1' }, { name: 'r2' }])
      teamLists(['r1'])
      gh.on('GET', '/repos/o/r2/teams', [200, [{ id: 1, slug: 'keep', name: 'keep', permission: 'push' }]])
      let reads = 0
      gh.on('GET', '/orgs/o/security-managers', () => ++reads === 1 ? [403, { message: 'Resource not accessible by integration' }] : [200, [{ name: 'sec' }]])
      gh.on('GET', '/orgs/o/teams/orgrole/repos', grantList([])) // r1 holds no grant for the org-role team
      gh.on('DELETE', '/orgs/o/teams/orgrole/repos/o/r1', [204])

      await run({ config: teamsOnly }).done

      expect(gh.counts()['GET /orgs/o/security-managers']).toBe(2)
      expect(gh.counts()['GET /orgs/o/teams/orgrole/repos']).toBe(1)
      expect(gh.writes()).toEqual([])
    })
  })

  describe('collaborators on archived repos', () => {
    const permissionsOf = permission => ({ admin: permission === 'admin', push: ['admin', 'push'].includes(permission), pull: true })
    const config = collaborators => ({ restrictedRepos, collaborators })

    function archivedRepo ({ existing = [], invitations = [] }) {
      installationRepos(gh, [{ name: 'r', archived: true }])
      gh.on('GET', '/repos/o/r/collaborators', [200, existing.map(({ login, permission }) => ({ login, permissions: permissionsOf(permission) }))])
      gh.on('GET', '/repos/o/r/invitations', [200, invitations.map(({ id, login, permissions }) => ({ id, invitee: { login }, permissions }))])
      gh.on('GET', /^\/orgs\/o\/memberships\/[a-z]+$/, [200, { state: 'active' }])
      gh.on('PUT', /^\/repos\/o\/r\/collaborators\/[a-z]+$/, [403, { message: 'Repository was archived so is read-only.' }])
      gh.on('PATCH', /^\/repos\/o\/r\/invitations\/\d+$/, [403, { message: 'Repository was archived so is read-only.' }])
      gh.on('DELETE', /^\/repos\/o\/r\/(collaborators\/[a-z]+|invitations\/\d+)$/, [204])
    }

    const adds = [
      { username: 'alice', permission: 'push' }, // not on the repo yet
      { username: 'bob', permission: 'admin' }, // holds pull
      { username: 'carol', permission: 'push' } // pending invitation for read
    ]
    const existingAccess = {
      existing: [{ login: 'bob', permission: 'pull' }],
      invitations: [{ id: 77, login: 'carol', permissions: 'read' }]
    }

    it('P-B-13: a config that adds a collaborator and changes a collaborator and an invitation sends no PUT and no PATCH', async () => {
      archivedRepo(existingAccess)

      await run({ config: config(adds) }).done

      expect(gh.writes()).toEqual([])
    })

    it('P-B-13: in NOP mode the same config reports no row for them', async () => {
      archivedRepo(existingAccess)
      const { settings, done } = run({ config: config(adds), nop: true })
      await done

      expect(settings.results).toEqual([])
    })

    it('P-B-14: a collaborator and an invitation that the config does not list are each removed with one DELETE, and nothing else is written', async () => {
      archivedRepo({
        existing: [{ login: 'bob', permission: 'push' }, { login: 'dave', permission: 'push' }],
        invitations: [{ id: 88, login: 'erin', permissions: 'write' }]
      })

      await run({ config: config([{ username: 'alice', permission: 'push' }, { username: 'bob', permission: 'push' }]) }).done

      expect(gh.writes().map(c => `${c.method} ${c.path}`).sort()).toEqual([
        'DELETE /repos/o/r/collaborators/dave',
        'DELETE /repos/o/r/invitations/88'
      ])
    })
  })
})
