const ErrorStash = require('./errorStash')
const NopCommand = require('../nopcommand')
const MergeDeep = require('../mergeDeep')
const Overrides = require('./overrides')
const ignorableFields = []
const previewHeaders = { accept: 'application/vnd.github.hellcat-preview+json,application/vnd.github.luke-cage-preview+json,application/vnd.github.zzzax-preview+json' }
const overrides = {
  'contexts': {
    'action': 'reset',
    'type': 'array'
  },
}

module.exports = class Branches extends ErrorStash {
  constructor (nop, github, repo, settings, log, errors) {
    super(errors)
    this.github = github
    this.repo = repo
    this.branches = structuredClone(settings)
    this.log = log
    this.nop = nop
  }

  sync () {
    const resArray = []
    return this.github.repos.get(this.repo).then((currentRepo) => {
      return Promise.all(
        this.branches
          .filter(branch => branch.protection !== undefined)
          .map(branch => {
            // If branch protection is empty
            if (this.isEmpty(branch.protection)) {
              let p = Object.assign(this.repo, { branch: branch.name })
              if (branch.name === 'default') {
                p = Object.assign(this.repo, { branch: currentRepo.data.default_branch })
                this.log.debug(`Deleting default branch protection for branch ${currentRepo.data.default_branch}`)
              }
              // Hack to handle closures and keep params from changing
              const params = Object.assign({}, p)
              if (this.nop) {
                resArray.push(
                  new NopCommand(this.constructor.name, this.repo, this.github.repos.deleteBranchProtection.endpoint(params), 'Delete Branch Protection')
                )
                return Promise.resolve(resArray)
              }

              return this.github.repos.deleteBranchProtection(params).catch(e => { return [] })
            } else {
              // Branch protection is not empty
              let p = Object.assign(this.repo, { branch: branch.name })
              if (branch.name === 'default') {
                p = Object.assign(this.repo, { branch: currentRepo.data.default_branch })
                // this.log.debug(`Setting default branch protection for branch ${currentRepo.data.default_branch}`)
              }
              // Hack to handle closures and keep params from changing
              const params = Object.assign({}, p)
              return this.github.repos.getBranchProtection(params).then((result) => {
                // safe-settings 0.3.3 parity: GitHub's PUT requires required_status_checks
                // to be present (null disables it). If config omits it, reuse the repo's
                // current value (preserves out-of-band/UI-set checks), else null. Done
                // before compareDeep so an absent-in-config key isn't treated as a deletion.
                this.useCurrentRequiredStatusChecksIfNotOverridden(branch.protection, result.data)
                const mergeDeep = new MergeDeep(this.log, this.github, ignorableFields)
                const changes = mergeDeep.compareDeep({ branch: { protection: this.reformatAndReturnBranchProtection(result.data) } }, { branch: { protection: Overrides.removeOverrides(overrides, branch.protection, result.data) } })
                const results = { msg: `Followings changes will be applied to the branch protection for ${params.branch.name} branch`, additions: changes.additions, modifications: changes.modifications, deletions: changes.deletions }
                this.log.debug(`Result of compareDeep = ${results}`)

                if (!changes.hasChanges) {
                  this.log.debug(`There are no changes for branch ${JSON.stringify(params)}. Skipping branch protection changes`)
                  if (this.nop) {
                    return Promise.resolve(resArray)
                  }
                  return Promise.resolve()
                }

                this.log.debug(`There are changes for branch ${JSON.stringify(params)}\n ${JSON.stringify(changes)} \n Branch protection will be applied`)
                if (this.nop) {
                  resArray.push(new NopCommand(this.constructor.name, this.repo, null, results))
                }

                Object.assign(params, branch.protection, { headers: previewHeaders })

                if (this.nop) {
                  resArray.push(new NopCommand(this.constructor.name, this.repo, this.github.repos.updateBranchProtection.endpoint(params), 'Add Branch Protection'))
                  return Promise.resolve(resArray)
                }
                this.log.debug(`Adding branch protection ${JSON.stringify(params)}`)
                return this.github.repos.updateBranchProtection(params).then(res => this.log.debug(`Branch protection applied successfully ${JSON.stringify(res.url)}`)).catch(e => { this.logError(`Error applying branch protection ${JSON.stringify(e)}`); return [] })
              }).catch((e) => {
                if (e.status === 404) {
                  // No current protection (branch not protected yet) — required_status_checks
                  // must still be present in the PUT (null = none) to avoid a 422.
                  this.useCurrentRequiredStatusChecksIfNotOverridden(branch.protection, null)
                  Object.assign(params, Overrides.removeOverrides(overrides, branch.protection, {}), { headers: previewHeaders })
                  if (this.nop) {
                    resArray.push(new NopCommand(this.constructor.name, this.repo, this.github.repos.updateBranchProtection.endpoint(params), 'Add Branch Protection'))
                    return Promise.resolve(resArray)
                  }
                  this.log.debug(`Adding branch protection ${JSON.stringify(params)}`)
                  return this.github.repos.updateBranchProtection(params).then(res => this.log.debug(`Branch protection applied successfully ${JSON.stringify(res.url)}`)).catch(e => { this.logError(`Error applying branch protection ${JSON.stringify(e)}`); return [] })
                } else {
                  this.logError(e)
                  if (this.nop) {
                    resArray.push(new NopCommand(this.constructor.name, this.repo, this.github.repos.updateBranchProtection.endpoint(params), `${e}`, 'ERROR'))
                    return Promise.resolve(resArray)
                  }
                }
              })
            }
          })
      ).then(res => {
        return res.flat(2)
      }) /* End of Promise.all */
    }).catch(e => {
      // Repo is not found
      if (e.status === 404) {
        return Promise.resolve([])
      }
    })
  }

  isEmpty (maybeEmpty) {
    return (maybeEmpty === null) || Object.keys(maybeEmpty).length === 0
  }

  reformatAndReturnBranchProtection (protection) {
    if (protection) {
      // Re-format the enabled protection attributes
      protection.required_conversation_resolution = protection.required_conversation_resolution && protection.required_conversation_resolution.enabled
      protection.allow_deletions = protection.allow_deletions && protection.allow_deletions && protection.allow_deletions.enabled
      protection.required_linear_history = protection.required_linear_history && protection.required_linear_history.enabled
      protection.enforce_admins = protection.enforce_admins && protection.enforce_admins.enabled
      protection.required_signatures = protection.required_signatures && protection.required_signatures.enabled
      if (protection.required_pull_request_reviews && !protection.required_pull_request_reviews.bypass_pull_request_allowances) {
        protection.required_pull_request_reviews.bypass_pull_request_allowances = { apps: [], teams: [], users: [] }
      }
    }
    return protection
  }

  // safe-settings 0.3.3 parity. GitHub's update-branch-protection API requires
  // required_status_checks to be present in the PUT body (null disables it).
  // 2.1.18's plugin sends config verbatim, so a config that omits the key yields
  // a 422 "required_status_checks wasn't supplied". When config does not specify
  // it, reuse the repo's current GitHub value (so status checks configured
  // out-of-band — e.g. in the UI — are preserved), otherwise set null.
  useCurrentRequiredStatusChecksIfNotOverridden (protection, currentProtection) {
    if (!protection || protection.required_status_checks !== undefined) {
      return
    }
    if (currentProtection && currentProtection.required_status_checks) {
      const { strict, checks } = currentProtection.required_status_checks
      protection.required_status_checks = { strict, checks }
    } else {
      protection.required_status_checks = null
    }
  }
}
