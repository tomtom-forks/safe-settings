// TomTom: what one run reads once and every plugin of that run shares.
//
// A repo, the org's security managers and a team's repo grants are the same answer for every plugin of a
// run, and an org-wide run asks for them for every repo. The caches live here, not on Settings, because the
// plugins read them and lib/settings.js requires the plugins. They are keyed on the run's Octokit client,
// as collaborators.js keys its membership cache: each Settings constructor begins a fresh set, and a client
// that never saw a Settings (a plugin test) gets one on first use.
//
// A failed read is never kept, except where said below, so the next caller reads again.
const caches = new WeakMap()

const keyOf = ({ owner, repo }) => `${owner}/${repo}`.toLowerCase()

class RunCache {
  constructor () {
    this.repos = new Map() // `owner/repo` -> Promise of the GET /repos/{o}/{r} response
    this.securityManagerLists = new Map() // org -> Promise of the list
    this.grantLists = new Map() // `org/slug` -> Promise of a Set of `owner/repo`, or of null when unreadable
    // True while eachRepositoryRepos walks the installation listing: the grant lists pay off then
    this.walkingListing = false
  }

  static begin (github) {
    const cache = new RunCache()
    caches.set(github, cache)
    return cache
  }

  static of (github) {
    let cache = caches.get(github)
    if (!cache) {
      cache = RunCache.begin(github)
    }
    return cache
  }

  // GET /repos/{o}/{r}, once per repo per run. Resolves to the response, as github.repos.get does.
  static repo (github, params) {
    const { repos } = RunCache.of(github)
    const key = keyOf(params)
    if (!repos.has(key)) {
      const read = Promise.resolve(github.repos.get({ owner: params.owner, repo: params.repo }))
      read.catch(() => repos.get(key) === read && repos.delete(key))
      repos.set(key, read)
    }
    return repos.get(key)
  }

  // A PATCH response, or what a rename left behind: later plugins of the run see it instead of reading again
  static setRepo (github, params, data) {
    RunCache.of(github).repos.set(keyOf(params), Promise.resolve({ data }))
  }

  // The default branch changed in this run: the entry keeps the rest of what was read
  static setDefaultBranch (github, params, defaultBranch) {
    const { repos } = RunCache.of(github)
    const key = keyOf(params)
    const read = repos.get(key)
    if (!read) {
      return
    }
    repos.set(key, read.then(response => ({ ...response, data: { ...response.data, default_branch: defaultBranch } })))
  }

  // GET /orgs/{org}/security-managers, once per run when it succeeds. A 404 or 410 (the endpoint is past its
  // announced sunset) means an empty list and is kept as well. Any other failure rejects and is not kept.
  static securityManagers (github, org) {
    const { securityManagerLists } = RunCache.of(github)
    if (!securityManagerLists.has(org)) {
      const read = Promise.resolve(github.paginate('GET /orgs/{org}/security-managers', { org })).catch(e => {
        if (e.status === 404 || e.status === 410) {
          return []
        }
        throw e
      })
      read.catch(() => securityManagerLists.get(org) === read && securityManagerLists.delete(org))
      securityManagerLists.set(org, read)
    }
    return securityManagerLists.get(org)
  }

  // GET /orgs/{org}/teams/{slug}/repos, all pages, once per team per run. Resolves to the Set of the repos
  // (lowercase `owner/repo`) the team has a grant on, or to null when the list cannot be read. That is kept
  // too, so the rest of the run checks the team per repo instead of asking for the list again.
  static teamGrants (github, org, slug) {
    const { grantLists } = RunCache.of(github)
    const key = `${org}/${slug}`.toLowerCase()
    if (!grantLists.has(key)) {
      const read = Promise.resolve(github.paginate('GET /orgs/{org}/teams/{team_slug}/repos', { org, team_slug: slug, per_page: 100 }))
        .then(repos => new Set(repos.map(r => (r.full_name || `${r.owner.login}/${r.name}`).toLowerCase())), () => null)
      grantLists.set(key, read)
    }
    return grantLists.get(key)
  }

  static startListing (github) {
    RunCache.of(github).walkingListing = true
  }

  static endListing (github) {
    RunCache.of(github).walkingListing = false
  }

  static isWalkingListing (github) {
    return RunCache.of(github).walkingListing
  }
}

module.exports = RunCache
