/* eslint-disable no-undef */
const nock = require('nock')
const { createOctokit, recordRequests, api } = require('./github')

describe('test seam: ProbotOctokit on nock', () => {
  beforeAll(() => nock.disableNetConnect())
  afterAll(() => nock.enableNetConnect())
  afterEach(() => nock.cleanAll())

  it('answers a request from nock and lets hook.after see the rate-limit headers', async () => {
    api().get('/repos/o/r').reply(200, { default_branch: 'main' }, {
      'x-ratelimit-remaining': '4321',
      'x-ratelimit-reset': '1800000000',
      'x-ratelimit-resource': 'core'
    })
    const octokit = createOctokit()
    const seen = []
    octokit.hook.after('request', (response, options) => {
      seen.push({ url: options.url, headers: response.headers })
    })

    const res = await octokit.repos.get({ owner: 'o', repo: 'r' })

    expect(res.data.default_branch).toBe('main')
    expect(seen).toHaveLength(1)
    expect(seen[0].url).toBe('/repos/{owner}/{repo}')
    expect(seen[0].headers['x-ratelimit-remaining']).toBe('4321')
    expect(seen[0].headers['x-ratelimit-resource']).toBe('core')
  })

  it('does not retry a 500 and records the failed request once', async () => {
    api().get('/repos/o/r').once().reply(500, { message: 'boom' })
    const octokit = createOctokit()
    const requests = recordRequests(octokit)

    await expect(octokit.repos.get({ owner: 'o', repo: 'r' })).rejects.toMatchObject({ status: 500 })

    expect(requests).toEqual([{ method: 'GET', url: '/repos/{owner}/{repo}', status: 500 }])
    expect(nock.isDone()).toBe(true)
  })

  it('refuses a request nock was not told about', async () => {
    const octokit = createOctokit()
    await expect(octokit.repos.get({ owner: 'o', repo: 'unlisted' })).rejects.toBeDefined()
  })
})
