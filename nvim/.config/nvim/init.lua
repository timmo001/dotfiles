-- Require lazy
require("config.lazy")

-- Global options
--   For per file options see after/ftplugin/<FT>.lua
vim.opt.tabstop = 2
vim.opt.shiftwidth = 2
vim.opt.number = true
-- vim.opt.relativenumber = true
vim.opt.expandtab = true
vim.opt.smartindent = true
vim.opt.autoindent = true
vim.g.have_nerd_fonts = true

-- Sync clipboard between OS and Neovim.
--  Schedule the setting after `UiEnter` because it can increase startup-time.
--  Remove this option if you want your OS clipboard to remain independent.
--  See `:help 'clipboard'`
vim.schedule(function()
  vim.opt.clipboard = "unnamedplus"
end)

-- Set keymap bindings
require("config.keymap")

-- yank (yy, yap etc.) highlighting
require("config.yank-highlight")

-- Set the colorscheme based on file type
vim.api.nvim_create_autocmd("BufEnter", {
  callback = function()
    if
        vim.bo.filetype == "typescriptreact"
        or vim.bo.filetype == "typescript"
        or vim.bo.filetype == "javascriptreact"
        or vim.bo.filetype == "javascript"
    then
      vim.cmd.colorscheme("tokyonight-night")
    else
      vim.cmd.colorscheme("rose-pine-moon")
    end
  end,
})

-- Set up Mason
require('mason').setup()

-- Ensure gopls is installed
require('mason-lspconfig').setup {
  automatic_installation = true,
  ensure_installed = {
    "lua-language-server",
    "gopls",
  },
}

local lspconfig = require('lspconfig')

-- Configure gopls
lspconfig.gopls.setup {
  cmd = { "gopls" },
  filetypes = { "go", "gomod" },
  root_dir = lspconfig.util.root_pattern("go.mod", ".git"),
  settings = {
    gopls = {
      analyses = {
        unusedparams = true,
        shadow = true,
      },
      staticcheck = true,
    },
  },
}

-- Optional: Key mappings for LSP functions
local on_attach = function(client, bufnr)
  local opts = { noremap = true, silent = true }
  -- Rename
  vim.api.nvim_buf_set_keymap(bufnr, 'n', '<leader>rn', '<cmd>lua vim.lsp.buf.rename()<CR>', opts)
end

lspconfig.gopls.setup {
  on_attach = on_attach,
}
