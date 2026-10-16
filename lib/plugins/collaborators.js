/* eslint-disable camelcase */
const Diffable = require('./diffable')
const NopCommand = require('../nopcommand')
const env = require('../env')

// TomTom: organization membership is checked once per user per sync run. Each webhook event or scheduled
// sync has its own client, so an org-wide sync does not check the same people for every repository, and a
// later event (e.g. SCIM removing a leaver) never reuses an earlier answer.
const membershipByClient = new WeakMap()
const NOT_MEMBERS_PLUGIN = 'Collaborators (not organization members)'

module.exports = class Collaborators extends Diffable {
  constructor (...args) {
    super(...args)

    if (this.entries) {
      // Force all usernames to lowercase to avoid comparison issues.
      this.entries.forEach(collaborator => {
        collaborator.username = collaborator.username.toLowerCase()
      })
    }
  }

  // TomTom: adding a collaborator who is not an organization member creates an outside collaborator
  // invitation. Organization access comes only from the access package (SCIM), so those collaborators are
  // left out of the desired state: they are never invited, and Diffable removes their existing invitation
  // or grant. Members are managed as before. COLLABORATORS_MEMBERS_ONLY=false restores upstream behaviour.
  async sync () {
    if (!this.entries || env.COLLABORATORS_MEMBERS_ONLY === 'false') {
      return super.sync()
    }
    let notMembers
    try {
      notMembers = await this.findNotMembers(this.filterEntries().map(collaborator => collaborator.username))
    } catch (e) {
      // Without knowing who is a member, neither invite nor remove anyone in this repository.
      const msg = `Collaborators of ${this.repo.owner}/${this.repo.repo} not synced: the organization membership check failed: ${e}`
      if (this.nop) {
        return [new NopCommand(this.constructor.name, this.repo, null, msg, 'ERROR')]
      }
      this.logError(msg)
      return
    }
    notMembers.forEach(username => this.log.warn(`COLLABORATOR_NOT_MEMBER repo=${this.repo.owner}/${this.repo.repo} user=${username}`))
    this.entries = this.entries.filter(collaborator => !notMembers.includes(collaborator.username))
    const results = await super.sync()
    if (this.nop && notMembers.length) {
      const action = {
        msg: 'Not organization members: safe-settings does not invite them (access comes from the access package)',
        additions: { never_invited: notMembers },
        modifications: null,
        deletions: null
      }
      return [...(results || []), new NopCommand(NOT_MEMBERS_PLUGIN, this.repo, null, action)]
    }
    return results
  }

  async findNotMembers (usernames) {
    const notMembers = []
    for (const username of usernames) {
      if (!await this.isMember(this.repo.owner, username)) {
        notMembers.push(username)
      }
    }
    return notMembers
  }

  isMember (org, username) {
    let cache = membershipByClient.get(this.github)
    if (!cache) {
      cache = new Map()
      membershipByClient.set(this.github, cache)
    }
    const key = `${org}/${username}`.toLowerCase()
    if (!cache.has(key)) {
      const member = this.fetchMembership(org, username)
      // A failed check is not remembered, so the next repository asks again.
      member.catch(() => cache.delete(key))
      cache.set(key, member)
    }
    return cache.get(key)
  }

  async fetchMembership (org, username) {
    try {
      // 'active': a member. 'pending': invited to the organization, not a member yet.
      const { data } = await this.github.orgs.getMembershipForUser({ org, username })
      return data.state === 'active'
    } catch (e) {
      // 404: not a member (an outside collaborator, or nobody).
      if (e.status === 404) {
        return false
      }
      throw e
    }
  }

  find () {
    // https://docs.github.com/en/rest/collaborators/collaborators?apiVersion=2022-11-28
    // 'outside' means all outside collaborators of an organization-owned repository.
    // 'direct' means all collaborators with permissions to an organization-owned repository, regardless of organization membership status. (includes outside collaborators)
    // 'all' means all collaborators the authenticated user can see.
    // We are using 'direct' to avoid double listing users outside collaborators and team members.
    return Promise.all([this.github.repos.listCollaborators({ repo: this.repo.repo, owner: this.repo.owner, affiliation: 'direct' }),
      this.github.repos.listInvitations({ repo: this.repo.repo, owner: this.repo.owner })])
      .then(res => {
        const mapCollaborator = user => {
          return {
            // Force all usernames to lowercase to avoid comparison issues.
            username: user.login.toLowerCase(),
            pendinginvite: false,
            permission: (user.permissions.admin && 'admin') ||
            (user.permissions.push && 'push') ||
            (user.permissions.pull && 'pull')
          }
        }

        const results1 = (res[0].data || []).map(mapCollaborator)
        const results2 = (res[1].data || []).map(invite => {
          return {
          // Force all usernames to lowercase to avoid comparison issues.
            username: invite.invitee.login.toLowerCase(),
            pendinginvite: true,
            invitation_id: invite.id,
            permission: (invite.permissions === 'admin' && 'admin') ||
            (invite.permissions === 'read' && 'pull') ||
            (invite.permissions === 'write' && 'push')
          }
        })
        return results1.concat(results2)
      })
      .catch(e => {
        this.logError(e)
        return []
      })
  }

  comparator (existing, attrs) {
    return existing.username === attrs.username
  }

  changed (existing, attrs) {
    return existing.permission !== attrs.permission
  }

  update (existing, attrs) {
    if (existing.pendinginvite) {
      return this.updateInvite(existing.invitation_id, attrs.permission)
    } else {
      return this.add(attrs)
    }
  }

  add (attrs) {
    const data = Object.assign({}, attrs, this.repo)
    if (this.nop) {
      return Promise.resolve([
        new NopCommand(this.constructor.name, this.repo, this.github.repos.addCollaborator.endpoint(data), 'Add Collaborators')
      ])
    }
    return this.github.repos.addCollaborator(data)
  }

  updateInvite (invitation_id, permissions) {
    const permissionMap = {
      admin: 'admin',
      pull: 'read',
      read: 'read',
      push: 'write',
      write: 'write',
      maintain: 'maintain',
      triage: 'triage'
    }
    const data = Object.assign({
      invitation_id,
      permissions: permissionMap[permissions] || permissions
    }, this.repo)
    if (this.nop) {
      return Promise.resolve([
        new NopCommand(this.constructor.name, this.repo, this.github.repos.updateInvitation.endpoint(data), 'Update Invitation')
      ])
    }
    return this.github.repos.updateInvitation(data)
  }

  remove (existing) {
    if (existing.pendinginvite) {
      const data = Object.assign({ invitation_id: existing.invitation_id }, this.repo)
      if (this.nop) {
        return Promise.resolve([
          new NopCommand(this.constructor.name, this.repo, this.github.repos.deleteInvitation.endpoint(data),
            'Delete Invitation')
        ])
      }
      return this.github.repos.deleteInvitation(data)
    } else {
      const data = Object.assign({ username: existing.username }, this.repo)
      if (this.nop) {
        return Promise.resolve([
          new NopCommand(this.constructor.name, this.repo, this.github.repos.removeCollaborator.endpoint(data),
            'Remove Collaborator')
        ])
      }
      return this.github.repos.removeCollaborator(data)
    }
  }
}
