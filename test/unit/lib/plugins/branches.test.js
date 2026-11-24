/* eslint-disable no-undef */

const { when } = require('jest-when')
const Branches = require('../../../../lib/plugins/branches')

describe('Branches', () => {
  let github
  const log = jest.fn()
  log.debug = jest.fn()
  log.error = jest.fn()

  function configure (config) {
    const nop = false
    const errors = []
    return new Branches(nop, github, { owner: 'bkeepers', repo: 'test' }, config, log, errors)
  }

  beforeEach(() => {
    github = {
      repos: {
        get: jest.fn().mockResolvedValue({
          data: {
            default_branch: 'main'
          }
        }),
        getBranchProtection: jest.fn().mockResolvedValue({
          data: {
            enforce_admins: { enabled: false }
          }
        }),
        updateBranchProtection: jest.fn().mockImplementation(() => Promise.resolve('updateBranchProtection')),
        deleteBranchProtection: jest.fn().mockImplementation(() => Promise.resolve('deleteBranchProtection'))
      }
    }
  })

  describe('sync', () => {
    it('syncs branch protection settings', () => {
      const plugin = configure(
        [{
          name: 'master',
          protection: {
            required_status_checks: {
              strict: true,
              contexts: ['travis-ci']
            },
            enforce_admins: true,
            required_pull_request_reviews: {
              require_code_owner_reviews: true
            }
          }
        }]
      )

      return plugin.sync().then(() => {
        expect(github.repos.updateBranchProtection).toHaveBeenCalledWith({
          owner: 'bkeepers',
          repo: 'test',
          branch: 'master',
          required_status_checks: {
            strict: true,
            contexts: ['travis-ci']
          },
          enforce_admins: true,
          required_pull_request_reviews: {
            require_code_owner_reviews: true
          },
          headers: { accept: 'application/vnd.github.hellcat-preview+json,application/vnd.github.luke-cage-preview+json,application/vnd.github.zzzax-preview+json' }
        })
      })
    })

    describe('when the "protection" config is empty object', () => {
      it('removes branch protection', () => {
        const plugin = configure(
          [{
            name: 'master',
            protection: {}
          }]
        )

        return plugin.sync().then(() => {
          expect(github.repos.updateBranchProtection).not.toHaveBeenCalled()
          expect(github.repos.deleteBranchProtection).toHaveBeenCalledWith({
            owner: 'bkeepers',
            repo: 'test',
            branch: 'master'
          })
        })
      })
    })

    describe('when the "protection" config is set to `null`', () => {
      it('removes branch protection', () => {
        const plugin = configure(
          [{
            name: 'master',
            protection: null
          }]
        )

        return plugin.sync().then(() => {
          expect(github.repos.updateBranchProtection).not.toHaveBeenCalled()
          expect(github.repos.deleteBranchProtection).toHaveBeenCalledWith({
            owner: 'bkeepers',
            repo: 'test',
            branch: 'master'
          })
        })
      })
    })

    describe('when the "protection" config is set to an empty array', () => {
      it('removes branch protection', () => {
        const plugin = configure(
          [{
            name: 'master',
            protection: []
          }]
        )

        return plugin.sync().then(() => {
          expect(github.repos.updateBranchProtection).not.toHaveBeenCalled()
          expect(github.repos.deleteBranchProtection).toHaveBeenCalledWith({
            owner: 'bkeepers',
            repo: 'test',
            branch: 'master'
          })
        })
      })
    })

    describe('when the "protection" config is set to `false`', () => {
      it('removes branch protection', () => {
        const plugin = configure(
          [{
            name: 'master',
            protection: false
          }]
        )

        return plugin.sync().then(() => {
          expect(github.repos.updateBranchProtection).not.toHaveBeenCalled()
          expect(github.repos.deleteBranchProtection).toHaveBeenCalledWith({
            owner: 'bkeepers',
            repo: 'test',
            branch: 'master'
          })
        })
      })
    })

    describe('when the "protection" key is not present', () => {
      it('makes no change to branch protection', () => {
        const plugin = configure(
          [{
            name: 'master'
          }]
        )

        return plugin.sync().then(() => {
          expect(github.repos.updateBranchProtection).not.toHaveBeenCalled()
          expect(github.repos.deleteBranchProtection).not.toHaveBeenCalled()
        })
      })
    })

    describe('when {{EXTERNALLY_DEFINED}} is present in "required_status_checks" and no status checks exist in GitHub', () => {
      it('it initialises the status checks with an empty list', () => {
        const plugin = configure(
          [{
            name: 'main',
            protection: {
              required_status_checks: {
                strict: true,
                contexts: ['{{travis-ci', '{{EXTERNALLY_DEFINED}}']
              }
            }
          }]
        )

        return plugin.sync().then(() => {
          expect(github.repos.updateBranchProtection).toHaveBeenCalledWith({
            owner: 'bkeepers',
            repo: 'test',
            branch: 'main',
            required_status_checks: {
              strict: true,
              contexts: []
            },
            headers: { accept: 'application/vnd.github.hellcat-preview+json,application/vnd.github.luke-cage-preview+json,application/vnd.github.zzzax-preview+json' }
          })
        })
      })
    })

    describe('when {{EXTERNALLY_DEFINED}} is present in "required_status_checks" and status checks exist in GitHub', () => {
      it('it retains the status checks from GitHub', () => {
        github.repos.getBranchProtection = jest.fn().mockResolvedValue({
          data: {
            enforce_admins: { enabled: false },
            protection: {
              required_status_checks: {
                contexts: ['check-1', 'check-2']
              }
            }
          }
        })
        const plugin = configure(
          [{
            name: 'main',
            protection: {
              required_status_checks: {
                strict: true,
                contexts: ['{{travis-ci', '{{EXTERNALLY_DEFINED}}']
              }
            }
          }]
        )

        return plugin.sync().then(() => {
          expect(github.repos.updateBranchProtection).toHaveBeenCalledWith({
            owner: 'bkeepers',
            repo: 'test',
            branch: 'main',
            required_status_checks: {
              strict: true,
              contexts: ['check-1', 'check-2']
            },
            headers: { accept: 'application/vnd.github.hellcat-preview+json,application/vnd.github.luke-cage-preview+json,application/vnd.github.zzzax-preview+json' }
          })
        })
      })
    })

    describe('when multiple branches are configured', () => {
      it('updates them each appropriately', () => {
        const plugin = configure(
          [
            {
              name: 'master',
              protection: { enforce_admins: true }
            },
            {
              name: 'other',
              protection: { enforce_admins: false }
            }
          ]
        )

        when(github.repos.getBranchProtection)
          .calledWith(expect.objectContaining({
            branch: 'other'
          })).mockResolvedValue({
            data: {
              enforce_admins: { enabled: true }
            }
          })

        return plugin.sync().then(() => {
          expect(github.repos.updateBranchProtection).toHaveBeenCalledTimes(2)

          expect(github.repos.updateBranchProtection).toHaveBeenLastCalledWith({
            owner: 'bkeepers',
            repo: 'test',
            branch: 'other',
            enforce_admins: false,
            // Always present now (null = none) so GitHub's PUT does not 422.
            required_status_checks: null,
            headers: { accept: 'application/vnd.github.hellcat-preview+json,application/vnd.github.luke-cage-preview+json,application/vnd.github.zzzax-preview+json' }
          })
        })
      })
    })

    describe('when required_status_checks is omitted from config', () => {
      it('preserves status checks already configured on the repo (0.3.3 parity)', () => {
        const plugin = configure(
          [{
            name: 'master',
            protection: { enforce_admins: true }
          }]
        )

        when(github.repos.getBranchProtection)
          .calledWith(expect.objectContaining({ branch: 'master' }))
          .mockResolvedValue({
            data: {
              enforce_admins: { enabled: false },
              required_status_checks: { strict: true, checks: [{ context: 'ci/build' }] }
            }
          })

        return plugin.sync().then(() => {
          expect(github.repos.updateBranchProtection).toHaveBeenCalledWith({
            owner: 'bkeepers',
            repo: 'test',
            branch: 'master',
            enforce_admins: true,
            required_status_checks: { strict: true, checks: [{ context: 'ci/build' }] },
            headers: { accept: 'application/vnd.github.hellcat-preview+json,application/vnd.github.luke-cage-preview+json,application/vnd.github.zzzax-preview+json' }
          })
        })
      })
    })
  })

  describe.skip('return values', () => {
    it('returns updateBranchProtection Promise', () => {
      const plugin = configure(
        [{
          name: 'master',
          protection: { enforce_admins: true }
        }]
      )

      return plugin.sync().then(result => {
        expect(result.length).toBe(1)
        expect(result[0]).toBe('updateBranchProtection')
      })
    })
    it('returns deleteBranchProtection Promise', () => {
      const plugin = configure(
        [{
          name: 'master',
          protection: null
        }]
      )

      return plugin.sync().then(result => {
        expect(result.length).toBe(1)
        expect(result[0]).toBe('deleteBranchProtection')
      })
    })
  })
})

describe('Branches against a real client on nock', () => {
  const nock = require('nock')
  const { createOctokit, recordRequests, api } = require('../../helpers/github')

  const log = { debug: jest.fn(), error: jest.fn(), info: jest.fn() }
  const repo = () => ({ owner: 'o', repo: 'r' })

  // What GET protection returns on GitHub: five flags and the four new ones as {enabled: <bool>} objects
  function liveProtection (overrides = {}) {
    const flag = (enabled) => ({ url: 'https://api.github.com/x', enabled })
    return {
      url: 'https://api.github.com/repos/o/r/branches/main/protection',
      required_pull_request_reviews: {
        url: 'https://api.github.com/x',
        dismiss_stale_reviews: false,
        require_code_owner_reviews: false,
        required_approving_review_count: 1
      },
      enforce_admins: flag(true),
      required_linear_history: flag(false),
      allow_force_pushes: flag(false),
      allow_deletions: flag(false),
      block_creations: flag(false),
      required_conversation_resolution: flag(false),
      lock_branch: flag(false),
      allow_fork_syncing: flag(false),
      ...overrides
    }
  }

  const configuredProtection = (overrides = {}) => ({
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

  let octokit
  let requests

  beforeAll(() => nock.disableNetConnect())
  afterAll(() => nock.enableNetConnect())
  beforeEach(() => {
    octokit = createOctokit()
    requests = recordRequests(octokit)
    api().get('/repos/o/r').reply(200, { default_branch: 'main' })
  })
  afterEach(() => nock.cleanAll())

  const puts = () => requests.filter(r => r.method === 'PUT')

  it('P-B-1: a protected branch that matches its config, flags returned as {enabled: <bool>}, gets no PUT', async () => {
    api().get('/repos/o/r/branches/main/protection').reply(200, liveProtection())
    const put = api().put('/repos/o/r/branches/main/protection').reply(200, {})
    const plugin = new Branches(false, octokit, repo(), [{ name: 'main', protection: configuredProtection() }], log, [])

    await plugin.sync()

    expect(puts()).toEqual([])
    expect(put.isDone()).toBe(false)
  })

  it('P-B-2: one differing flag gets exactly one PUT, with the configured value', async () => {
    api().get('/repos/o/r/branches/main/protection').reply(200, liveProtection())
    let body
    api().put('/repos/o/r/branches/main/protection', b => { body = b; return true }).reply(200, {})
    const plugin = new Branches(false, octokit, repo(), [{ name: 'main', protection: configuredProtection({ allow_force_pushes: true }) }], log, [])

    await plugin.sync()

    expect(puts()).toHaveLength(1)
    expect(body.allow_force_pushes).toBe(true)
  })

  it('P-B-2: a dry run reports only the flag that differs, not the three that match', async () => {
    api().get('/repos/o/r/branches/main/protection').reply(200, liveProtection())
    const put = api().put('/repos/o/r/branches/main/protection').reply(200, {})
    const plugin = new Branches(true, octokit, repo(), [{ name: 'main', protection: configuredProtection({ lock_branch: true }) }], log, [])

    const rows = await plugin.sync()

    expect(put.isDone()).toBe(false)
    const diff = rows.find(row => row.action && row.action.modifications)
    expect(diff.action.modifications.branch.protection).toEqual({ lock_branch: true })
  })
})
