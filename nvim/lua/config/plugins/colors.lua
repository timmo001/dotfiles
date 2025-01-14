return {
  {
    "folke/tokyonight.nvim",
    enabled = true,
    config = function()
      require("tokyonight").setup({
        transparent = true, -- Enables transparency
      })
      -- vim.cmd.colorscheme("tokyonight-night")
    end,
  },
  {
    "rose-pine/neovim",
    enabled = true,
    name = "rose-pine",
    config = function()
      require("rose-pine").setup({
        disable_background = true,
        styles = {
          italic = false,
        },
      })

      -- ColorMyPencils()
    end,
  },
}
