const { when } = require('jest-when')
const any = require('@travi/any')
const Teams = require('../../../../lib/plugins/teams')

describe('Teams', () => {
  let github
  const addedTeamName = 'added'
  const addedTeamId = any.integer()
  const updatedTeamName = 'updated-permission'
  const updatedTeamId = any.integer()
  const removedTeamName = 'removed'
  const removedTeamId = any.integer()
  const unchangedTeamName = 'unchanged'
  const unchangedTeamId = any.integer()
  const org = 'bkeepers'

  function configure (config) {
    const log = { debug: jest.fn(), error: console.error }
    const errors = []
    return new Teams(undefined, github, { owner: 'bkeepers', repo: 'test' }, config, log, errors)
  }

  beforeEach(() => {
    github = {
      paginate: jest.fn()
        .mockImplementation(async (fetch) => {
          const response = await fetch()
          return response.data
        }),
      teams: {
        create: jest.fn().mockResolvedValue(),
        getByName: jest.fn(),
        addOrUpdateRepoPermissionsInOrg: jest.fn().mockResolvedValue()
      },
      repos: {
        listTeams: jest.fn().mockResolvedValue({
          data: [
            { id: unchangedTeamId, slug: unchangedTeamName, permission: 'push' },
            { id: removedTeamId, slug: removedTeamName, permission: 'push' },
            { id: updatedTeamId, slug: updatedTeamName, permission: 'pull' }
          ]
        })
      },
      request: jest.fn().mockResolvedValue()
    }
  })

  describe('sync', () => {
    it('syncs teams', async () => {
      const plugin = configure([
        { name: unchangedTeamName, permission: 'push' },
        { name: updatedTeamName, permission: 'admin' },
        { name: addedTeamName, permission: 'pull' }
      ])

      when(github.teams.getByName)
        .defaultResolvedValue({})
        .calledWith({ org: 'bkeepers', team_slug: addedTeamName })
        .mockResolvedValue({ data: { id: addedTeamId } })

      await plugin.sync()

      expect(github.request).toHaveBeenCalledWith(
        'PUT /orgs/:owner/teams/:team_slug/repos/:owner/:repo',
        {
          org,
          owner: org,
          repo: 'test',
          team_id: updatedTeamId,
          team_slug: updatedTeamName,
          permission: 'admin'
        }
      )

      expect(github.teams.addOrUpdateRepoPermissionsInOrg).toHaveBeenCalledWith({
        org,
        team_id: addedTeamId,
        team_slug: addedTeamName,
        owner: org,
        repo: 'test',
        permission: 'pull'
      })

      expectTeamDeleted(removedTeamName)
    })

    function expectTeamDeleted (teamSlug) {
      expect(github.request).toHaveBeenCalledWith(
        'DELETE /orgs/:owner/teams/:team_slug/repos/:owner/:repo',
        {
          org,
          owner: org,
          repo: 'test',
          team_slug: teamSlug
        }
      )
    }
  })
})

describe('Teams grant check against a real client on nock', () => {
  const nock = require('nock')
  const { createOctokit, recordRequests, api } = require('../../helpers/github')

  const log = { debug: jest.fn(), error: jest.fn(), info: jest.fn() }
  const grantPath = '/orgs/o/teams/orgrole/repos/o/r'
  let octokit
  let requests

  beforeAll(() => nock.disableNetConnect())
  afterAll(() => nock.enableNetConnect())
  beforeEach(() => {
    octokit = createOctokit()
    requests = recordRequests(octokit)
    // The repo's team list shows a configured team and one that is not in the config
    api().get('/repos/o/r/teams').query(true).reply(200, [
      { id: 1, slug: 'keep', name: 'keep', permission: 'push' },
      { id: 2, slug: 'orgrole', name: 'orgrole', permission: 'pull' }
    ])
    api().get('/orgs/o/security-managers').query(true).optionally().reply(404, { message: 'Not Found' })
  })
  afterEach(() => nock.cleanAll())

  function sync () {
    const plugin = new Teams(false, octokit, { owner: 'o', repo: 'r' }, [{ name: 'keep', permission: 'push' }], log, [])
    return plugin.sync()
  }

  const deletes = () => requests.filter(r => r.method === 'DELETE')

  it('P-B-5: a listed team outside the config with a repo-level grant (204) is deleted once', async () => {
    const check = api().get(grantPath).reply(204)
    api().delete(grantPath).reply(204)

    await sync()

    expect(check.isDone()).toBe(true)
    expect(deletes()).toHaveLength(1)
  })

  it('P-B-5: a listed team outside the config without a repo-level grant (404) is not deleted', async () => {
    const check = api().get(grantPath).reply(404, { message: 'Not Found' })
    const del = api().delete(grantPath).reply(204)

    await sync()

    expect(check.isDone()).toBe(true)
    expect(del.isDone()).toBe(false)
    expect(deletes()).toEqual([])
  })

  it('P-B-6: a grant check that fails (403) leaves the DELETE as it is today', async () => {
    const check = api().get(grantPath).reply(403, { message: 'Resource not accessible by integration' })
    api().delete(grantPath).reply(204)

    await sync()

    expect(check.isDone()).toBe(true)
    expect(deletes()).toHaveLength(1)
  })
})
