module.exports = app => {
  app.on('pull_request.review_requested', async context => {
    const config = await getConfig(context)
    if (config.error) {
      // report config error in check
      let e = {
        conclusion: 'failure',
        title: 'Configuration Error',
        message: config.error
      }
      await createCheck(context, e)
    } else {
      const consensusTeams = config.teams
      const requestedTeams = context.payload.pull_request.requested_teams

      for (const team of requestedTeams) {
        for (const consTeam of consensusTeams) {
          if (team.slug === consTeam.slug) {
            await addReviewers(context, team)
          }
        }
      }
    }
  })

  app.on(['pull_request.synchronize', 'pull_request_review.submitted'], async context => {
    const config = await getConfig(context)
    if (config.error) {
      let e = {
        conclusion: 'failure',
        title: 'Configuration Error',
        message: config.error
      }
      await createCheck(context, e)
    } else {
      const consensusTeams = config.teams
      let prInfo = {
        owner: context.payload.repository.owner.login,
        repo: context.payload.repository.name,
        number: 0
      }
      if (context.payload.pull_request) {
        prInfo.number = context.payload.pull_request.number
      } else {
        prInfo.number = context.payload.check_run.pull_requests[0].number
      }

      // get PR commit authors and reviews
      const commitAuthors = await getCommitAuthors(context, prInfo)
      const reviewResponse = await context.github.pullRequests.listReviews(prInfo)

      // manipulate review response into a simple object to make it easier to work with
      let reviews = {}

      for (const r of reviewResponse.data) {
        reviews[r.user.login] = r.state
      }

      // get the results of the consensus test
      const consensusResults = await getConsensus(context, consensusTeams, reviews, commitAuthors)

      await createCheck(context, consensusResults)
    }
  })
}

const addReviewers = async (context, team) => {
  // get existing reviewers (requested and completed) for the PR
  let reviewers = []

  for (const requestedReviewer of context.payload.pull_request.requested_reviewers) {
    if (reviewers.indexOf(requestedReviewer.login) === -1) {
      reviewers.push(requestedReviewer.login)
    }
  }

  const reviews = await context.github.pullRequests.listReviews({
    owner: context.payload.repository.owner.login,
    repo: context.payload.repository.name,
    number: context.payload.pull_request.number
  })

  for (const review of reviews.data) {
    if (reviewers.indexOf(review.user.login) === -1) {
      reviewers.push(review.user.login)
    }
  }

  // get team members and iterate
  const membersRequest = await context.github.teams.listMembers({
    team_id: team.id
  })
  let reviewLogins = []
  for (const teamMember of membersRequest.data) {
    // check if team member is a reviwer, add them if not
    if (reviewers.indexOf(teamMember.login) === -1 && teamMember.login !== context.payload.pull_request.user.login) {
      reviewLogins.push(teamMember.login)
    }
  }
  await context.github.pullRequests.createReviewRequest({
    owner: context.payload.repository.owner.login,
    repo: context.payload.repository.name,
    number: context.payload.pull_request.number,
    reviewers: reviewLogins
  })
}

const createCheck = async (context, consensusResults) => {
  // create a check with the results
  var completedTime = new Date().toISOString()
  let sha
  if (context.payload.check_run) {
    sha = context.payload.check_run.head_sha
  } else if (context.payload.pull_request) {
    sha = context.payload.pull_request.head.sha
  }

  await context.github.checks.create(context.repo({
    name: 'Get Consensus',
    head_sha: sha,
    status: 'completed',
    conclusion: consensusResults.conclusion,
    completed_at: completedTime,
    output: {
      title: consensusResults.title,
      summary: consensusResults.message
    }
  }))
}

const getCommitAuthors = async (context, prInfo) => {
  let commits = await context.github.pullRequests.listCommits(prInfo)
  let authors = []
  for (const c of commits.data) {
    if (authors.indexOf(c.commit.author.name) === -1) {
      authors.push(c.author.login)
    }
  }
  return authors
}

// get app config & validate it's properly formatted
const getConfig = async (context) => {
  const config = await context.config('consensus.yml')
  let valid = true
  let message = ''

  // does config.yml have a `teams` entry
  if (config.teams) {
    for (const t of config.teams) {
      // does each team have a slug
      if (t.slug === undefined) {
        valid = false
        message = message + 'One or more entries for `teams` in `.github/consensus.yml` is missing a slug.\n'
      }

      // if so, does each have a valid consensus
      if (t.consensus === undefined) {
        valid = false
        message = message + 'The team with slug `' + t.slug + '` in `.github/consensus.yml` is missing a consensus.\n'
      }
      if (Number.isInteger(t.consensus) === false) {
        if (['all', 'majority'].indexOf(t.consensus) === -1) {
          valid = false
          message = 'The team with slug `' + t.slug + '` in `.github/consensus.yml` has an invalid consensus.\n'
        }
      }

      // if so, is it a valid team
      if (await validateTeamBySlug(context, t.slug) === false) {
        valid = false
        message = 'The slug `' + t.slug + '` in `.github/consensus.yml` is not a slug of a valid team.\n'
      }
    }
  } else {
    valid = false
    message = message + 'The entry for `teams` in `.github/consensus.yml` is missing or improperly formatted.'
  }
  if (valid === true) {
    return config
  } else {
    return {
      error: message
    }
  }
}

const getConsensus = async (context, consensusTeams, reviews, commitAuthors) => {
  let teamStatus = []

  // await Promise.all(consensusTeams.map(async (team) => {
  for (const team of consensusTeams) {
    let t = {}
    t.slug = team.slug

    // get team members & total count
    let consensusTeamMembers = await getTeamMembersBySlug(context, team.slug)
    let consensusTeamMemberCount = consensusTeamMembers.length

    // subtract those who have committed from total team members who can review
    for (const m of consensusTeamMembers) {
      if (commitAuthors.indexOf(m) !== -1) {
        consensusTeamMemberCount -= 1
      }
    }

    // get consensus threshold
    let consensusThreshold
    if (Number.isInteger(team.consensus)) {
      consensusThreshold = team.consensus
    } else if (team.consensus === 'majority') {
      consensusThreshold = Math.floor(consensusTeamMemberCount / 2)
    } else if (team.consensus === 'all') {
      consensusThreshold = consensusTeamMemberCount - 1
    } else {
      console.log('handle error')
    }

    // check if threshold is met
    let consensusSuccessCount = 0
    for (let i = 0; i < consensusTeamMembers.length; i++) {
      let member = consensusTeamMembers[i]
      if (reviews[member] === 'APPROVED') {
        consensusSuccessCount++
      }
    }
    if (consensusSuccessCount > consensusThreshold) {
      t.status = 'success'
      t.message = 'Consensus reached.'
    } else {
      t.status = 'failure'
      t.message = 'Consensus not reached. Requires ' + (consensusThreshold + 1) + ' approved reviews. ' + consensusSuccessCount + ' obtained.'
    }
    teamStatus.push(t)
  }

  // generate and populate response object
  let r = {
    title: 'Team results',
    message: '',
    conclusion: ''
  }
  for (const s of teamStatus) {
    // generate message
    let m = '**Team:** ' + s.slug + '\n**Results:** ' + s.message + '\n'
    if (r.message) {
      r.message = r.message + '\n' + m
    } else {
      r.message = m
    }
    // generate conclusion
    if (r.conclusion === '') {
      r.conclusion = s.status
    } else if (r.conclusion === 'success' && s.status === 'failure') {
      r.conclusion = s.status
    }
  }
  return r
}

const getTeamMembersBySlug = async (context, slug) => {
  const members = `
    query teamMembers($login: String!, $slug: String!) {
      organization(login: $login) {
        team(slug: $slug) {
          members(first: 100) {
            nodes {
              login
            }
          }
        }
      }
    }`
  let queryResult = await context.github.query(members, {
    login: context.payload.organization.login,
    slug: slug
  })
  let results = []

  for (const node of queryResult.organization.team.members.nodes) {
    results.push(node.login)
  }
  return results
}

const validateTeamBySlug = async (context, slug) => {
  const team = `
    query teamMembers($login: String!, $slug: String!) {
      organization(login: $login) {
        team(slug: $slug) {
          name
        }
      }
    }`
  let queryResult = await context.github.query(team, {
    login: context.payload.organization.login,
    slug: slug
  })
  if (queryResult.organization.team === null) {
    return false
  } else {
    return true
  }
}
