const Collaborators = require('../../../../lib/plugins/collaborators')
const env = require('../../../../lib/env')

describe('Collaborators', () => {
  let github
  let log
  let errors

  function configure (config, nop = undefined) {
    log = { debug: jest.fn(), warn: jest.fn(), error: jest.fn() }
    errors = []
    return new Collaborators(nop, github, { owner: 'bkeepers', repo: 'test' }, config, log, errors)
  }

  function withEndpoint (fn) {
    fn.endpoint = jest.fn(data => ({ url: `/repos/${data.owner}/${data.repo}`, body: data }))
    return fn
  }

  function newGithub () {
    return {
      orgs: {
        getMembershipForUser: jest.fn().mockResolvedValue({ data: { state: 'active' } })
      },
      repos: {
        listInvitations: jest.fn().mockResolvedValue([]),
        deleteInvitation: withEndpoint(jest.fn().mockResolvedValue()),
        updateInvitation: withEndpoint(jest.fn().mockResolvedValue()),
        listCollaborators: jest.fn().mockResolvedValue([]),
        removeCollaborator: withEndpoint(jest.fn().mockResolvedValue()),
        addCollaborator: withEndpoint(jest.fn().mockResolvedValue())
      }
    }
  }

  function notMembers (...usernames) {
    github.orgs.getMembershipForUser.mockImplementation(({ username }) => usernames.includes(username)
      ? Promise.reject(Object.assign(new Error('Not Found'), { status: 404 }))
      : Promise.resolve({ data: { state: 'active' } }))
  }

  beforeEach(() => {
    github = newGithub()
  })

  describe('sync', () => {
    it('syncs collaborators', () => {
      const plugin = configure([
        { username: 'bkeepers', permission: 'admin' },
        { username: 'added-user', permission: 'push' },
        { username: 'updated-permission', permission: 'push' },
        { username: 'DIFFERENTcase', permission: 'push' }
      ])

      github.repos.listCollaborators.mockResolvedValueOnce({
        data: [
          { login: 'bkeepers', permissions: { admin: true, push: true, pull: true } },
          { login: 'updated-permission', permissions: { admin: false, push: false, pull: true } },
          { login: 'removed-user', permissions: { admin: false, push: true, pull: true } },
          { login: 'differentCase', permissions: { admin: false, push: true, pull: true } }
        ]
      })

      return plugin.sync().then(() => {
        expect(github.repos.addCollaborator).toHaveBeenCalledWith({
          owner: 'bkeepers',
          repo: 'test',
          username: 'added-user',
          permission: 'push'
        })

        expect(github.repos.addCollaborator).toHaveBeenCalledWith({
          owner: 'bkeepers',
          repo: 'test',
          username: 'updated-permission',
          permission: 'push'
        })

        expect(github.repos.addCollaborator).toHaveBeenCalledTimes(2)

        expect(github.repos.removeCollaborator).toHaveBeenCalledWith({
          owner: 'bkeepers',
          repo: 'test',
          username: 'removed-user'
        })

        expect(github.repos.removeCollaborator).toHaveBeenCalledTimes(1)
      })
    })
  })

  describe('members only (TomTom)', () => {
    afterEach(() => {
      env.COLLABORATORS_MEMBERS_ONLY = 'true'
    })

    it('does not invite a collaborator who is not an organization member', async () => {
      notMembers('outsider')
      const plugin = configure([
        { username: 'member', permission: 'push' },
        { username: 'Outsider', permission: 'push' }
      ])

      await plugin.sync()

      expect(github.repos.addCollaborator).toHaveBeenCalledTimes(1)
      expect(github.repos.addCollaborator).toHaveBeenCalledWith({ owner: 'bkeepers', repo: 'test', username: 'member', permission: 'push' })
      expect(github.orgs.getMembershipForUser).toHaveBeenCalledWith({ org: 'bkeepers', username: 'outsider' })
      expect(log.warn).toHaveBeenCalledWith('COLLABORATOR_NOT_MEMBER repo=bkeepers/test user=outsider')
    })

    it('treats a pending organization invitation as not a member', async () => {
      github.orgs.getMembershipForUser.mockResolvedValue({ data: { state: 'pending' } })
      const plugin = configure([{ username: 'invited', permission: 'push' }])

      await plugin.sync()

      expect(github.repos.addCollaborator).not.toHaveBeenCalled()
      expect(log.warn).toHaveBeenCalledWith('COLLABORATOR_NOT_MEMBER repo=bkeepers/test user=invited')
    })

    it('cancels the invitation of a collaborator who is not an organization member', async () => {
      notMembers('outsider')
      github.repos.listInvitations.mockResolvedValueOnce({
        data: [{ id: 7, invitee: { login: 'Outsider' }, permissions: 'write' }]
      })
      const plugin = configure([{ username: 'outsider', permission: 'push' }])

      await plugin.sync()

      expect(github.repos.deleteInvitation).toHaveBeenCalledWith({ owner: 'bkeepers', repo: 'test', invitation_id: 7 })
      expect(github.repos.addCollaborator).not.toHaveBeenCalled()
      expect(github.repos.updateInvitation).not.toHaveBeenCalled()
    })

    it('removes a collaborator who is no longer an organization member', async () => {
      notMembers('leaver')
      github.repos.listCollaborators.mockResolvedValueOnce({
        data: [{ login: 'leaver', permissions: { admin: false, push: true, pull: true } }]
      })
      const plugin = configure([{ username: 'leaver', permission: 'push' }])

      await plugin.sync()

      expect(github.repos.removeCollaborator).toHaveBeenCalledWith({ owner: 'bkeepers', repo: 'test', username: 'leaver' })
      expect(github.repos.addCollaborator).not.toHaveBeenCalled()
    })

    it('checks only the collaborators that apply to the repository', async () => {
      const plugin = configure([
        { username: 'member', permission: 'push' },
        { username: 'elsewhere', permission: 'push', exclude: ['test'] }
      ])

      await plugin.sync()

      expect(github.orgs.getMembershipForUser).toHaveBeenCalledTimes(1)
      expect(github.orgs.getMembershipForUser).toHaveBeenCalledWith({ org: 'bkeepers', username: 'member' })
    })

    it('makes no changes when the membership check fails', async () => {
      github.orgs.getMembershipForUser.mockRejectedValue(Object.assign(new Error('Server Error'), { status: 500 }))
      github.repos.listCollaborators.mockResolvedValue({
        data: [{ login: 'removed-user', permissions: { admin: false, push: true, pull: true } }]
      })
      const plugin = configure([{ username: 'added-user', permission: 'push' }])

      await plugin.sync()

      expect(github.repos.listCollaborators).not.toHaveBeenCalled()
      expect(github.repos.addCollaborator).not.toHaveBeenCalled()
      expect(github.repos.removeCollaborator).not.toHaveBeenCalled()
      expect(log.error).toHaveBeenCalledTimes(1)
      expect(errors).toHaveLength(1)
      expect(errors[0].msg).toContain('organization membership check failed')
    })

    it('reports a failed membership check as an error in dry run', async () => {
      github.orgs.getMembershipForUser.mockRejectedValue(Object.assign(new Error('Server Error'), { status: 500 }))
      const plugin = configure([{ username: 'added-user', permission: 'push' }], true)

      const results = await plugin.sync()

      expect(results).toHaveLength(1)
      expect(results[0].type).toBe('ERROR')
      expect(results[0].plugin).toBe('Collaborators')
      expect(results[0].action.msg).toContain('organization membership check failed')
    })

    it('reports the collaborators it does not invite in dry run', async () => {
      notMembers('outsider')
      const plugin = configure([
        { username: 'member', permission: 'push' },
        { username: 'outsider', permission: 'push' }
      ], true)

      const results = await plugin.sync()

      expect(github.repos.addCollaborator).not.toHaveBeenCalled()
      expect(github.repos.addCollaborator.endpoint).toHaveBeenCalledTimes(1)
      expect(github.repos.addCollaborator.endpoint).toHaveBeenCalledWith({ owner: 'bkeepers', repo: 'test', username: 'member', permission: 'push' })
      const notInvited = results.find(result => result.plugin === 'Collaborators (not organization members)')
      expect(notInvited.type).toBe('INFO')
      expect(notInvited.repo).toBe('test')
      expect(notInvited.action.additions).toEqual({ never_invited: ['outsider'] })
    })

    it('checks each user once per sync run', async () => {
      await configure([{ username: 'member', permission: 'push' }]).sync()
      await configure([{ username: 'Member', permission: 'admin' }]).sync()
      expect(github.orgs.getMembershipForUser).toHaveBeenCalledTimes(1)

      // A new webhook event or scheduled sync has a new client, so it asks again.
      github = newGithub()
      await configure([{ username: 'member', permission: 'push' }]).sync()
      expect(github.orgs.getMembershipForUser).toHaveBeenCalledTimes(1)
    })

    it('asks again after a failed membership check', async () => {
      github.orgs.getMembershipForUser.mockRejectedValueOnce(Object.assign(new Error('Server Error'), { status: 500 }))
      await configure([{ username: 'member', permission: 'push' }]).sync()
      expect(github.repos.addCollaborator).not.toHaveBeenCalled()

      await configure([{ username: 'member', permission: 'push' }]).sync()

      expect(github.orgs.getMembershipForUser).toHaveBeenCalledTimes(2)
      expect(github.repos.addCollaborator).toHaveBeenCalledWith({ owner: 'bkeepers', repo: 'test', username: 'member', permission: 'push' })
    })

    it('keeps the upstream behaviour when COLLABORATORS_MEMBERS_ONLY is false', async () => {
      env.COLLABORATORS_MEMBERS_ONLY = 'false'
      notMembers('outsider')
      const plugin = configure([{ username: 'outsider', permission: 'push' }])

      await plugin.sync()

      expect(github.orgs.getMembershipForUser).not.toHaveBeenCalled()
      expect(github.repos.addCollaborator).toHaveBeenCalledWith({ owner: 'bkeepers', repo: 'test', username: 'outsider', permission: 'push' })
    })
  })
})
