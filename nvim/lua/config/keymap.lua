-- Here you will find all the configured keymaps
-- Make sure to set them here to keep init.lua clean

-- Reload
vim.keymap.set("n", "<space><space>x", "<cmd>source %<CR>", { desc = "Reload config" })

-- Format
vim.keymap.set("n", "<space>f", function()
  require("conform").format({ async = true })
end, { desc = "Format" })

-- Move current line up or down a line
vim.keymap.set("v", "J", ":m '>+1<CR>gv=gv")
vim.keymap.set("v", "K", ":m '<-2<CR>gv=gv")

-- Prime did this first: https://github.com/ThePrimeagen/init.lua/blob/d92308a63554db8bf8d75de5d41403cc2ddd692a/lua/theprimeagen/remap.lua#L32C1-L32C38
vim.keymap.set("i", "<C-c>", "<Esc>")

-- Quick delete bindings
vim.keymap.set("n", '<leader>d"', '"_d/"<CR>', { desc = "Delete to next quote" })
