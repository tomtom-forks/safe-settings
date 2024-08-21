const Collaborators = require('../../../../lib/plugins/collaborators')
const { configureMockLogger } = require('../../common')

describe('Collaborators', () => {
  let github

  function configure (config) {
    const log = configureMockLogger()
    const errors = []
    return new Collaborators(undefined, github, { owner: 'bkeepers', repo: 'test' }, config, log, errors)
  }

  beforeEach(() => {
    github = {
      repos: {
        listInvitations: jest.fn().mockResolvedValue([]),
        deleteInvitation: jest.fn().mockResolvedValue(),
        updateInvitation: jest.fn().mockResolvedValue(),
        listCollaborators: jest.fn().mockResolvedValue([]),
        removeCollaborator: jest.fn().mockResolvedValue(),
        addCollaborator: jest.fn().mockResolvedValue()
      }
    }
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
})
