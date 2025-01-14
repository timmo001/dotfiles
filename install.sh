#!/usr/bin/env zsh
if [[ -z $STOW_FOLDERS ]]; then
    # Get list of folders in the dotfiles directory
    STOW_FOLDERS=$(ls -d */ | sed 's/\///g' | tr '\n' ',' | sed 's/,$//')
fi

if [[ -z $DOTFILES ]]; then
    DOTFILES=$HOME/.config/dotfiles
fi

# -----------------------------
# Backup existing dotfiles
# -----------------------------
echo "Backup existing dotfiles"
if [[ -f $HOME/.zshrc ]]; then
    mkdir -p $DOTFILES/backup
    mv $HOME/.zshrc $DOTFILES/backup
fi

if [[ -f $HOME/.editorconfig ]]; then
    mkdir -p $DOTFILES/backup
    mv $HOME/.editorconfig $DOTFILES/backup
fi

if [[ -f $HOME/.config/ghostty/config.toml ]]; then
    mkdir -p $DOTFILES/backup/.config/ghostty
    mv $HOME/.config/ghostty/config.toml $DOTFILES/backup/.config/ghostty
fi

if [[ -d $HOME/.config/nvim ]]; then
    mkdir -p $DOTFILES/backup/.config
    mv $HOME/.config/nvim $DOTFILES/backup/.config
fi

pushd $DOTFILES
for folder in $(echo $STOW_FOLDERS | sed "s/,/ /g")
do
    echo "stow $folder"
    stow -D $folder
    stow $folder
done
popd

