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
}
