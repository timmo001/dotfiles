#!/bin/bash

# Find the Windows Boot Manager entry
boot_entry=$(sudo efibootmgr | grep "Windows Boot Manager" | awk '{print $1}' | sed 's/Boot//;s/\*//')

if [ -z "$boot_entry" ]; then
  echo "Windows Boot Manager not found!"
  exit 1
fi

# Set the Windows Boot Manager as the next boot option
sudo efibootmgr --bootnext $boot_entry

if [ $? -ne 0 ]; then
  echo "Failed to set the Windows Boot Manager as the next boot option"
  exit 1
fi

echo "Rebooting into Windows Boot Manager..."
sudo reboot
