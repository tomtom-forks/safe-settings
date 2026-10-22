/* eslint-disable no-undef */
const env = require('../../../lib/env')
const { grantTransparencyTeam } = require('../../../lib/transparency')

describe('grantTransparencyTeam', () => {
  const repository = { name: 'new-repo', owner: { login: 'tomtom-internal' } }
  let github, log

  beforeEach(() => {
    env.TRANSPARENCY_TEAM = 'all-employees'
    github = { teams: { addOrUpdateRepoPermissionsInOrg: jest.fn().mockResolvedValue({ status: 204 }) } }
    log = { info: jest.fn(), error: jest.fn() }
  })

  afterAll(() => {
    env.TRANSPARENCY_TEAM = 'all-employees'
  })

  it('gives all-employees read access to the new repository', async () => {
    await grantTransparencyTeam(github, repository, log)

    expect(github.teams.addOrUpdateRepoPermissionsInOrg).toHaveBeenCalledWith({
      org: 'tomtom-internal',
      team_slug: 'all-employees',
      owner: 'tomtom-internal',
      repo: 'new-repo',
      permission: 'pull'
    })
    expect(log.info).toHaveBeenCalledWith('TRANSPARENCY_GRANTED repo=tomtom-internal/new-repo team=all-employees')
  })

  it('uses the team set in TRANSPARENCY_TEAM', async () => {
    env.TRANSPARENCY_TEAM = 'everyone'

    await grantTransparencyTeam(github, repository, log)

    expect(github.teams.addOrUpdateRepoPermissionsInOrg).toHaveBeenCalledWith(expect.objectContaining({ team_slug: 'everyone' }))
  })

  it('does nothing when TRANSPARENCY_TEAM is false', async () => {
    env.TRANSPARENCY_TEAM = 'false'

    await grantTransparencyTeam(github, repository, log)

    expect(github.teams.addOrUpdateRepoPermissionsInOrg).not.toHaveBeenCalled()
    expect(log.info).not.toHaveBeenCalled()
  })

  it('logs a failed grant and does not throw, so the settings sync still runs', async () => {
    github.teams.addOrUpdateRepoPermissionsInOrg.mockRejectedValue(Object.assign(new Error('Not Found'), { status: 404 }))

    await expect(grantTransparencyTeam(github, repository, log)).resolves.toBeUndefined()

    expect(log.error).toHaveBeenCalledWith('TRANSPARENCY_FAILED repo=tomtom-internal/new-repo team=all-employees status=404: Not Found')
    expect(log.info).not.toHaveBeenCalled()
  })
})
