-- Keymaps are automatically loaded on the VeryLazy event
-- Default keymaps that are always set: https://github.com/LazyVim/LazyVim/blob/main/lua/lazyvim/config/keymaps.lua
-- Add any additional keymaps here

-- Reload
vim.keymap.set("n", "<leader>X", "<cmd>source %<CR>", { desc = "Reload config" })

-- Escape
vim.keymap.set("i", "<C-c>", "<Esc>")

-- Quickfix
vim.keymap.set("n", "<leader>qn", "<cmd>cnext<CR>", { desc = "Next quickfix" })
vim.keymap.set("n", "<leader>qp", "<cmd>cprev<CR>", { desc = "Previous quickfix" })
vim.keymap.set("n", "<leader>qo", "<cmd>copen<CR>", { desc = "Open quickfix" })
vim.keymap.set("n", "<leader>qc", "<cmd>cclose<CR>", { desc = "Close quickfix" })

-- Delete this file
vim.keymap.set("n", "<leader>fd", "<cmd>!rm %<CR>", { desc = "Delete this file" })

-- Edit current directory
vim.keymap.set("n", "<leader>ed", ":e %:p:h<CR>", { desc = "Edit current directory" })

-- Edit current file
vim.keymap.set("n", "<leader>ef", ":e %<CR>", { desc = "Edit current file" })
