return {
  {
    "dinhhuy258/git.nvim",
    config = function()
      local git = require("git")

      git.setup()

      vim.keymap.set("n", "<leader>gcp", function()
        local gc = require("git.cmd")
        gc.cmd("add .")
        gc.cmd("commit -m 'Update'")
        gc.cmd("push")
      end)
    end,
  },
  {
    "kdheepak/lazygit.nvim",
    lazy = true,
    cmd = {
      "LazyGit",
      "LazyGitConfig",
      "LazyGitCurrentFile",
      "LazyGitFilter",
      "LazyGitFilterCurrentFile",
    },
    -- optional for floating window border decoration
    dependencies = {
      "nvim-lua/plenary.nvim",
    },
    -- setting the keybinding for LazyGit with 'keys' is recommended in
    -- order to load the plugin when the command is run for the first time
    keys = {
      { "<leader>lg", "<cmd>LazyGit<cr>", desc = "LazyGit" },
    },
  },
}
