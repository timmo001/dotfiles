#!/usr/bin/env zsh
if [[ -z $STOW_FOLDERS ]]; then
    # Get list of folders in the dotfiles directory
    STOW_FOLDERS=$(ls -d */ | sed 's/\///g' | tr '\n' ',' | sed 's/,$//')
fi

if [[ -z $DOTFILES ]]; then
    DOTFILES=$HOME/.config/dotfiles
fi

pushd $DOTFILES
for folder in $(echo $STOW_FOLDERS | sed "s/,/ /g")
do
    # Ignore backup folder
    if [[ $folder == "backup" ]]; then
        continue
    fi

    echo "stow $folder"
    stow $folder
done
popd
