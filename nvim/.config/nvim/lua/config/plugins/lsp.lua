return {
  {
    "neovim/nvim-lspconfig",
    dependencies = {
      -- Completion
      "saghen/blink.cmp",
      {
        -- Snippets
        "folke/lazydev.nvim",
        ft = "lua", -- only load on lua files
        opts = {
          library = {
            -- See the configuration section for more details
            -- Load luvit types when the `vim.uv` word is found
            { path = "${3rd}/luv/library", words = { "vim%.uv" } },
          },
        },
      },
    },
    config = function()
      local capabilities = require("blink.cmp").get_lsp_capabilities()
      require("lspconfig").lua_ls.setup({ capabilites = capabilities })
    end,
  },
  -- Mason for managing LSP servers
  {
    'williamboman/mason.nvim',
    config = function()
      require('mason').setup()
    end
  },
  -- Mason integration with LSP
  {
    'williamboman/mason-lspconfig.nvim',
    config = function()
      -- Ensure gopls is installed
      require('mason-lspconfig').setup {
        automatic_installation = true,
        ensure_installed = {
          "gopls",
          -- "lua-language-server",
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
    end,
  },
  -- Function signature help
  { 'ray-x/lsp_signature.nvim' },
}
