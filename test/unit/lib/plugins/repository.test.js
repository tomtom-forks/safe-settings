const Repository = require('../../../../lib/plugins/repository')

describe('Repository', () => {
  const github = {
    repos: {
      get: jest.fn().mockResolvedValue({
        data: {
          topics: []
        }
      }),
      update: jest.fn().mockResolvedValue(),
      replaceAllTopics: jest.fn().mockResolvedValue()
    }
  }
  const log = jest.fn()
  log.debug = jest.fn()
  log.error = jest.fn()

  function configure (config) {
    const nop = false
    const errors = []
    return new Repository(nop, github, { owner: 'bkeepers', repo: 'test' }, config, 1, log, errors)
  }

  describe('sync', () => {
    beforeEach(() => {
      jest.clearAllMocks()
    })

    it('syncs repository settings', () => {
      const plugin = configure({
        name: 'test',
        description: 'Hello World!',
        topics: []
      })
      return plugin.sync().then(() => {
        expect(github.repos.update).toHaveBeenCalledWith({
          owner: 'bkeepers',
          repo: 'test',
          name: 'test',
          description: 'Hello World!',
          mediaType: { previews: ['nebula-preview'] }
        })
      })
    })

    it('handles renames', () => {
      const plugin = configure({
        name: 'new-name'
      })
      return plugin.sync().then(() => {
        expect(github.repos.update).toHaveBeenCalledWith({
          owner: 'bkeepers',
          repo: 'test',
          name: 'new-name',
          mediaType: { previews: ['nebula-preview'] }
        })
      })
    })

    it('syncs topics', () => {
      const plugin = configure({
        topics: ['foo', 'bar']
      })

      return plugin.sync().then(() => {
        expect(github.repos.replaceAllTopics).toHaveBeenCalledWith({
          owner: 'bkeepers',
          repo: 'test',
          names: ['foo', 'bar'],
          mediaType: {
            previews: ['mercy']
          }
        })
      })
    })
  })
})

describe('Repository Dependabot alerts against a real client on nock', () => {
  const nock = require('nock')
  const { createOctokit, recordRequests, api } = require('../../helpers/github')

  const log = { debug: jest.fn(), error: jest.fn(), info: jest.fn() }
  const alertsPath = '/repos/o/r/vulnerability-alerts'
  let octokit
  let requests

  beforeAll(() => nock.disableNetConnect())
  afterAll(() => nock.enableNetConnect())
  beforeEach(() => {
    octokit = createOctokit()
    requests = recordRequests(octokit)
    // The repo matches its config, so only the alert state is in question
    api().get('/repos/o/r').reply(200, { name: 'r', owner: { login: 'o' }, topics: [] })
  })
  afterEach(() => nock.cleanAll())

  function sync (enableVulnerabilityAlerts) {
    const plugin = new Repository(false, octokit, { owner: 'o', repo: 'r' }, { topics: [], security: { enableVulnerabilityAlerts } }, 1, log, [])
    return plugin.sync()
  }

  const writes = () => requests.filter(r => ['PUT', 'DELETE'].includes(r.method))
  const alertRequests = () => requests.filter(r => r.url.endsWith('/vulnerability-alerts')).map(r => `${r.method} ${r.status}`)

  it('P-B-3: enabled in the config and on (204) writes nothing', async () => {
    api().get(alertsPath).reply(204)
    const put = api().put(alertsPath).reply(204)

    await sync(true)

    expect(alertRequests()).toEqual(['GET 204'])
    expect(put.isDone()).toBe(false)
  })

  it('P-B-3: disabled in the config and off (404) writes nothing', async () => {
    api().get(alertsPath).reply(404, { message: 'Vulnerability alerts are disabled.' })
    const del = api().delete(alertsPath).reply(204)

    await sync(false)

    expect(alertRequests()).toEqual(['GET 404'])
    expect(del.isDone()).toBe(false)
  })

  it('P-B-3: enabled in the config and off (404) sends one PUT after the GET', async () => {
    api().get(alertsPath).reply(404, { message: 'Vulnerability alerts are disabled.' })
    api().put(alertsPath).reply(204)

    await sync(true)

    expect(alertRequests()).toEqual(['GET 404', 'PUT 204'])
  })

  it('P-B-3: disabled in the config and on (204) sends one DELETE after the GET', async () => {
    api().get(alertsPath).reply(204)
    api().delete(alertsPath).reply(204)

    await sync(false)

    expect(alertRequests()).toEqual(['GET 204', 'DELETE 204'])
  })

  it('P-B-3: any other answer to the read (a 403) sends the write, as today', async () => {
    api().get(alertsPath).reply(403, { message: 'Resource not accessible by integration' })
    api().put(alertsPath).reply(204)

    await sync(true)

    expect(alertRequests()).toEqual(['GET 403', 'PUT 204'])
    expect(writes()).toHaveLength(1)
  })

  it('P-B-3: a 403 with the alerts disabled in the config sends the DELETE', async () => {
    api().get(alertsPath).reply(403, { message: 'Resource not accessible by integration' })
    api().delete(alertsPath).reply(204)

    await sync(false)

    expect(alertRequests()).toEqual(['GET 403', 'DELETE 204'])
  })
})
