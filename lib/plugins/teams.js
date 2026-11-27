const Diffable = require('./diffable')
const NopCommand = require('../nopcommand')
const env = require('../env')
const RunCache = require('../runCache')

const teamRepoEndpoint = '/orgs/:owner/teams/:team_slug/repos/:owner/:repo'
module.exports = class Teams extends Diffable {
  async find () {
    this.log.debug(`Finding teams for ${this.repo.owner}/${this.repo.repo}`)
    return this.github.paginate(this.github.repos.listTeams, this.repo).then(res => {
      this.log.debug(`Found teams ${JSON.stringify(res)}`)
      return this.checkSecurityManager(res)
    }).then(teams => this.dropTeamsWithoutGrant(teams))
  }

  // TomTom: the repo's team list also shows teams that reach the repo through an org role. They are not in the
  // config, so the compare would DELETE their repo grant on every run, and that DELETE removes nothing. A team
  // outside the config is dropped from the list when it has no repo-level grant, so it is neither compared
  // nor deleted (and no dry run reports it).
  // A run that walks the installation listing reads each such team's grant list once. Any other run, and a run
  // whose list cannot be read, checks the team on this repo. A check that fails keeps the team in the list,
  // so the DELETE goes ahead as it did before.
  async dropTeamsWithoutGrant (teams) {
    const entries = this.filterEntries()
    const kept = []
    for (const team of teams) {
      if (entries.some(attrs => this.comparator(team, attrs)) || await this.hasRepoGrant(team)) {
        kept.push(team)
      } else {
        this.log.debug(`Team ${team.slug} has no repo-level grant on ${this.repo.owner}/${this.repo.repo}: nothing to remove`)
      }
    }
    return kept
  }

  async hasRepoGrant (team) {
    if (RunCache.isWalkingListing(this.github)) {
      const granted = await RunCache.teamGrants(this.github, this.repo.owner, team.slug)
      if (granted) {
        return granted.has(`${this.repo.owner}/${this.repo.repo}`.toLowerCase())
      }
    }
    try {
      await this.github.request('GET /orgs/{org}/teams/{team_slug}/repos/{owner}/{repo}', {
        org: this.repo.owner, team_slug: team.slug, owner: this.repo.owner, repo: this.repo.repo
      })
      return true
    } catch (e) {
      if (e.status === 404) {
        return false
      }
      this.log.debug(`Could not check the grant of team ${team.slug} on ${this.repo.owner}/${this.repo.repo}: ${e}`)
      return true
    }
  }

  // remove all security manager teams
  async checkSecurityManager (teams) {
    try {
      // Uncomment the following lines to handle the deprecation of the teams api https://gh.io/security-managers-rest-api-sunset
      // but this would require a new permission on the app
      //
      // const roles = await this.github.paginate('GET /orgs/{org}/roles', { org: this.repo.owner })
      // const securityManagerRole = roles.find(role => role.name === 'security_manager')
      //
      // this.log.debug(`Calling API to get security managers ${JSON.stringify(this.github.request.endpoint('GET /orgs/{org}/roles/{role_id}/teams',
      //   {
      //     org: this.repo.owner,
      //     role_id: securityManagerRole.id
      //   }))} `)
      // const resp = await this.github.paginate('GET /orgs/{org}/roles/{role_id}/teams',
      //   {
      //     org: this.repo.owner,
      //     role_id: securityManagerRole.id
      //   })

      this.log.debug('Removing all security manager teams since they should not be handled here')
      // TomTom: read once per run; 404 and 410 mean none and are kept, any other failure is not kept
      const resp = await RunCache.securityManagers(this.github, this.repo.owner)

      this.log.debug(`Response from the call is ${JSON.stringify(resp)}`)
      return teams.filter(team => !resp.some(sec => sec.name === team.name))
    } catch (e) {
      if (e.status === 404) {
        this.log.debug(`${this.repo.owner} Org does not have Security manager teams set up ${e}`)
      } else {
        this.log.error(
        `Unexpected error when fetching for security manager teams org ${this.repo.owner} = ${e}`
        )
      }
      return teams
    }
  }

  comparator (existing, attrs) {
    return existing.slug === attrs.name.toLowerCase()
  }

  changed (existing, attrs) {
    return existing.permission !== attrs.permission
  }

  update (existing, attrs) {
    if (this.nop) {
      return Promise.resolve([
        new NopCommand(this.constructor.name, this.repo, this.github.request.endpoint(`PUT ${teamRepoEndpoint}`, this.toParams(existing, attrs)), 'Add Teams to Repo')
      ])
    }
    return this.github.request(`PUT ${teamRepoEndpoint}`, this.toParams(existing, attrs))
  }

  add (attrs) {
    let existing = { team_id: 1 }
    this.log.debug(`Getting team with the parms ${JSON.stringify(attrs)}`)
    return this.github.teams.getByName({ org: this.repo.owner, team_slug: attrs.name }).then(res => {
      existing = res.data
      this.log.debug(`adding team ${attrs.name} to repo ${this.repo.repo}`)
      if (this.nop) {
        return Promise.resolve([
          new NopCommand(this.constructor.name, this.repo, this.github.teams.addOrUpdateRepoPermissionsInOrg.endpoint(this.toParams(existing, attrs)), 'Add Teams to Repo')
        ])
      }
      return this.github.teams.addOrUpdateRepoPermissionsInOrg(this.toParams(existing, attrs)).then(res => {
        this.log.debug(`team added ${res}`)
      }).catch(e => {
        this.logError(`Error adding team to repo ${JSON.stringify(e)} with parms ${JSON.stringify(this.toParams(existing, attrs))}:\n`, e)
      })
    }).catch(e => {
      if (e.status === 404) {
        if (env.FEATURE_CREATE_TEAMS_IF_NOT_EXIST !== 'true') {
          this.log.info(`Feature to create teams is disabled. Team ${attrs.name} not found, skipping.`)
          return
        }
        const createParam = {
          org: this.repo.owner,
          name: attrs.name
        }
        if (attrs.privacy) {
          createParam.privacy = attrs.privacy
        }
        this.log.debug(`Creating teams ${JSON.stringify(createParam)}`)
        if (this.nop) {
          return Promise.resolve([
            new NopCommand(this.constructor.name, this.repo, this.github.teams.create.endpoint(createParam), 'Create Team')
          ])
        }
        return this.github.teams.create(createParam).then(res => {
          this.log.debug(`team ${createParam.name} created`)
          existing = res.data
          this.log.debug(`adding team ${attrs.name} to repo ${this.repo.repo}`)
          return this.github.teams.addOrUpdateRepoPermissionsInOrg(this.toParams(existing, attrs))
        }).catch(e => {
          this.logError('Error adding team: ', e)
        })
      }
    })
  }

  remove (existing) {
    if (this.nop) {
      return Promise.resolve([
        new NopCommand(this.constructor.name, this.repo, this.github.request.endpoint(
          `DELETE ${teamRepoEndpoint}`,
          { team_slug: existing.slug, ...this.repo, org: this.repo.owner }
        ), 'DELETE Team')
      ])
    }
    return this.github.request(
      `DELETE ${teamRepoEndpoint}`,
      { team_slug: existing.slug, ...this.repo, org: this.repo.owner }
    )
  }

  toParams (existing, attrs) {
    return {
      team_id: existing.id,
      org: this.repo.owner,
      team_slug: attrs.name,
      owner: this.repo.owner,
      repo: this.repo.repo,
      permission: attrs.permission
    }
  }
}
