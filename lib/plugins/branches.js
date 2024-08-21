const ErrorStash = require('./errorStash')
const NopCommand = require('../nopcommand')
const MergeDeep = require('../mergeDeep')
const ignorableFields = []
const previewHeaders = {
  accept:
    'application/vnd.github.hellcat-preview+json,application/vnd.github.luke-cage-preview+json,application/vnd.github.zzzax-preview+json'
}

module.exports = class Branches extends ErrorStash {
  constructor(nop, github, repo, settings, log, errors) {
    super(errors, log, repo.repo)
    this.github = github
    this.repo = repo
    this.branches = settings
    this.nop = nop
  }

  sync() {
    const resArray = []
    return this.github.repos
      .get(this.repo)
      .then((currentRepo) => {
        return Promise.all(
          this.branches
            .filter((branch) => branch.protection !== undefined)
            .map((branch) => {
              this.log.debug(`Processing branch ${JSON.stringify(branch)}`)
              // If branch protection is empty
              if (this.isEmpty(branch.protection)) {
                let p = Object.assign(this.repo, { branch: branch.name })
                if (branch.name === 'default') {
                  p = Object.assign(this.repo, {
                    branch: currentRepo.data.default_branch
                  })
                  this.log.info(
                    `Deleting default branch protection for branch ${currentRepo.data.default_branch}`
                  )
                }
                // Hack to handle closures and keep params from changing
                const params = Object.assign({}, p)
                if (this.nop) {
                  resArray.push(
                    new NopCommand(
                      this.constructor.name,
                      this.repo,
                      this.github.repos.deleteBranchProtection.endpoint(params),
                      'Delete Branch Protection'
                    )
                  )
                  return Promise.resolve(resArray)
                }

                return this.github.repos
                  .deleteBranchProtection(params)
                  .catch((e) => {
                    return []
                  })
              } else {
                // Branch protection is not empty
                let p = Object.assign(this.repo, { branch: branch.name })
                if (branch.name === 'default') {
                  p = Object.assign(this.repo, {
                    branch: currentRepo.data.default_branch
                  })
                  // this.log.info(`Setting default branch protection for branch ${currentRepo.data.default_branch}`)
                }
                // Hack to handle closures and keep params from changing
                const params = Object.assign({}, p)
                return this.github.repos
                  .getBranchProtection(params)
                  .then((result) => {
                    const mergeDeep = new MergeDeep(
                      this.log,
                      this.github,
                      ignorableFields
                    )
                    const changes = mergeDeep.compareDeep(
                      {
                        branch: {
                          protection: this.reformatAndReturnBranchProtection(
                            result.data
                          )
                        }
                      },
                      { branch: { protection: branch.protection } }
                    )
                    const results = {
                      msg: `Followings changes will be applied to the branch protection for ${params.branch.name} branch`,
                      additions: changes.additions,
                      modifications: changes.modifications,
                      deletions: changes.deletions
                    }
                    this.log.debug(`Result of compareDeep = ${results}`)

                    if (!changes.hasChanges) {
                      this.log.debug(
                        `There are no changes for branch ${JSON.stringify(
                          params
                        )}. Skipping branch protection changes`
                      )
                      if (this.nop) {
                        return Promise.resolve(resArray)
                      }
                      return Promise.resolve()
                    }

                    this.log.debug(
                      `There are changes for branch ${JSON.stringify(
                        params
                      )}\n ${JSON.stringify(
                        changes
                      )} \n Branch protection will be applied`
                    )
                    if (this.nop) {
                      resArray.push(
                        new NopCommand(
                          this.constructor.name,
                          this.repo,
                          null,
                          results
                        )
                      )
                    }

                    Object.assign(params, branch.protection, {
                      headers: previewHeaders
                    })

                    if (this.nop) {
                      resArray.push(
                        new NopCommand(
                          this.constructor.name,
                          this.repo,
                          this.github.repos.updateBranchProtection.endpoint(
                            params
                          ),
                          'Add Branch Protection'
                        )
                      )
                      return Promise.resolve(resArray)
                    }
                    this.useCurrentBranchProtectionIfNotOverriddenOrDisable(
                      this.reformatAndReturnBranchProtection(result.data),
                      params
                    )
                    this.log.debug(
                      `Adding branch protection ${JSON.stringify(params)}`
                    )
                    return this.github.repos
                      .updateBranchProtection(params)
                      .then((res) =>
                        this.log.info(
                          `Branch protection applied successfully ${JSON.stringify(
                            res.url
                          )}`
                        )
                      )
                      .catch((e) => {
                        this.logError(
                          `Error applying branch protection ${JSON.stringify(
                            e
                          )}`
                        )
                        return []
                      })
                  })
                  .catch((e) => {
                    if (e.status === 404) {
                      Object.assign(params, branch.protection, {
                        headers: previewHeaders
                      })
                      if (this.nop) {
                        resArray.push(
                          new NopCommand(
                            this.constructor.name,
                            this.repo,
                            this.github.repos.updateBranchProtection.endpoint(
                              params
                            ),
                            'Add Branch Protection'
                          )
                        )
                        return Promise.resolve(resArray)
                      }
                      this.log.debug(
                        `Adding branch protection ${JSON.stringify(params)}`
                      )
                      return this.github.repos
                        .updateBranchProtection(params)
                        .then((res) =>
                          this.log.info(
                            `Branch protection applied successfully ${JSON.stringify(
                              res.url
                            )}`
                          )
                        )
                        .catch((e) => {
                          this.logError(
                            `Error applying branch protection ${JSON.stringify(
                              e
                            )}`
                          )
                          return []
                        })
                    } else {
                      this.logError(e)
                      if (this.nop) {
                        resArray.push(
                          new NopCommand(
                            this.constructor.name,
                            this.repo,
                            this.github.repos.updateBranchProtection.endpoint(
                              params
                            ),
                            `${e}`,
                            'ERROR'
                          )
                        )
                        return Promise.resolve(resArray)
                      }
                    }
                  })
              }
            })
        ).then((res) => {
          return res.flat(2)
        }) /* End of Promise.all */
      })
      .catch((e) => {
        // Repo is not found
        if (e.status === 404) {
          return Promise.resolve([])
        }
      })
  }

  isEmpty(maybeEmpty) {
    return maybeEmpty === null || Object.keys(maybeEmpty).length === 0
  }

  reformatAndReturnBranchProtection(protection) {
    if (protection) {
      // Re-format the enabled protection attributes
      protection.required_conversation_resolution =
        protection.required_conversation_resolution &&
        protection.required_conversation_resolution.enabled
      protection.allow_deletions =
        protection.allow_deletions &&
        protection.allow_deletions &&
        protection.allow_deletions.enabled
      protection.required_linear_history =
        protection.required_linear_history &&
        protection.required_linear_history.enabled
      protection.enforce_admins =
        protection.enforce_admins && protection.enforce_admins.enabled
      protection.required_signatures =
        protection.required_signatures && protection.required_signatures.enabled
      if (
        protection.required_pull_request_reviews &&
        !protection.required_pull_request_reviews.bypass_pull_request_allowances
      ) {
        protection.required_pull_request_reviews.bypass_pull_request_allowances =
          { apps: [], teams: [], users: [] }
      }
    }
    return protection
  }

  /**
   * Method applies branch protection settings coming from GitHub in case user did not specify them in safe-settings configurations.
   *
   * @param {*} currentBranchProtection
   * @param {*} overriddenBranchProtection
   */
  useCurrentBranchProtectionIfNotOverriddenOrDisable(
    currentBranchProtection,
    overriddenBranchProtection
  ) {
    this.log.debug('Branch protection current: %o', currentBranchProtection)
    this.log.debug(
      'Branch protection overridden: %o',
      overriddenBranchProtection
    )

    if (overriddenBranchProtection?.required_status_checks === undefined) {
      this.log.debug('required_status_checks not defined in settings files')
      if (currentBranchProtection.required_status_checks) {
        const { strict, checks } =
          currentBranchProtection.required_status_checks
        overriddenBranchProtection.required_status_checks = { strict, checks }
        this.log.debug(
          'Enabling required_status_checks: %o',
          overriddenBranchProtection.required_status_checks
        )
      } else {
        this.log.debug('Disabling required_status_checks')
        overriddenBranchProtection.required_status_checks = null
      }
    }
    const supportedAttributes = [
      { name: 'enforce_admins', required: true },
      { name: 'required_linear_history', required: false },
      { name: 'restrictions', required: true }
    ]
    supportedAttributes.forEach((e) => {
      this.checkAttribute(
        currentBranchProtection,
        overriddenBranchProtection,
        e.name,
        e.required
      )
    })

    this.log.debug('Branch protection updated: %o', overriddenBranchProtection)
  }

  checkAttribute(
    currentBranchProtection,
    overriddenBranchProtection,
    key,
    required = false
  ) {
    this.log.debug('Checking whether %s is defined in UI', key)
    if (overriddenBranchProtection[key] === undefined) {
      this.log.debug('%s not defined in settings files', key)
      if (Object.hasOwn(currentBranchProtection, key)) {
        overriddenBranchProtection[key] = currentBranchProtection[key]
        this.log.debug(
          'Setting %s to %o from UI',
          key,
          overriddenBranchProtection[key]
        )
      } else {
        if (required) {
          this.log.debug('Setting required attribute %s to null', key)
          overriddenBranchProtection[key] = null
        }
      }
    }
  }
}
