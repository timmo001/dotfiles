return {
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
}
