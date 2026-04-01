# Dotfiles symlinked on my machine

Other dotfiles and setup can be found at [omarchy-config](https://github.com/timmo001/omarchy-config).

## Dot command

Primary workflow is now the `dot` command (stowed from `scripts/.local/bin/dot`).

```bash
dot init
dot update
dot stow
dot setup
dot doctor
```

Run `dot help` for all commands.

## Legacy scripts

To install/setup your dotfiles, run this script:

```zsh
./install
```

## Cleanup

To remove the stowed directories and start again, run this script:

```zsh
./clean
```
