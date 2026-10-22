const env = require('./env')

// TomTom: Policy - Transparency-by-default. A new repository is opened to the TRANSPARENCY_TEAM team
// (all-employees) with read access, once, when it is created. The retired github-settings app did this
// until 2026-09-09. Call it before the repository's settings are applied: a repo or suborg config that
// lists teams still decides who keeps access, and owners can opt out later by removing the team.
// A failed grant is logged and never stops the settings sync. TRANSPARENCY_TEAM=false turns it off.
async function grantTransparencyTeam (github, repository, log) {
  const team = env.TRANSPARENCY_TEAM
  if (team === 'false') {
    return
  }
  const org = repository.owner.login
  try {
    await github.teams.addOrUpdateRepoPermissionsInOrg({
      org,
      team_slug: team,
      owner: org,
      repo: repository.name,
      permission: 'pull'
    })
    log.info(`TRANSPARENCY_GRANTED repo=${org}/${repository.name} team=${team}`)
  } catch (e) {
    log.error(`TRANSPARENCY_FAILED repo=${org}/${repository.name} team=${team} status=${e.status}: ${e.message}`)
  }
}

module.exports = { grantTransparencyTeam }
