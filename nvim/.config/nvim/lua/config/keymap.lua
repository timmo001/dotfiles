-- Here you will find all the configured keymaps
-- Make sure to set them here to keep init.lua clean

-- Reload
vim.keymap.set("n", "<leader>X", "<cmd>source %<CR>", { desc = "Reload config" })

-- Move current line up or down a line
vim.keymap.set("v", "<A-j>", ":m '>+1<CR>gv=gv", { desc = "Move line down" })
vim.keymap.set("v", "<A-k>", ":m '<-2<CR>gv=gv", { desc = "Move line up" })

-- Escape
vim.keymap.set("i", "<C-c>", "<Esc>")

-- Quick delete bindings
vim.keymap.set("n", 'd"', '"_d', { desc = "Delete to next quote" })
vim.keymap.set("n", '<leader>d"', '"_d/"<CR>', { desc = "Delete to next quote" })

-- Go to definition
vim.keymap.set("n", "gd", "<cmd>lua vim.lsp.buf.definition()<CR>", { desc = "Go to definition" })
vim.keymap.set("n", "<leader>cd", "<cmd>lua vim.lsp.buf.definition()<CR>", { desc = "Go to definition" })

-- Go to declaration
vim.keymap.set("n", "gD", "<cmd>lua vim.lsp.buf.declaration()<CR>", { desc = "Go to declaration" })
vim.keymap.set("n", "<leader>cD", "<cmd>lua vim.lsp.buf.declaration()<CR>", { desc = "Go to declaration" })

-- Find references
vim.keymap.set("n", "gr", "<cmd>lua vim.lsp.buf.references()<CR>", { desc = "Find references" })
vim.keymap.set("n", "<leader>cr", "<cmd>lua vim.lsp.buf.references()<CR>", { desc = "Find references" })

-- Quickfix
vim.keymap.set('n', '<leader>fn', '<cmd>cnext<CR>', { desc = "Next quickfix" })
vim.keymap.set('n', '<leader>qn', '<cmd>cnext<CR>', { desc = "Next quickfix" })
vim.keymap.set('n', '<leader>fp', '<cmd>cprev<CR>', { desc = "Previous quickfix" })
vim.keymap.set('n', '<leader>qp', '<cmd>cprev<CR>', { desc = "Previous quickfix" })
vim.keymap.set('n', '<leader>fo', '<cmd>copen<CR>', { desc = "Open quickfix" })
vim.keymap.set('n', '<leader>qo', '<cmd>copen<CR>', { desc = "Open quickfix" })
vim.keymap.set('n', '<leader>fc', '<cmd>cclose<CR>', { desc = "Close quickfix" })
vim.keymap.set('n', '<leader>qc', '<cmd>cclose<CR>', { desc = "Close quickfix" })

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
