# Notes for working on stede

## Pushing to GitHub

The repository belongs to the `arnaudbrejeon` GitHub account, but the active
`gh` account on this machine is `arnaud-secondlayer`, so a plain `git push`
fails with "Repository not found". Push with the `arnaudbrejeon` token for that
one command, leaving the active account as it is:

```sh
GH_TOKEN=$(gh auth token --user arnaudbrejeon) \
  git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push
```

Don't switch the active account (`gh auth switch`) to push.
