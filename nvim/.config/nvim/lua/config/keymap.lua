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

-- Go to
vim.keymap.set("n", "gd", "<cmd>lua vim.lsp.buf.definition()<CR>", { desc = "Go to definition" })
vim.keymap.set("n", "<leader>cd", "<cmd>lua vim.lsp.buf.definition()<CR>", { desc = "Go to definition" })
vim.keymap.set("n", "gD", "<cmd>lua vim.lsp.buf.declaration()<CR>", { desc = "Go to declaration" })
vim.keymap.set("n", "<leader>cD", "<cmd>lua vim.lsp.buf.declaration()<CR>", { desc = "Go to declaration" })

-- Find references
vim.keymap.set("n", "gr", "<cmd>lua vim.lsp.buf.references()<CR>", { desc = "Find references" })
vim.keymap.set("n", "<leader>cr", "<cmd>lua vim.lsp.buf.references()<CR>", { desc = "Find references" })

-- Quickfix
vim.keymap.set('n', '<leader>cn', '<cmd>cnext<CR>', { desc = "Next quickfix" })
vim.keymap.set('n', '<leader>cp', '<cmd>cprev<CR>', { desc = "Previous quickfix" })
vim.keymap.set('n', '<leader>co', '<cmd>copen<CR>', { desc = "Open quickfix" })
vim.keymap.set('n', '<leader>cc', '<cmd>cclose<CR>', { desc = "Close quickfix" })

-- Navigation
vim.keymap.set("n", "<C-h>", "<C-w>h", { desc = "Navigate left" })
vim.keymap.set("n", "<C-j>", "<C-w>j", { desc = "Navigate down" })
vim.keymap.set("n", "<C-k>", "<C-w>k", { desc = "Navigate up" })
vim.keymap.set("n", "<C-l>", "<C-w>l", { desc = "Navigate right" })

-- Go back
vim.keymap.set("n", "gb", "<C-^>", { desc = "Go back" })
vim.keymap.set("n", "<leader>cb", "<C-^>", { desc = "Go back" })

-- Go forward
vim.keymap.set("n", "gf", "<C-o>", { desc = "Go forward" })
vim.keymap.set("n", "<leader>cf", "<C-o>", { desc = "Go forward" })
