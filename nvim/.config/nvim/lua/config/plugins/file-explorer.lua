return {
  {
    "stevearc/oil.nvim",
    ---@module 'oil'
    ---@type oil.SetupOpts
    opts = {},
    -- Optional dependencies
    -- dependencies = { { "echasnovski/mini.icons", opts = {} } },
    dependencies = { "nvim-tree/nvim-web-devicons" }, -- use if prefer nvim-web-devicons
  },

  -- file explorer
  {
    "folke/snacks.nvim",
    opts = { explorer = {} },
    keys = {
      {
        "<leader>fe",
        function()
          Snacks.explorer({
            cwd = vim.fn.expand("%:p:h"),
          })
        end,
        desc = "Explorer Snacks (Root dir)",
      },
      {
        "<leader>fE",
        function()
          Snacks.explorer()
        end,
        desc = "Explorer Snacks (cwd)",
      },
      { "<leader>e", "<leader>fe", desc = "Explorer Snacks (Root dir)", remap = true },
      { "<leader>E", "<leader>fE", desc = "Explorer Snacks (cwd)",      remap = true },
    },
  },
}
