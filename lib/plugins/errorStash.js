// Base class to make it easy to log errors as issue in the `admin` repo
module.exports = class ErrorStash {
  constructor (errors, log, repoName) {
    this.errors = errors
    this.log = log.child({ plugin: this.constructor.name, repository: repoName })
  }

  logError (msg) {
    this.log.error(msg)
    this.errors.push({
      owner: this.repo.owner,
      repo: this.repo.repo,
      msg,
      plugin: this.constructor.name
    })
  }
}
