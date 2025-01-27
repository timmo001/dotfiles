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
  { 'williamboman/mason.nvim',           config = true },
  -- Mason integration with LSP
  { 'williamboman/mason-lspconfig.nvim', config = true },
  -- Function signature help
  { 'ray-x/lsp_signature.nvim' },
}
