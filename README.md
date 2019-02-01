[![Build Status](https://dev.azure.com/phholler/consensus/_apis/build/status/pholleran.consensus?branchName=master)](https://dev.azure.com/phholler/consensus/_build/latest?definitionId=2&branchName=master)

# Get-Consensus

> A [Probot](https://github.com/probot/probot) app that lets repo admins require multiple reviewers from the same team by defining what constitutes consensus.

![image](https://user-images.githubusercontent.com/4007128/52101103-c95f3b00-259f-11e9-942a-b0e41422e302.png)

## Usage

1. Install the [app](https://github.com/apps/get-consensus)
2. Create a `.github/consensus.yml` file in your repository

```yaml
# these are the teams that will have a consensus enfored

teams:

  # the slug of a team as defined in https://developer.github.com/v3/teams/#response
  # this is also the team as defined in the url structure https://<gitHubHost>/<org/<teams>/<slug>
  - slug: myTeam

  # the consensus is the minimum number of approved reviews that constitue a consensus
  # acceptable values are:
  #   * an integer
  #   * majority (conensus will calculate a simple majority for the team)
  #   * all (all team memebrs)
    consensus: majority

```

When a review is requested from a team (either via [CODEOWNERS](https://help.github.com/articles/about-code-owners/), the [UI](https://help.github.com/articles/about-pull-request-reviews/#about-pull-request-reviews), or the API) `Get-Consensus` will create review requests from each team member. With each state change of the Pull Request the app will check to see if consensus was reached for each configured team.

> Note: committers to a Pull Request cannot submit reviews with an `approved/request changes` action. As such, committers to a Pull Request are removed when calculating `majority` or `all`.

> For example: `team-a` has four members, of which `mona` is one. A `majority` of `team-a` would be `3`. If `mona` is a committer to the Pull Request, she cannot provide an `approved` review, so the new `majority` (for the Pull Request in question) is `2` since, without her, there are `3` remaining team members who can review.

## Deploying

Get-Consensus can be deployed to your own environment following the [probot deployment documentation](https://probot.github.io/docs/deployment/).

If deploying to GitHub Enterprise Server:

* you must be running version `2.15` or later, as Get-Consensus makes use of the [checks API](https://developer.github.com/v3/checks/)
* be sure to set the `GHE_HOST` environment variable per the [probot documentation](https://probot.github.io/docs/github-api/#github-enterprise)

## License

[ISC](LICENSE) © 2019 Philip Holleran <pholleran@github.com>
