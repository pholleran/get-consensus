const nock = require('nock')
// Requiring our app implementation
const consensus = require('..')
const { Probot } = require('probot')
const _ = require('lodash')

// Requiring our fixtures
const reviewRequestedPayload = require('./fixtures/pull_request.review_requested')
const reviewSubmittedNoConsensus2 = require('./fixtures/pull_request_reviews.submitted.no_consensus2')
const reviewSubmittedNoConsensus = require('./fixtures/pull_request_reviews.submitted.no_consensus')

const qaTeamValidationQuery = '{"query":"\\n    query teamMembers($login: String!, $slug: String!) {\\n      organization(login: $login) {\\n        team(slug: $slug) {\\n          name\\n        }\\n      }\\n    }","variables":{"login":"pH-Inc","slug":"qa"}}'
const qaTeamData = { data: { organization: { team: { members: { nodes: [ { login: 'technical-lead' }, { login: 'spock' }, { login: 'pholleran' }, { login: 'woz' } ] } } } } }
const buildTeamValidationQuery = '{"query":"\\n    query teamMembers($login: String!, $slug: String!) {\\n      organization(login: $login) {\\n        team(slug: $slug) {\\n          name\\n        }\\n      }\\n    }","variables":{"login":"pH-Inc","slug":"build"}}'
const buildTeamData = { data: { organization: { team: { members: { nodes: [ { login: 'spock' }, { login: 'pholleran' } ] } } } } }
const qaTeamMemberQuery = '{"query":"\\n    query teamMembers($login: String!, $slug: String!) {\\n      organization(login: $login) {\\n        team(slug: $slug) {\\n          members(first: 100) {\\n            nodes {\\n              login\\n            }\\n          }\\n        }\\n      }\\n    }","variables":{"login":"pH-Inc","slug":"qa"}}'
const buildTeamMemberQuery = '{"query":"\\n    query teamMembers($login: String!, $slug: String!) {\\n      organization(login: $login) {\\n        team(slug: $slug) {\\n          members(first: 100) {\\n            nodes {\\n              login\\n            }\\n          }\\n        }\\n      }\\n    }","variables":{"login":"pH-Inc","slug":"build"}}'

nock.disableNetConnect()

describe('My Probot app', async () => {
  let probot

  beforeEach(() => {
    process.env.GHE_HOST = 'octodemo.com'
    probot = new Probot({})
    const app = probot.load(consensus)

    // just return a test token
    app.app = () => 'test'
  })

  test('requests reviews from configured team members', async () => {
    // mock an installation token
    nock('https://octodemo.com/api/v3')
      .post('/app/installations/10/access_tokens')
      .reply(200, { token: 'test' })

    // mock the config
    nock('https://octodemo.com/api/v3')
      .get('/repos/pH-Inc/test-consensus/contents/.github/consensus.yml')
      .reply(200, {
        'content': 'dGVhbXM6CiAgLSBzbHVnOiBxYQogICAgY29uc2Vuc3VzOiBtYWpvcml0eQog\nIC0gc2x1ZzogYnVpbGQKICAgIGNvbnNlbnN1czogYWxsCg==\n'
      })

    // mock the qa team validation query
    // mad props to @lewisblackwood for having the answer to how to properly
    // pass a graphql objet back to nock.js https://gist.github.com/lewisblackwood/b71c7063fd5fcf9c7510072d1c60ee20
    nock('https://octodemo.com/api')
      .post('/graphql', qaTeamValidationQuery)
      .reply(200, qaTeamData)

    // mock the build team validation query
    nock('https://octodemo.com/api')
      .post('/graphql', buildTeamValidationQuery)
      .reply(200, buildTeamData)

    // mock the reviews query and return nothing
    nock('https://octodemo.com/api/v3')
      .get('/repos/pH-Inc/test-consensus/pulls/8/reviews')
      .reply(200, [])

    // mock the query for qa team members
    nock('https://octodemo.com/api/v3')
      .get('/teams/181/members')
      .reply(200, [ { login: 'technical-lead' }, { login: 'spock' }, { login: 'pholleran' }, { login: 'woz' } ])

    // mock the requested_reviewers post
    nock('https://octodemo.com/api/v3')
      .post('/repos/pH-Inc/test-consensus/pulls/8/requested_reviewers', _.matches({ reviewers: ['technical-lead', 'spock', 'woz'] }))
      .reply(200)

    // Recieve a webhook event
    await probot.receive({ name: 'pull_request', payload: reviewRequestedPayload })
  }, 20000)

  test('creates a failing check when review threshold is not met', async () => {
    // mock an installation token
    nock('https://octodemo.com/api/v3')
      .post('/app/installations/10/access_tokens')
      .reply(200, { token: 'test' })

    // mock the config
    nock('https://octodemo.com/api/v3')
      .get('/repos/pH-Inc/test-consensus/contents/.github/consensus.yml')
      .reply(200, {
        'content': 'dGVhbXM6CiAgLSBzbHVnOiBxYQogICAgY29uc2Vuc3VzOiBtYWpvcml0eQog\nIC0gc2x1ZzogYnVpbGQKICAgIGNvbnNlbnN1czogYWxsCg==\n'
      })

    // mock the qa team validation query
    nock('https://octodemo.com/api')
      .post('/graphql', qaTeamValidationQuery)
      .reply(200, qaTeamData)

    // mock the build team validation query
    nock('https://octodemo.com/api')
      .post('/graphql', buildTeamValidationQuery)
      .reply(200, buildTeamData)

    // mock the commits query
    nock('https://octodemo.com/api/v3')
      .get('/repos/pH-Inc/test-consensus/pulls/8/commits')
      .reply(200, [ { commit: { author: { name: 'pholleran' } }, author: { login: 'pholleran' } } ])

    // mock the reviews query
    nock('https://octodemo.com/api/v3')
      .get('/repos/pH-Inc/test-consensus/pulls/8/reviews')
      .reply(200, [ { user: { login: 'spock' }, state: 'APPROVED' } ])

    // mock the qa team member query
    nock('https://octodemo.com/api')
      .post('/graphql', qaTeamMemberQuery)
      .reply(200, qaTeamData)

    // mock the build team query
    nock('https://octodemo.com/api')
      .post('/graphql', buildTeamMemberQuery)
      .reply(200, buildTeamData)

    nock('https://octodemo.com/api/v3')
      .post('/repos/pH-Inc/test-consensus/check-runs', (body) => {
        expect(body.conclusion).toBe('failure')
        return true
      })
      .reply(200)

    await probot.receive({ name: 'pull_request_review', payload: reviewSubmittedNoConsensus })

  }, 10000)

  test('creates a passing check when review threshold is met', async () => {
    // mock an installation token
    nock('https://octodemo.com/api/v3')
      .post('/app/installations/10/access_tokens')
      .reply(200, { token: 'test' })
 
    // mock the config
    nock('https://octodemo.com/api/v3')
      .get('/repos/pH-Inc/test-consensus/contents/.github/consensus.yml')
      .reply(200, {
        'content': 'dGVhbXM6CiAgLSBzbHVnOiBxYQogICAgY29uc2Vuc3VzOiBtYWpvcml0eQog\nIC0gc2x1ZzogYnVpbGQKICAgIGNvbnNlbnN1czogYWxsCg==\n'
      })

    // mock the qa team validation query
    nock('https://octodemo.com/api')
      .post('/graphql', qaTeamValidationQuery)
      .reply(200, qaTeamData)

    // mock the build team validation query
    nock('https://octodemo.com/api')
      .post('/graphql', buildTeamValidationQuery)
      .reply(200, buildTeamData)

    // mock the commits query
    nock('https://octodemo.com/api/v3')
      .get('/repos/pH-Inc/test-consensus/pulls/8/commits')
      .reply(200, [ { commit: { author: { name: 'pholleran' } }, author: { login: 'pholleran' } } ])

    // mock the reviews query
    nock('https://octodemo.com/api/v3')
      .get('/repos/pH-Inc/test-consensus/pulls/8/reviews')
      .reply(200, [ { user: { login: 'spock' }, state: 'APPROVED' }, { user: { login: 'woz' }, state: 'APPROVED' }, { user: { login: 'technical-lead' }, state: 'APPROVED' } ])

    // mock the qa team member query
    nock('https://octodemo.com/api')
      .post('/graphql', qaTeamMemberQuery)
      .reply(200, qaTeamData)

    // mock the build team query
    nock('https://octodemo.com/api')
      .post('/graphql', buildTeamMemberQuery)
      .reply(200, buildTeamData)

    // mock the check run
    nock('https://octodemo.com/api/v3')
      .post('/repos/pH-Inc/test-consensus/check-runs', (body) => {
        expect(body.conclusion).toBe('success')
        return true
      })
      .reply(200)

    await probot.receive({ name: 'pull_request_review', payload: reviewSubmittedNoConsensus2 })
  }, 10000)
  
})
