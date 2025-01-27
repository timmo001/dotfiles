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
  -- Function signature help
  { 'ray-x/lsp_signature.nvim' },
  -- LSP diagnostics
  { 'folke/lsp-colors.nvim' },
  -- TypeScript tools
  {
    "pmizio/typescript-tools.nvim",
    dependencies = { "nvim-lua/plenary.nvim", "neovim/nvim-lspconfig" },
    opts = {},
    setup = function()
      require("typescript-tools").setup({
        -- Automatically add missing imports
        auto_import = true,

        -- Enable ESLint integration
        import_on_completion = true,

        -- ESLint
        eslint_enable_diagnostics = true,
        eslint_enable_code_actions = true,

        -- Set up keybindings for LSP features
        on_attach = function(client, bufnr)
          local opts = { noremap = true, silent = true }
          vim.api.nvim_buf_set_keymap(bufnr, 'n', 'K', '<cmd>lua vim.lsp.buf.hover()<CR>', opts)
          vim.api.nvim_buf_set_keymap(bufnr, 'n', '<leader>d', '<cmd>lua vim.diagnostic.open_float()<CR>', opts)
        end,

        --         -- Function to handle incorrect imports
        --         on_incorrect_import = function(import_statement)
        --           -- Logic to handle incorrect imports
        --           -- For example, you can log the incorrect import or replace it with a correct one
        --           print("Incorrect import found: " .. import_statement)
        --           -- Return the corrected import statement (you need to define what this is)
        --           local corrected_import_statement = import_statement -- Modify this as needed
        --           return corrected_import_statement
        --         end,
      })
    end,
  },
  -- Mason integration with LSP
  {
    'williamboman/mason-lspconfig.nvim',
    config = function()
      -- Ensure gopls is installed
      require('mason-lspconfig').setup {
        automatic_installation = true,
        ensure_installed = {
          -- "lua-language-server",
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

      -- Setup hover functionality
      vim.lsp.handlers["textDocument/hover"] = vim.lsp.with(
        vim.lsp.handlers.hover, { border = "rounded" }
      )

      -- Setup function signature help
      require 'lsp_signature'.on_attach()
    end,
  },
}
